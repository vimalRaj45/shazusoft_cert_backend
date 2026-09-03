const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { PDFDocument } = require('pdf-lib');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// Register High-End Certificate Google Fonts
const FONTS_DIR = path.join(__dirname, '../assets/fonts');
if (fs.existsSync(FONTS_DIR)) {
  const FONT_MAPPINGS = {
    'Cinzel-Regular.ttf': ['Cinzel', 'Cinzel, serif'],
    'Cinzel-Bold.ttf': ['Cinzel', 'Cinzel, serif'],
    'CinzelDecorative-Bold.ttf': ['Cinzel Decorative', 'Cinzel Decorative, serif'],
    'PlayfairDisplay-Regular.ttf': ['Playfair Display', 'Playfair Display, serif'],
    'GreatVibes-Regular.ttf': ['Great Vibes', 'Great Vibes, cursive'],
    'PinyonScript-Regular.ttf': ['Pinyon Script', 'Pinyon Script, cursive'],
    'AlexBrush-Regular.ttf': ['Alex Brush', 'Alex Brush, cursive'],
    'UnifrakturCook-Bold.ttf': ['UnifrakturCook', 'UnifrakturCook, cursive'],
    'CormorantGaramond-Regular.ttf': ['Cormorant Garamond', 'Cormorant Garamond, serif'],
    'Outfit-Regular.ttf': ['Outfit', 'Outfit, sans-serif'],
    'BeVietnamPro-Regular.ttf': ['Be Vietnam Pro', 'Be Vietnam', 'Be Vietnam Pro, sans-serif'],
    'BeVietnamPro-Bold.ttf': ['Be Vietnam Pro', 'Be Vietnam', 'Be Vietnam Pro, sans-serif'],
    'Inter-Regular.ttf': ['Inter', 'Inter, sans-serif']
  };

  for (const [file, aliases] of Object.entries(FONT_MAPPINGS)) {
    const fontPath = path.join(FONTS_DIR, file);
    if (fs.existsSync(fontPath)) {
      for (const alias of aliases) {
        try {
          GlobalFonts.registerFromPath(fontPath, alias);
        } catch (e) {
          // ignore duplicate alias registration
        }
      }
    }
  }
}

/**
 * Generate default luxury certificate background if no custom image is uploaded
 */
async function generateDefaultTemplateCanvas(width = 2970, height = 2100) {
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
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      try {
        const bgImg = await loadImage(filePath);
        ctx.drawImage(bgImg, 0, 0, width, height);
        templateLoaded = true;
      } catch (err) {
        console.warn('Could not load R2 template image, falling back to default:', err.message);
      }
    } else {
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
  }

  if (!templateLoaded) {
    const defaultCanvas = await generateDefaultTemplateCanvas(width, height);
    ctx.drawImage(defaultCanvas, 0, 0);
  }

  const fieldData = certificate.field_data || {};
  const uniqueCode = certificate.unique_code;
  let resolvedFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org';
  if (resolvedFrontendUrl.includes('pages.dev') || resolvedFrontendUrl.includes('localhost')) {
    resolvedFrontendUrl = process.env.FRONTEND_URL || 'https://certificates.shazusofttechnologies.org';
  }
  if (resolvedFrontendUrl.includes('pages.dev')) {
    resolvedFrontendUrl = 'https://certificates.shazusofttechnologies.org';
  }
  const verifyUrl = `${resolvedFrontendUrl}/verify/${uniqueCode}`;

  // Draw Field Mappings onto Canvas
  for (const field of fields) {
    // Coordinate conversions: x & y are stored as % of dimensions (0 to 100)
    const posX = (parseFloat(field.x) / 100) * width;
    const posY = (parseFloat(field.y) / 100) * height;

    if (field.is_qr || field.field_key === 'qr_code') {
      // Dynamic QR Code - Seamless transparent integration onto certificate background
      const baseSize = parseInt(field.font_size, 10) || 32;
      const qrSize = Math.max(140, Math.round(baseSize * 4.8));
      
      try {
        const qrBuffer = await QRCode.toBuffer(verifyUrl, {
          width: qrSize * 2, // 2x oversampling for ultra-crisp vector-grade PDF output
          margin: 1,
          color: {
            dark: field.font_color || '#123B32',
            light: '#00000000' // 100% transparent background - blends naturally with certificate parchment/texture
          }
        });
        const qrImg = await loadImage(qrBuffer);

        // Align QR
        let qrX = posX - qrSize / 2;
        let qrY = posY - qrSize / 2;
        if (field.align === 'left') qrX = posX;
        if (field.align === 'right') qrX = posX - qrSize;

        const qrOpacity = field.opacity !== undefined && field.opacity !== null ? parseFloat(field.opacity) : 1.0;
        ctx.save();
        ctx.globalAlpha = isNaN(qrOpacity) ? 1.0 : Math.max(0, Math.min(1, qrOpacity));
        // Draw QR Image directly on the template canvas without harsh white backing
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
        ctx.restore();
      } catch (qrErr) {
        console.error('Error generating QR code for certificate render:', qrErr);
      }
      continue;
    }

    // Resolve Field Text Value
    const key = (field.field_key || '').toLowerCase();
    const label = (field.label || '').toLowerCase();
    let textValue = '';
    if (key === 'recipient_name' || key === 'name') {
      textValue = certificate.recipient_name;
    } else if (
      key === 'unique_code' ||
      key === 'certificate_id' ||
      key === 'certificate_code' ||
      key === 'cert_id' ||
      key === 'cert_code' ||
      key === 'code' ||
      label.includes('certificate id') ||
      label.includes('cert id')
    ) {
      textValue = uniqueCode;
    } else if (key === 'issue_date' || key === 'date') {
      textValue = fieldData[field.field_key] || new Date(certificate.issued_at || Date.now()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } else {
      textValue = fieldData[field.field_key] !== undefined ? String(fieldData[field.field_key]) : (field.label || '');
    }

    // Configure text styling with registered Google font families
    const fontSize = parseInt(field.font_size, 10) || 28;
    let fontFamily = (field.font_family || 'Cinzel').split(',')[0].trim().replace(/['"]/g, '');
    const fontWeight = field.font_weight || 'normal';
    const textOpacity = field.opacity !== undefined && field.opacity !== null ? parseFloat(field.opacity) : 1.0;

    ctx.save();
    ctx.globalAlpha = isNaN(textOpacity) ? 1.0 : Math.max(0, Math.min(1, textOpacity));
    ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", Cinzel, "Playfair Display", serif`;
    ctx.fillStyle = field.font_color || '#123B32';
    ctx.textAlign = field.align || 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(textValue, posX, posY);

    if (field.is_underline || field.text_decoration === 'underline') {
      const metrics = ctx.measureText(textValue);
      const textWidth = metrics.width;
      const underlineY = posY + (fontSize * 0.58);

      let startX = posX;
      if (field.align === 'center') {
        startX = posX - (textWidth / 2);
      } else if (field.align === 'right') {
        startX = posX - textWidth;
      }

      ctx.lineWidth = Math.max(1.5, Math.round(fontSize / 16));
      ctx.strokeStyle = field.font_color || '#123B32';
      ctx.beginPath();
      ctx.moveTo(startX, underlineY);
      ctx.lineTo(startX + textWidth, underlineY);
      ctx.stroke();
    }

    ctx.restore();
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

  const imgWidth = pngImage.width || renderParams.template?.width_px || 2970;
  const imgHeight = pngImage.height || renderParams.template?.height_px || 2100;

  // Standard A4 Landscape PDF Page Size (29.7 cm x 21.0 cm at 72 DPI)
  // 29.7 cm = 841.89 points, 21.0 cm = 595.28 points
  const pageWidth = 841.89;
  const pageHeight = 595.28;

  // Preserve exact aspect ratio without compressing, stretching, or distortion
  const imgAspect = imgWidth / imgHeight;
  const pdfAspect = pageWidth / pageHeight;

  let drawW = pageWidth;
  let drawH = pageHeight;
  let drawX = 0;
  let drawY = 0;

  if (Math.abs(imgAspect - pdfAspect) > 0.01) {
    if (imgAspect > pdfAspect) {
      drawH = pageWidth / imgAspect;
      drawY = (pageHeight - drawH) / 2;
    } else {
      drawW = pageHeight * imgAspect;
      drawX = (pageWidth - drawW) / 2;
    }
  }

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  page.drawImage(pngImage, {
    x: drawX,
    y: drawY,
    width: drawW,
    height: drawH
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
