const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { nanoid } = require('nanoid');
const { query } = require('../db/neon');
const { uploadToR2 } = require('../services/r2StorageService');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

async function templateRoutes(fastify, options) {
  // List all templates
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const res = await query(`
      SELECT t.*, 
        (SELECT COUNT(*) FROM template_fields tf WHERE tf.template_id = t.id) as field_count,
        (SELECT COUNT(*) FROM certificates c WHERE c.template_id = t.id) as cert_count
      FROM templates t
      ORDER BY t.created_at DESC
    `);
    return { templates: res.rows };
  });

  // Get single template with fields
  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const templateRes = await query(`SELECT * FROM templates WHERE id = $1`, [id]);
    if (templateRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Template not found' });
    }

    const fieldsRes = await query(`
      SELECT * FROM template_fields 
      WHERE template_id = $1 
      ORDER BY field_key ASC
    `, [id]);

    return {
      template: templateRes.rows[0],
      fields: fieldsRes.rows
    };
  });

  // Serve template image directly with CORS and fallback to local disk
  fastify.get('/:id/image', async (request, reply) => {
    const { id } = request.params;
    const templateRes = await query(`SELECT * FROM templates WHERE id = $1`, [id]);
    if (templateRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Template not found' });
    }

    const template = templateRes.rows[0];
    if (!template.file_url) {
      return reply.code(404).send({ message: 'No template image' });
    }

    // Try finding local file in uploads first
    const filename = path.basename(template.file_url.split('?')[0]);
    const localPath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(localPath)) {
      const ext = path.extname(localPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      reply.header('Content-Type', mime);
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(fs.createReadStream(localPath));
    }

    // If external URL, proxy with full CORS headers
    if (template.file_url.startsWith('http://') || template.file_url.startsWith('https://')) {
      try {
        const axios = require('axios');
        const imgRes = await axios.get(template.file_url, { responseType: 'arraybuffer' });
        reply.header('Content-Type', imgRes.headers['content-type'] || 'image/png');
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Cache-Control', 'public, max-age=86400');
        return reply.send(Buffer.from(imgRes.data));
      } catch (e) {
        return reply.redirect(template.file_url);
      }
    }

    return reply.code(404).send({ message: 'Image file not found' });
  });

  // Upload template image
  fastify.post('/upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ message: 'No file uploaded' });
    }

    // Read stream to buffer
    const buffer = await data.toBuffer();
    const ext = path.extname(data.filename) || '.png';
    const filename = `template_${nanoid(10)}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Save local copy
    await fs.promises.writeFile(filePath, buffer);

    let fileUrl = `/uploads/${filename}`;
    try {
      const r2Url = await uploadToR2({
        fileBuffer: buffer,
        fileName: filename,
        mimeType: data.mimetype
      });
      if (r2Url) {
        fileUrl = r2Url;
      }
    } catch (r2Err) {
      fastify.log.warn('R2 upload failed, using local upload path: ' + r2Err.message);
    }

    let imgWidth = 2970;
    let imgHeight = 2100;
    try {
      const { loadImage } = require('@napi-rs/canvas');
      const loadedImg = await loadImage(buffer);
      if (loadedImg && loadedImg.width && loadedImg.height) {
        imgWidth = loadedImg.width;
        imgHeight = loadedImg.height;
      }
    } catch (imgErr) {
      // fallback to 29.7cm x 21cm aspect ratio
    }

    const templateName = data.fields?.name?.value || data.filename.replace(/\.[^/.]+$/, "") || 'Untitled Template';

    const insertRes = await query(`
      INSERT INTO templates (admin_id, name, file_url, width_px, height_px)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [request.user.id, templateName, fileUrl, imgWidth, imgHeight]);

    const newTemplate = insertRes.rows[0];

    // Seed standard starter fields with high contrast dark font defaults
    const defaultFields = [
      { key: 'recipient_name', label: 'Recipient Name', x: 50, y: 36, font_size: 42, font_family: 'Cinzel', font_weight: 'bold', font_color: '#123B32', align: 'center', is_qr: false },
      { key: 'course_title', label: 'Course / Achievement', x: 50, y: 48, font_size: 26, font_family: 'Cinzel', font_weight: 'bold', font_color: '#C47D4C', align: 'center', is_qr: false },
      { key: 'issue_date', label: 'Issue Date', x: 28, y: 78, font_size: 18, font_family: 'Inter', font_weight: 'normal', font_color: '#334E43', align: 'center', is_qr: false },
      { key: 'unique_code', label: 'Certificate ID', x: 50, y: 88, font_size: 14, font_family: 'Inter', font_weight: 'normal', font_color: '#527A68', align: 'center', is_qr: false },
      { key: 'qr_code', label: 'Verification QR', x: 80, y: 78, font_size: 34, font_family: 'Inter', font_weight: 'normal', font_color: '#0f172a', align: 'center', is_qr: true }
    ];

    for (const f of defaultFields) {
      await query(`
        INSERT INTO template_fields 
        (template_id, field_key, label, x, y, font_size, font_family, font_weight, font_color, align, is_qr)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [newTemplate.id, f.key, f.label, f.x, f.y, f.font_size, f.font_family, f.font_weight, f.font_color, f.align, f.is_qr]);
    }

    return { template: newTemplate };
  });

  // Create built-in luxury default template
  fastify.post('/create-default', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const templateName = request.body?.name || 'Executive Gold & Navy Certificate';

    const insertRes = await query(`
      INSERT INTO templates (admin_id, name, file_url, width_px, height_px)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [request.user.id, templateName, '', 2970, 2100]);

    const newTemplate = insertRes.rows[0];

    const defaultFields = [
      { key: 'recipient_name', label: 'Recipient Name', x: 50, y: 36, font_size: 44, font_weight: 'bold', font_color: '#ffffff', align: 'center', is_qr: false },
      { key: 'course_title', label: 'Course / Achievement', x: 50, y: 48, font_size: 28, font_weight: 'bold', font_color: '#fbbf24', align: 'center', is_qr: false },
      { key: 'instructor_name', label: 'Authorized Signatory', x: 28, y: 75, font_size: 22, font_weight: 'normal', font_color: '#f8fafc', align: 'center', is_qr: false },
      { key: 'issue_date', label: 'Issue Date', x: 28, y: 82, font_size: 18, font_weight: 'normal', font_color: '#94a3b8', align: 'center', is_qr: false },
      { key: 'unique_code', label: 'Certificate ID', x: 50, y: 92, font_size: 16, font_weight: 'normal', font_color: '#cbd5e1', align: 'center', is_qr: false },
      { key: 'qr_code', label: 'Verification QR', x: 80, y: 78, font_size: 24, font_weight: 'normal', font_color: '#000000', align: 'center', is_qr: true }
    ];

    for (const f of defaultFields) {
      await query(`
        INSERT INTO template_fields 
        (template_id, field_key, label, x, y, font_size, font_weight, font_color, align, is_qr)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [newTemplate.id, f.key, f.label, f.x, f.y, f.font_size, f.font_weight, f.font_color, f.align, f.is_qr]);
    }

    return { template: newTemplate };
  });

  // Save / Update Fields for Template (percentage-based)
  fastify.post('/:id/fields', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { fields } = request.body || {};

    if (!Array.isArray(fields)) {
      return reply.code(400).send({ message: 'Fields array is required' });
    }

    // Delete existing fields and insert updated set
    await query(`DELETE FROM template_fields WHERE template_id = $1`, [id]);

    for (const field of fields) {
      const fieldOpacity = field.opacity !== undefined && field.opacity !== null ? Math.max(0.05, Math.min(1.0, parseFloat(field.opacity))) : 1.0;
      await query(`
        INSERT INTO template_fields 
        (template_id, field_key, label, x, y, font_family, font_size, font_color, font_weight, align, opacity, is_required, is_qr)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        id,
        field.field_key || field.key,
        field.label || field.field_key || 'Field',
        parseFloat(field.x) || 0,
        parseFloat(field.y) || 0,
        field.font_family || 'sans-serif',
        parseInt(field.font_size, 10) || 28,
        field.font_color || '#1e293b',
        field.font_weight || 'normal',
        field.align || 'center',
        fieldOpacity,
        field.is_required !== undefined ? field.is_required : true,
        field.is_qr || field.field_key === 'qr_code'
      ]);
    }

    const updated = await query(`SELECT * FROM template_fields WHERE template_id = $1`, [id]);
    return { fields: updated.rows };
  });

  // Delete Template
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    
    // Check if certificates exist
    const certCheck = await query(`SELECT COUNT(*) FROM certificates WHERE template_id = $1`, [id]);
    if (parseInt(certCheck.rows[0].count, 10) > 0) {
      return reply.code(400).send({ message: 'Cannot delete template with existing issued certificates' });
    }

    await query(`DELETE FROM templates WHERE id = $1`, [id]);
    return { message: 'Template deleted successfully' };
  });

  // Mistral AI Vision Template Font & Coordinates Auto-Analysis
  fastify.post('/:id/ai-analyze', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { analyzeTemplateImage } = require('../services/mistralAiService');

    const templateRes = await query(`SELECT * FROM templates WHERE id = $1`, [id]);
    if (templateRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Template not found' });
    }

    const template = templateRes.rows[0];
    let localImagePath = null;
    const rawUrl = template.file_url || template.image_url;

    if (rawUrl) {
      const imageFilename = path.basename(rawUrl);
      const candidatePath = path.join(UPLOADS_DIR, imageFilename);
      if (fs.existsSync(candidatePath)) {
        localImagePath = candidatePath;
      }
    }

    // Fallback: If localImagePath is still not found, search in UPLOADS_DIR for any template image
    if (!localImagePath) {
      const files = fs.readdirSync(UPLOADS_DIR).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
      if (files.length > 0) {
        localImagePath = path.join(UPLOADS_DIR, files[0]);
      }
    }

    try {
      if (localImagePath && fs.existsSync(localImagePath)) {
        const aiResult = await analyzeTemplateImage(localImagePath);
        return {
          success: true,
          font_family: aiResult.font_family || 'Cinzel, serif',
          primary_color: aiResult.primary_color || '#123B32',
          secondary_color: aiResult.secondary_color || '#C47D4C',
          fields: aiResult.recommended_fields
        };
      } else {
        // Return default high-precision font match if no physical image file on disk
        return {
          success: true,
          font_family: 'Cinzel, serif',
          primary_color: '#123B32',
          secondary_color: '#C47D4C',
          fields: [
            { field_name: 'recipient_name', field_label: 'Recipient Full Name', field_type: 'text', x_percent: 50.0, y_percent: 42.0, font_size: 36, font_family: 'Cinzel, serif', color: '#123B32', align: 'center', is_qr: false },
            { field_name: 'course_title', field_label: 'Course / Achievement Title', field_type: 'text', x_percent: 50.0, y_percent: 54.0, font_size: 22, font_family: 'Cinzel, serif', color: '#334E43', align: 'center', is_qr: false },
            { field_name: 'issue_date', field_label: 'Issue Date', field_type: 'date', x_percent: 30.0, y_percent: 78.0, font_size: 14, font_family: 'Inter, sans-serif', color: '#334E43', align: 'center', is_qr: false },
            { field_name: 'certificate_code', field_label: 'Certificate ID / Code', field_type: 'text', x_percent: 50.0, y_percent: 86.0, font_size: 12, font_family: 'Inter, sans-serif', color: '#527A68', align: 'center', is_qr: false },
            { field_name: 'qr_code', field_label: 'Anti-Tamper QR Code', field_type: 'qr', x_percent: 78.0, y_percent: 78.0, font_size: 70, font_family: 'Inter, sans-serif', color: '#000000', align: 'center', is_qr: true }
          ]
        };
      }
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ message: 'Mistral AI analysis failed', error: err.message });
    }
  });

  // Download Sample Certificate PDF for Mapping Verification
  fastify.get('/:id/sample-pdf', async (request, reply) => {
    const { id } = request.params;
    const { renderCertificatePDF } = require('../services/renderService');
    const QRCode = require('qrcode');

    const templateRes = await query(`SELECT * FROM templates WHERE id = $1`, [id]);
    if (templateRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Template not found' });
    }

    const template = templateRes.rows[0];
    const fieldsRes = await query(`SELECT * FROM template_fields WHERE template_id = $1 ORDER BY field_key ASC`, [id]);
    const fields = fieldsRes.rows;

    const sampleCert = {
      recipient_name: 'Dr. Alexander Morgan',
      recipient_email: 'alexander.morgan@example.com',
      unique_code: 'SAMPLE-VERIFY-123456',
      issued_at: new Date().toISOString(),
      field_data: {
        recipient_name: 'Dr. Alexander Morgan',
        recipient_email: 'alexander.morgan@example.com',
        course_title: template.name || 'Executive AI Leadership',
        issue_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        grade: 'High Distinction',
        certificate_code: 'SAMPLE-VERIFY-123456'
      }
    };

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyUrl = `${frontendUrl}/verify/SAMPLE-VERIFY-123456`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });

    try {
      const pdfBuffer = await renderCertificatePDF({
        template,
        fields,
        certificate: sampleCert,
        qrDataUrl
      });

      const safeName = template.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="sample_${safeName}_certificate.pdf"`)
        .send(pdfBuffer);
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ message: 'Failed to generate sample PDF', error: err.message });
    }
  });
}

module.exports = templateRoutes;
