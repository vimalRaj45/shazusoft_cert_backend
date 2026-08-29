const QRCode = require('qrcode');
const { query } = require('../db/neon');
const { renderCertificatePDF, renderCertificateCanvas } = require('../services/renderService');

async function publicRoutes(fastify, options) {
  // Public Verification details endpoint
  fastify.get('/verify/:code', async (request, reply) => {
    const { code } = request.params;
    const ip = request.ip || request.headers['x-forwarded-for'] || '127.0.0.1';
    const userAgent = request.headers['user-agent'] || 'Unknown';

    const certRes = await query(`
      SELECT c.id, c.recipient_name, c.recipient_email, c.unique_code, c.field_data, c.status, c.issued_at, c.verified_count,
             t.id as template_id, t.name as template_name, t.file_url as template_file_url, t.width_px, t.height_px
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE c.unique_code = $1
    `, [code]);

    if (certRes.rows.length === 0) {
      return reply.code(404).send({
        valid: false,
        message: 'Certificate not found. The certificate code is invalid or has expired.'
      });
    }

    const cert = certRes.rows[0];

    // Log verification hit & increment count
    try {
      await query(`
        INSERT INTO verification_logs (certificate_id, ip, user_agent)
        VALUES ($1, $2, $3)
      `, [cert.id, ip, userAgent]);

      await query(`
        UPDATE certificates
        SET verified_count = verified_count + 1
        WHERE id = $1
      `, [cert.id]);
    } catch (e) {
      console.warn('Verification logging failed:', e.message);
    }

    return {
      valid: cert.status === 'issued',
      status: cert.status,
      certificate: {
        id: cert.id,
        recipient_name: cert.recipient_name,
        recipient_email: cert.recipient_email,
        unique_code: cert.unique_code,
        course_title: cert.field_data?.course_title || cert.field_data?.course || cert.template_name,
        field_data: cert.field_data,
        issued_at: cert.issued_at,
        verified_count: cert.verified_count + 1,
        issuer: process.env.BREVO_SENDER_NAME || 'Shazu Soft Technologies'
      }
    };
  });

  // On-Demand PDF Download
  fastify.get('/certificates/:code/download', async (request, reply) => {
    const { code } = request.params;

    const certRes = await query(`
      SELECT c.*, t.id as t_id, t.name as t_name, t.file_url as t_file_url, t.width_px, t.height_px
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE c.unique_code = $1
    `, [code]);

    if (certRes.rows.length === 0) {
      return reply.code(404).send('Certificate not found');
    }

    const cert = certRes.rows[0];
    if (cert.status === 'revoked') {
      return reply.code(403).send('This certificate has been revoked and cannot be downloaded.');
    }

    const template = {
      id: cert.t_id,
      name: cert.t_name,
      file_url: cert.t_file_url,
      width_px: cert.width_px,
      height_px: cert.height_px
    };

    const fieldsRes = await query(`SELECT * FROM template_fields WHERE template_id = $1`, [template.id]);

    const pdfBuffer = await renderCertificatePDF({
      template,
      fields: fieldsRes.rows,
      certificate: cert,
      frontendUrl: process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org'
    });

    const safeName = cert.recipient_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="Certificate_${safeName}_${cert.unique_code.substring(0, 8)}.pdf"`)
      .send(pdfBuffer);
  });

  // On-Demand PNG Preview
  fastify.get('/certificates/:code/preview', async (request, reply) => {
    const { code } = request.params;

    const certRes = await query(`
      SELECT c.*, t.id as t_id, t.name as t_name, t.file_url as t_file_url, t.width_px, t.height_px
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE c.unique_code = $1
    `, [code]);

    if (certRes.rows.length === 0) {
      return reply.code(404).send('Certificate not found');
    }

    const cert = certRes.rows[0];
    const template = {
      id: cert.t_id,
      name: cert.t_name,
      file_url: cert.t_file_url,
      width_px: cert.width_px,
      height_px: cert.height_px
    };

    const fieldsRes = await query(`SELECT * FROM template_fields WHERE template_id = $1`, [template.id]);

    const pngBuffer = await renderCertificateCanvas({
      template,
      fields: fieldsRes.rows,
      certificate: cert,
      frontendUrl: process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org'
    });

    reply
      .header('Content-Type', 'image/png')
      .send(pngBuffer);
  });

  // QR Code Image
  fastify.get('/certificates/:code/qr', async (request, reply) => {
    const { code } = request.params;
    let frontendUrl = process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org';
    if (frontendUrl.includes('pages.dev')) {
      frontendUrl = 'https://certificates.shazusofttechnologies.org';
    }
    const verifyUrl = `${frontendUrl}/verify/${code}`;

    const qrBuffer = await QRCode.toBuffer(verifyUrl, {
      width: 350,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    reply
      .header('Content-Type', 'image/png')
      .send(qrBuffer);
  });

  // Recipient certificate lookup by email
  fastify.get('/lookup', async (request, reply) => {
    const { email, code } = request.query;

    if (!email && !code) {
      return reply.code(400).send({ message: 'Email or certificate code is required' });
    }

    let sql = `
      SELECT c.id, c.recipient_name, c.recipient_email, c.unique_code, c.field_data, c.status, c.issued_at,
             t.name as template_name
      FROM certificates c
      JOIN templates t ON c.template_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (email) {
      params.push(email.trim().toLowerCase());
      sql += ` AND LOWER(c.recipient_email) = $${params.length}`;
    }

    if (code) {
      params.push(code.trim());
      sql += ` AND c.unique_code = $${params.length}`;
    }

    sql += ` ORDER BY c.issued_at DESC`;

    const res = await query(sql, params);
    return { certificates: res.rows };
  });
}

module.exports = publicRoutes;
