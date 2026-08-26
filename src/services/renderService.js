const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { PDFDocument } = require('pdf-lib');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

/**
 * Generate default luxury certificate background if no custom image is uploaded
 */
async function generateDefaultTemplateCanvas(width = 1920, height = 1080) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background Gradient (rich deep navy & slate gold border)
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0f172a');
  bgGrad.addColorStop(0.5, '#1e1b4b');
  bgGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Outer Gold Border
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#d97706';
  ctx.strokeRect(30, 30, width - 60, height - 60);

  // Inner Thin Border
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fbbf24';
  ctx.strokeRect(45, 45, width - 90, height - 90);

  // Corner decorative elements
  const cornerSize = 100;
  ctx.fillStyle = '#f59e0b';
  // Top left
  ctx.beginPath();
  ctx.moveTo(45, 45);
  ctx.lineTo(45 + cornerSize, 45);
  ctx.lineTo(45, 45 + cornerSize);
  ctx.closePath();
  ctx.fill();

  // Top right
  ctx.beginPath();
  ctx.moveTo(width - 45, 45);
  ctx.lineTo(width - 45 - cornerSize, 45);
  ctx.lineTo(width - 45, 45 + cornerSize);
  ctx.closePath();
  ctx.fill();

  // Bottom left
  ctx.beginPath();
  ctx.moveTo(45, height - 45);
  ctx.lineTo(45 + cornerSize, height - 45);
  ctx.lineTo(45, height - 45 - cornerSize);
  ctx.closePath();
  ctx.fill();

  // Bottom right
  ctx.beginPath();
  ctx.moveTo(width - 45, height - 45);
  ctx.lineTo(width - 45 - cornerSize, height - 45);
  ctx.lineTo(width - 45, height - 45 - cornerSize);
  ctx.closePath();
  ctx.fill();

  // Center Certificate Watermark / Header
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText('CERTIFICATE OF ACHIEVEMENT', width / 2, 160);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'italic 26px sans-serif';
  ctx.fillText('This is proudly presented to', width / 2, 230);

  // Golden Divider
  const divGrad = ctx.createLinearGradient(width / 2 - 300, 270, width / 2 + 300, 270);
  divGrad.addColorStop(0, 'rgba(245, 158, 11, 0)');
  divGrad.addColorStop(0.5, 'rgba(245, 158, 11, 1)');
  divGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.strokeStyle = divGrad;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 300, 270);
  ctx.lineTo(width / 2 + 300, 270);
  ctx.stroke();

  return canvas;
}

/**
 * Render Certificate Canvas Buffer from template & field mappings
 * @param {Object} params
 * @param {Object} params.template
 * @param {Array} params.fields
 * @param {Object} params.certificate
 * @param {string} params.frontendUrl
 */
async function renderCertificateCanvas({ template, fields = [], certificate, frontendUrl = 'http://localhost:5173' }) {
  const width = template.width_px || 1920;
  const height = template.height_px || 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Load Template Background
  let templateLoaded = false;
  if (template.file_url) {
    let filePath = template.file_url;
    if (filePath.startsWith('/uploads/')) {
      filePath = path.join(__dirname, '../../', filePath);
    }
    if (fs.existsSync(filePath)) {
      try {
        const bgImg = await loadImage(filePath);
        ctx.drawImage(bgImg, 0, 0, width, height);
        templateLoaded = true;
      } catch (err) {
        console.warn('Could not load custom template image, falling back to default:', err.message);
      }
    }
  }

  if (!templateLoaded) {
    const defaultCanvas = await generateDefaultTemplateCanvas(width, height);
    ctx.drawImage(defaultCanvas, 0, 0);
  }

  const fieldData = certificate.field_data || {};
  const uniqueCode = certificate.unique_code;
  const verifyUrl = `${frontendUrl}/verify/${uniqueCode}`;

  // Draw Field Mappings onto Canvas
  for (const field of fields) {
    // Coordinate conversions: x & y are stored as % of dimensions (0 to 100)
    const posX = (parseFloat(field.x) / 100) * width;
    const posY = (parseFloat(field.y) / 100) * height;

    if (field.is_qr || field.field_key === 'qr_code') {
      // Draw Dynamic QR Code
      const qrSize = Math.round((field.font_size || 30) * 4); // scale QR appropriately
      try {
        const qrBuffer = await QRCode.toBuffer(verifyUrl, {
          width: qrSize,
          margin: 1,
          color: {
            dark: field.font_color || '#000000',
            light: '#ffffff'
          }
        });
        const qrImg = await loadImage(qrBuffer);
        // Align QR
        let qrX = posX - qrSize / 2;
        let qrY = posY - qrSize / 2;
        if (field.align === 'left') qrX = posX;
        if (field.align === 'right') qrX = posX - qrSize;

        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      } catch (qrErr) {
        console.error('Error generating QR code for certificate render:', qrErr);
      }
      continue;
    }

    // Resolve Field Text Value
    let textValue = '';
    if (field.field_key === 'recipient_name') {
      textValue = certificate.recipient_name;
    } else if (field.field_key === 'unique_code' || field.field_key === 'certificate_id') {
      textValue = uniqueCode;
    } else if (field.field_key === 'issue_date' || field.field_key === 'date') {
      textValue = fieldData[field.field_key] || new Date(certificate.issued_at || Date.now()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } else {
      textValue = fieldData[field.field_key] !== undefined ? String(fieldData[field.field_key]) : (field.label || '');
    }

    // Configure text styling
    const fontSize = parseInt(field.font_size, 10) || 28;
    const fontFamily = field.font_family || 'sans-serif';
    const fontWeight = field.font_weight || 'normal';
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = field.font_color || '#1e293b';
    ctx.textAlign = field.align || 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(textValue, posX, posY);
  }

  return canvas.toBuffer('image/png');
}

/**
 * Generate PDF buffer from Certificate Canvas
 */
async function renderCertificatePDF(renderParams) {
  const pngBuffer = await renderCertificateCanvas(renderParams);

  const pdfDoc = await PDFDocument.create();
  const pngImage = await pdfDoc.embedPng(pngBuffer);

  const width = renderParams.template.width_px || 1920;
  const height = renderParams.template.height_px || 1080;

  // Add a page matching the certificate aspect ratio in points (72 DPI)
  // Scaling standard: 1920x1080 -> 842 x 473 (Landscape A4-ish)
  const scale = 0.5;
  const pageWidth = width * scale;
  const pageHeight = height * scale;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight
  });

  pdfDoc.setTitle(`Certificate - ${renderParams.certificate.recipient_name}`);
  pdfDoc.setAuthor('Shazu Soft Technologies');
  pdfDoc.setSubject(`Verification ID: ${renderParams.certificate.unique_code}`);
  pdfDoc.setCreator('Certificate Generator & Verification Engine');

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  renderCertificateCanvas,
  renderCertificatePDF,
  generateDefaultTemplateCanvas
};
