const { nanoid } = require('nanoid');
const { query } = require('../db/neon');
const { authenticateApiKey } = require('../services/apiKeyAuth');
const { resolveTemplate, getAvailableChoices } = require('../services/templateResolver');
const { sendCertificateEmail } = require('../services/hostingerService');
const { renderCertificateCanvas } = require('../services/renderService');
const { queueService } = require('../services/queueService');

async function externalRoutes(fastify, options) {
  // All external API endpoints are secured with API Key authentication
  fastify.addHook('preHandler', authenticateApiKey);

  /**
   * 1. GET /templates
   * List all available templates with preview URLs and required field schemas
   */
  fastify.get('/templates', async (request, reply) => {
    try {
      const templatesRes = await query(`
        SELECT t.id, t.name, t.file_url, t.width_px, t.height_px, t.created_at,
          (
            SELECT json_agg(json_build_object(
              'field_key', tf.field_key,
              'label', tf.label,
              'font_family', tf.font_family,
              'font_size', tf.font_size,
              'font_color', tf.font_color,
              'align', tf.align,
              'is_required', tf.is_required,
              'is_qr', tf.is_qr
            ) ORDER BY tf.field_key ASC)
            FROM template_fields tf
            WHERE tf.template_id = t.id
          ) as fields,
          (
            SELECT json_agg(am.association_name)
            FROM association_mappings am
            WHERE am.template_id = t.id AND am.is_active = true
          ) as mapped_associations
        FROM templates t
        ORDER BY t.created_at DESC
      `);

      const publicApiUrl = process.env.PUBLIC_API_URL || 'http://localhost:5000';

      const formattedTemplates = templatesRes.rows.map((t) => {
        const previewUrl = t.file_url?.startsWith('http')
          ? t.file_url
          : `${publicApiUrl}/api/templates/${t.id}/image`;

        return {
          id: t.id,
          name: t.name,
          dimensions: {
            width_px: t.width_px,
            height_px: t.height_px
          },
          image_url: previewUrl,
          mapped_associations: t.mapped_associations || [],
          fields: t.fields || []
        };
      });

      return {
        success: true,
        total: formattedTemplates.length,
        templates: formattedTemplates
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: 'DatabaseError',
        message: 'Failed to retrieve available templates'
      });
    }
  });

  /**
   * 1b. GET /templates/:identifier
   * Get single template details and its required/optional field schema by Template Name, ID, or Association Name
   */
  fastify.get('/templates/:identifier', async (request, reply) => {
    const { identifier } = request.params;

    const resolution = await resolveTemplate({
      template_id: identifier.includes('-') && identifier.length === 36 ? identifier : undefined,
      template_name: identifier,
      association_name: identifier
    });

    if (!resolution) {
      const choices = await getAvailableChoices();
      return reply.code(404).send({
        success: false,
        error: 'TemplateNotFound',
        message: `Template or association "${identifier}" not found.`,
        available_templates: choices.templates,
        available_associations: choices.associations
      });
    }

    const { template, fields, mapping, matchedBy } = resolution;
    const publicApiUrl = process.env.PUBLIC_API_URL || 'http://localhost:5000';
    const previewUrl = template.file_url?.startsWith('http')
      ? template.file_url
      : `${publicApiUrl}/api/templates/${template.id}/image`;

    const formattedFields = (fields || [])
      .filter((f) => !f.is_qr && f.field_key !== 'qr_code' && f.field_key !== 'unique_code' && f.field_key !== 'certificate_id')
      .map((f) => ({
        field_key: f.field_key,
        label: f.label,
        is_required: f.is_required !== false,
        font_family: f.font_family,
        font_size: f.font_size,
        font_color: f.font_color
      }));

    // Standard required fields included in schema for clarity
    const requiredFields = [
      { field_key: 'recipient_name', label: 'Recipient Full Name', is_required: true },
      { field_key: 'recipient_email', label: 'Recipient Email Address', is_required: true },
      ...formattedFields
    ];

    return {
      success: true,
      template: {
        id: template.id,
        name: template.name,
        matched_by: matchedBy,
        image_url: previewUrl,
        default_course_title: mapping?.default_course_title || template.name,
        default_issuer_name: mapping?.default_issuer_name || 'Shazu Soft Technologies',
        required_fields: requiredFields
      }
    };
  });

  /**
   * 2. GET /associations
   * List all active association-to-template mappings
   */
  fastify.get('/associations', async (request, reply) => {
    try {
      const res = await query(`
        SELECT am.id, am.association_name, am.default_course_title, am.default_issuer_name, am.created_at,
               t.id as template_id, t.name as template_name
        FROM association_mappings am
        JOIN templates t ON am.template_id = t.id
        WHERE am.is_active = true
        ORDER BY am.association_name ASC
      `);

      return {
        success: true,
        count: res.rows.length,
        associations: res.rows
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: 'DatabaseError',
        message: 'Failed to retrieve association mappings'
      });
    }
  });

  /**
   * 3. POST /certificates/issue
   * Issue a single certificate dynamically by Association Name, Template ID, or Template Name
   */
  fastify.post('/certificates/issue', async (request, reply) => {
    const {
      recipient_name,
      recipient_email,
      association_name,
      template_id,
      template_name,
      course_title,
      field_data = {},
      send_email = true
    } = request.body || {};

    // Validation
    if (!recipient_name || typeof recipient_name !== 'string' || !recipient_name.trim()) {
      return reply.code(400).send({
        success: false,
        error: 'ValidationError',
        message: 'Field "recipient_name" is required and must be a non-empty string.'
      });
    }

    if (!recipient_email || typeof recipient_email !== 'string' || !recipient_email.includes('@')) {
      return reply.code(400).send({
        success: false,
        error: 'ValidationError',
        message: 'Field "recipient_email" is required and must be a valid email address.'
      });
    }

    if (!association_name && !template_id && !template_name) {
      const choices = await getAvailableChoices();
      return reply.code(400).send({
        success: false,
        error: 'ValidationError',
        message: 'Must provide at least one template identifier: "association_name", "template_id", or "template_name".',
        available_associations: choices.associations,
        available_templates: choices.templates
      });
    }

    // Resolve template dynamically
    const resolution = await resolveTemplate({
      template_id,
      association_name,
      template_name
    });

    if (!resolution) {
      const choices = await getAvailableChoices();
      return reply.code(404).send({
        success: false,
        error: 'TemplateNotFound',
        message: `No matching template found for provided identifier (association: "${association_name || ''}", template_id: "${template_id || ''}", template_name: "${template_name || ''}").`,
        available_associations: choices.associations,
        available_templates: choices.templates
      });
    }

    const { template, fields, mapping, matchedBy } = resolution;

    // Validate required fields defined on the template
    const missingRequired = [];
    for (const field of fields || []) {
      if (!field.is_required || field.is_qr || field.field_key === 'qr_code' || field.field_key === 'unique_code' || field.field_key === 'certificate_id') {
        continue;
      }
      const key = field.field_key.toLowerCase();
      if (key === 'recipient_name' || key === 'name') {
        if (!recipient_name) missingRequired.push(field.label || field.field_key);
      } else if (key === 'course_title' || key === 'course' || key === 'title') {
        const titleVal = course_title || field_data.course_title || field_data.course || mapping?.default_course_title || template.name;
        if (!titleVal) missingRequired.push(field.label || field.field_key);
      } else {
        if (field_data[field.field_key] === undefined || field_data[field.field_key] === null || String(field_data[field.field_key]).trim() === '') {
          missingRequired.push(field.label || field.field_key);
        }
      }
    }

    if (missingRequired.length > 0) {
      return reply.code(400).send({
        success: false,
        error: 'ValidationError',
        message: `Missing required certificate field(s): ${missingRequired.join(', ')}`,
        missing_fields: missingRequired
      });
    }

    // Resolve course title and issuer
    const resolvedTitle =
      course_title ||
      field_data.course_title ||
      field_data.course ||
      mapping?.default_course_title ||
      template.name ||
      'Certificate of Achievement';

    const issuerName =
      mapping?.default_issuer_name ||
      process.env.HOSTINGER_SENDER_NAME ||
      'Shazu Soft Technologies';

    const mergedFieldData = {
      course_title: resolvedTitle,
      ...field_data
    };

    const uniqueCode = nanoid(21);

    try {
      // 1. Insert audit batch record
      const batchRes = await query(
        `INSERT INTO batches (admin_id, template_id, source, total_records, processed_records, status)
         VALUES (null, $1, 'form', 1, 1, 'completed')
         RETURNING id`,
        [template.id]
      );
      const batchId = batchRes.rows[0].id;

      // 2. Insert certificate record
      const certRes = await query(
        `INSERT INTO certificates (batch_id, template_id, recipient_email, recipient_name, unique_code, field_data, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'issued')
         RETURNING *`,
        [
          batchId,
          template.id,
          recipient_email.trim().toLowerCase(),
          recipient_name.trim(),
          uniqueCode,
          JSON.stringify(mergedFieldData)
        ]
      );

      const certificate = certRes.rows[0];

      // URLs
      const frontendUrl = process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org';
      const publicApiUrl = process.env.PUBLIC_API_URL || 'http://localhost:5000';
      const verifyUrl = `${frontendUrl}/verify/${uniqueCode}`;
      const downloadUrl = `${publicApiUrl}/api/public/certificates/${uniqueCode}/download`;
      const previewImageUrl = `${publicApiUrl}/api/public/certificates/${uniqueCode}/preview`;

      // 3. Dispatch official email if requested
      let emailStatus = 'skipped';
      let emailError = null;

      if (send_email) {
        const emailResult = await sendCertificateEmail({
          recipientEmail: certificate.recipient_email,
          recipientName: certificate.recipient_name,
          courseTitle: resolvedTitle,
          certificateTitle: resolvedTitle,
          certificateCode: uniqueCode,
          uniqueCode: uniqueCode,
          issuerName: issuerName
        });

        emailStatus = emailResult.success ? 'sent' : 'failed';
        emailError = emailResult.error || null;

        await query(
          `INSERT INTO email_logs (certificate_id, brevo_message_id, status, error_message)
           VALUES ($1, $2, $3, $4)`,
          [certificate.id, emailResult.messageId || null, emailStatus, emailError]
        );
      }

      return reply.code(201).send({
        success: true,
        message: 'Certificate successfully generated and recorded',
        data: {
          certificate_id: certificate.id,
          unique_code: uniqueCode,
          recipient_name: certificate.recipient_name,
          recipient_email: certificate.recipient_email,
          association_name: association_name || mapping?.association_name || null,
          template: {
            id: template.id,
            name: template.name,
            matched_by: matchedBy
          },
          field_data: mergedFieldData,
          verification_url: verifyUrl,
          download_url: downloadUrl,
          preview_image_url: previewImageUrl,
          email_delivery: {
            status: emailStatus,
            error: emailError
          },
          issued_at: certificate.issued_at
        }
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: 'DatabaseError',
        message: 'Failed to issue certificate: ' + err.message
      });
    }
  });

  /**
   * 4. POST /certificates/issue-batch
   * Batch issuance for multiple recipients with background queue processing
   */
  fastify.post('/certificates/issue-batch', async (request, reply) => {
    const {
      records = [],
      association_name,
      template_id,
      template_name,
      course_title = 'Certification Program',
      send_email = true
    } = request.body || {};

    if (!Array.isArray(records) || records.length === 0) {
      return reply.code(400).send({
        success: false,
        error: 'ValidationError',
        message: 'Field "records" must be a non-empty array of recipient objects.'
      });
    }

    // Resolve template
    const resolution = await resolveTemplate({
      template_id,
      association_name,
      template_name
    });

    if (!resolution) {
      const choices = await getAvailableChoices();
      return reply.code(404).send({
        success: false,
        error: 'TemplateNotFound',
        message: 'No matching template found for the batch.',
        available_associations: choices.associations,
        available_templates: choices.templates
      });
    }

    const { template, mapping } = resolution;
    const resolvedTitle = course_title || mapping?.default_course_title || template.name;

    try {
      const batchRes = await query(
        `INSERT INTO batches (admin_id, template_id, source, filename, total_records, processed_records, status)
         VALUES (null, $1, 'csv', $2, $3, 0, 'processing')
         RETURNING *`,
        [template.id, `api_batch_${nanoid(8)}`, records.length]
      );

      const batch = batchRes.rows[0];

      // Trigger asynchronous queue processor
      queueService.processBulkBatch({
        batchId: batch.id,
        templateId: template.id,
        records: records,
        courseTitle: resolvedTitle,
        sendEmail: send_email
      });

      return reply.code(202).send({
        success: true,
        message: `Bulk issuance queued for ${records.length} recipients`,
        batch_id: batch.id,
        template: {
          id: template.id,
          name: template.name
        },
        total_records: records.length,
        status: 'processing'
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: 'ServerError',
        message: 'Failed to queue bulk batch'
      });
    }
  });

  /**
   * 5. POST /certificates/preview
   * Live mockup render (returns image stream) without saving to database or emailing
   */
  fastify.post('/certificates/preview', async (request, reply) => {
    const {
      recipient_name = 'Sample Recipient',
      association_name,
      template_id,
      template_name,
      course_title = 'Sample Achievement Certificate',
      field_data = {}
    } = request.body || {};

    const resolution = await resolveTemplate({
      template_id,
      association_name,
      template_name
    });

    if (!resolution) {
      return reply.code(404).send({
        success: false,
        error: 'TemplateNotFound',
        message: 'Template not found for preview'
      });
    }

    const { template, fields } = resolution;

    try {
      const dummyCert = {
        recipient_name,
        unique_code: 'PREVIEW-CODE-000000',
        issued_at: new Date().toISOString(),
        field_data: {
          course_title,
          ...field_data
        }
      };

      const pngBuffer = await renderCertificateCanvas({
        template,
        fields,
        certificate: dummyCert,
        frontendUrl: process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org'
      });

      reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'no-cache')
        .send(pngBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: 'RenderError',
        message: 'Failed to generate certificate preview: ' + err.message
      });
    }
  });

  /**
   * 6. GET /certificates/:code
   * Query certificate status, delivery logs, and verification info
   */
  fastify.get('/certificates/:code', async (request, reply) => {
    const { code } = request.params;

    try {
      const certRes = await query(
        `SELECT c.*, t.name as template_name
         FROM certificates c
         JOIN templates t ON c.template_id = t.id
         WHERE c.unique_code = $1`,
        [code]
      );

      if (certRes.rows.length === 0) {
        return reply.code(404).send({
          success: false,
          error: 'NotFound',
          message: 'Certificate not found'
        });
      }

      const cert = certRes.rows[0];
      const emailLogsRes = await query(
        `SELECT * FROM email_logs WHERE certificate_id = $1 ORDER BY sent_at DESC`,
        [cert.id]
      );

      const frontendUrl = process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org';
      const publicApiUrl = process.env.PUBLIC_API_URL || 'http://localhost:5000';

      return {
        success: true,
        certificate: {
          id: cert.id,
          unique_code: cert.unique_code,
          recipient_name: cert.recipient_name,
          recipient_email: cert.recipient_email,
          template_name: cert.template_name,
          status: cert.status,
          issued_at: cert.issued_at,
          verified_count: cert.verified_count,
          field_data: cert.field_data,
          verification_url: `${frontendUrl}/verify/${cert.unique_code}`,
          download_url: `${publicApiUrl}/api/public/certificates/${cert.unique_code}/download`,
          email_logs: emailLogsRes.rows
        }
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        error: 'DatabaseError',
        message: 'Failed to query certificate'
      });
    }
  });
}

module.exports = externalRoutes;
