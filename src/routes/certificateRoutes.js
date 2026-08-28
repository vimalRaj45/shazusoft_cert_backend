const { nanoid } = require('nanoid');
const { query } = require('../db/neon');
const { sendCertificateEmail } = require('../services/hostingerService');
const { queueService } = require('../services/queueService');

async function certificateRoutes(fastify, options) {
  // List certificates with search, filter, and pagination
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { search = '', status = '', template_id = '', limit = 50, offset = 0 } = request.query;

    let sql = `
      SELECT c.*, t.name as template_name,
        (SELECT status FROM email_logs el WHERE el.certificate_id = c.id ORDER BY el.sent_at DESC LIMIT 1) as email_status
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (c.recipient_name ILIKE $${params.length} OR c.recipient_email ILIKE $${params.length} OR c.unique_code ILIKE $${params.length})`;
    }

    if (status) {
      params.push(status);
      sql += ` AND c.status = $${params.length}`;
    }

    if (template_id) {
      params.push(template_id);
      sql += ` AND c.template_id = $${params.length}`;
    }

    sql += ` ORDER BY c.issued_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const res = await query(sql, params);

    // Get total count
    let countSql = `SELECT COUNT(*) FROM certificates c WHERE 1=1`;
    const countParams = [];
    if (search) {
      countParams.push(`%${search}%`);
      countSql += ` AND (c.recipient_name ILIKE $${countParams.length} OR c.recipient_email ILIKE $${countParams.length} OR c.unique_code ILIKE $${countParams.length})`;
    }
    if (status) {
      countParams.push(status);
      countSql += ` AND c.status = $${countParams.length}`;
    }
    if (template_id) {
      countParams.push(template_id);
      countSql += ` AND c.template_id = $${countParams.length}`;
    }
    const countRes = await query(countSql, countParams);

    return {
      certificates: res.rows,
      total: parseInt(countRes.rows[0].count, 10)
    };
  });

  // Get single certificate with audit logs
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const certRes = await query(`
      SELECT c.*, t.name as template_name, t.file_url as template_file_url
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE c.id = $1
    `, [id]);

    if (certRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Certificate not found' });
    }

    const emailLogs = await query(`SELECT * FROM email_logs WHERE certificate_id = $1 ORDER BY sent_at DESC`, [id]);
    const verifLogs = await query(`SELECT * FROM verification_logs WHERE certificate_id = $1 ORDER BY verified_at DESC`, [id]);

    return {
      certificate: certRes.rows[0],
      emailLogs: emailLogs.rows,
      verificationLogs: verifLogs.rows
    };
  });

  // Issue Single Certificate
  fastify.post('/single', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const {
      template_id,
      recipient_email,
      recipient_name,
      field_data = {},
      send_email = true
    } = request.body || {};

    if (!template_id || !recipient_email || !recipient_name) {
      return reply.code(400).send({ message: 'Template, recipient email, and recipient name are required' });
    }

    // Verify template exists
    const templateCheck = await query(`SELECT id, name FROM templates WHERE id = $1`, [template_id]);
    if (templateCheck.rows.length === 0) {
      return reply.code(404).send({ message: 'Template not found' });
    }

    const uniqueCode = nanoid(21);

    // Create batch record for single issuance audit
    const batchRes = await query(`
      INSERT INTO batches (admin_id, template_id, source, total_records, processed_records, status)
      VALUES ($1, $2, 'form', 1, 1, 'completed')
      RETURNING id
    `, [request.user.id, template_id]);
    const batchId = batchRes.rows[0].id;

    // Create certificate
    const certRes = await query(`
      INSERT INTO certificates (batch_id, template_id, recipient_email, recipient_name, unique_code, field_data, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'issued')
      RETURNING *
    `, [batchId, template_id, recipient_email.trim(), recipient_name.trim(), uniqueCode, JSON.stringify(field_data)]);

    const certificate = certRes.rows[0];

    // Send Transactional Email
    let emailStatus = 'skipped';
    if (send_email) {
      const resolvedTitle = field_data.course_title || field_data.course || field_data.title || templateCheck.rows[0]?.name || 'Certificate of Completion';
      const emailResult = await sendCertificateEmail({
        recipientEmail: recipient_email,
        recipientName: recipient_name,
        courseTitle: resolvedTitle,
        certificateTitle: resolvedTitle,
        certificateCode: uniqueCode,
        uniqueCode: uniqueCode
      });

      emailStatus = emailResult.success ? 'sent' : 'failed';

      await query(`
        INSERT INTO email_logs (certificate_id, brevo_message_id, status, error_message)
        VALUES ($1, $2, $3, $4)
      `, [certificate.id, emailResult.messageId || null, emailStatus, emailResult.error || null]);
    }

    return {
      message: 'Certificate issued successfully',
      certificate,
      emailStatus
    };
  });

  // Bulk Issue Certificates (from CSV or JSON array)
  fastify.post('/bulk', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const {
      template_id,
      records = [],
      filename = 'bulk_import.csv',
      send_email = true,
      course_title = 'Certification Program'
    } = request.body || {};

    if (!template_id || !Array.isArray(records) || records.length === 0) {
      return reply.code(400).send({ message: 'Template and non-empty records list are required' });
    }

    // Create batch record
    const batchRes = await query(`
      INSERT INTO batches (admin_id, template_id, source, filename, total_records, processed_records, status)
      VALUES ($1, $2, 'csv', $3, $4, 0, 'processing')
      RETURNING *
    `, [request.user.id, template_id, filename, records.length]);

    const batch = batchRes.rows[0];

    // Trigger asynchronous queue processor
    queueService.processBulkBatch({
      batchId: batch.id,
      templateId: template_id,
      records: records,
      courseTitle: course_title,
      sendEmail: send_email
    });

    return {
      message: `Bulk issuance started for ${records.length} recipients`,
      batch
    };
  });

  // Revoke Certificate
  fastify.put('/:id/revoke', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const res = await query(`
      UPDATE certificates 
      SET status = 'revoked' 
      WHERE id = $1 
      RETURNING *
    `, [id]);

    if (res.rows.length === 0) {
      return reply.code(404).send({ message: 'Certificate not found' });
    }

    return {
      message: 'Certificate revoked successfully',
      certificate: res.rows[0]
    };
  });

  // Re-issue / Un-revoke Certificate
  fastify.put('/:id/reissue', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const res = await query(`
      UPDATE certificates 
      SET status = 'issued' 
      WHERE id = $1 
      RETURNING *
    `, [id]);

    if (res.rows.length === 0) {
      return reply.code(404).send({ message: 'Certificate not found' });
    }

    return {
      message: 'Certificate restored to active status',
      certificate: res.rows[0]
    };
  });

  // Resend Brevo Email
  fastify.post('/:id/resend-email', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const certRes = await query(`
      SELECT c.*, t.name as template_name
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE c.id = $1
    `, [id]);

    if (certRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Certificate not found' });
    }

    const cert = certRes.rows[0];
    const resolvedTitle = cert.field_data?.course_title || cert.field_data?.course || cert.field_data?.title || cert.template_name || 'Certificate of Completion';

    const emailResult = await sendCertificateEmail({
      recipientEmail: cert.recipient_email,
      recipientName: cert.recipient_name,
      courseTitle: resolvedTitle,
      certificateTitle: resolvedTitle,
      certificateCode: cert.unique_code,
      uniqueCode: cert.unique_code
    });

    await query(`
      INSERT INTO email_logs (certificate_id, brevo_message_id, status, error_message)
      VALUES ($1, $2, $3, $4)
    `, [cert.id, emailResult.messageId || null, emailResult.success ? 'sent' : 'failed', emailResult.error || null]);

    return {
      success: emailResult.success,
      message: emailResult.success ? 'Brevo email sent successfully' : 'Failed to send Brevo email',
      error: emailResult.error
    };
  });
}

module.exports = certificateRoutes;
