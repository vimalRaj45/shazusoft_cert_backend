const fs = require('fs');
const path = require('path');
const { Mistral } = require('@mistralai/mistralai');

/**
 * AI Template Analyzer using Mistral AI Vision API
 * Detects matching font family, theme palette, and optimal field positions (x%, y%)
 */
async function analyzeTemplateImage(imagePath) {
  const apiKey = process.env.MISTRAL_API_KEY || 'lj0jtoGBtC2bayA8bgrd4gAWhakpdvMd';
  const client = new Mistral({ apiKey });

  // Read image and encode as base64 data URL
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const prompt = `
You are an expert typography and graphic design AI.
Analyze this certificate template image carefully and determine:
1. The most appropriate font family that matches this certificate's aesthetic from these options:
   - "Cinzel, serif" (for luxury gold/presidential/diploma certificates)
   - "Playfair Display, serif" (for classic academic/university certificates)
   - "Outfit, sans-serif" (for modern enterprise/tech certificates)
   - "Inter, sans-serif" (for clean minimal/digital certificates)
   - "Great Vibes, cursive" (for script/artistic styling)

2. The primary text color and secondary highlight color found in the template (HEX format, e.g. #123B32, #C47D4C, #1e293b, #0f172a).

3. The optimal percentage coordinates (x_percent from 0 to 100, y_percent from 0 to 100) and font size for dynamic fields to fit naturally on this template canvas:
   - recipient_name (usually centered, large font, prominent)
   - course_title (usually centered, medium font below recipient name)
   - issue_date (usually near bottom left or center)
   - certificate_code (usually bottom center or corner)
   - qr_code (usually bottom corner, size ~70px)

Respond ONLY with valid JSON in this exact structure without markdown fences:
{
  "font_family": "Cinzel, serif",
  "primary_color": "#123B32",
  "secondary_color": "#C47D4C",
  "recommended_fields": [
    {
      "field_name": "recipient_name",
      "field_label": "Recipient Full Name",
      "field_type": "text",
      "x_percent": 50.0,
      "y_percent": 42.0,
      "font_size": 34,
      "font_family": "Cinzel, serif",
      "color": "#123B32",
      "align": "center",
      "is_qr": false
    },
    {
      "field_name": "course_title",
      "field_label": "Course / Achievement Title",
      "field_type": "text",
      "x_percent": 50.0,
      "y_percent": 54.0,
      "font_size": 22,
      "font_family": "Cinzel, serif",
      "color": "#334E43",
      "align": "center",
      "is_qr": false
    },
    {
      "field_name": "issue_date",
      "field_label": "Issue Date",
      "field_type": "date",
      "x_percent": 30.0,
      "y_percent": 76.0,
      "font_size": 14,
      "font_family": "Inter, sans-serif",
      "color": "#334E43",
      "align": "center",
      "is_qr": false
    },
    {
      "field_name": "certificate_code",
      "field_label": "Certificate ID / Code",
      "field_type": "text",
      "x_percent": 50.0,
      "y_percent": 84.0,
      "font_size": 12,
      "font_family": "Inter, sans-serif",
      "color": "#527A68",
      "align": "center",
      "is_qr": false
    },
    {
      "field_name": "qr_code",
      "field_label": "Anti-Tamper QR Code",
      "field_type": "qr",
      "x_percent": 75.0,
      "y_percent": 76.0,
      "font_size": 70,
      "font_family": "Inter, sans-serif",
      "color": "#000000",
      "align": "center",
      "is_qr": true
    }
  ]
}
  `;

  try {
    const chatResponse = await client.chat.complete({
      model: 'pixtral-12b-2409',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', imageUrl: dataUrl }
          ]
        }
      ],
      responseFormat: { type: 'json_object' }
    });

    const rawContent = chatResponse.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(rawContent.trim());
    return parsed;
  } catch (err) {
    console.error('Mistral Vision Analysis Error:', err.message);
    // Fallback standard design if model is busy
    return {
      font_family: 'Cinzel, serif',
      primary_color: '#123B32',
      secondary_color: '#C47D4C',
      recommended_fields: [
        { field_name: 'recipient_name', field_label: 'Recipient Full Name', field_type: 'text', x_percent: 50.0, y_percent: 42.0, font_size: 34, font_family: 'Cinzel, serif', color: '#123B32', align: 'center', is_qr: false },
        { field_name: 'course_title', field_label: 'Course / Achievement Title', field_type: 'text', x_percent: 50.0, y_percent: 54.0, font_size: 22, font_family: 'Cinzel, serif', color: '#334E43', align: 'center', is_qr: false },
        { field_name: 'issue_date', field_label: 'Issue Date', field_type: 'date', x_percent: 30.0, y_percent: 76.0, font_size: 14, font_family: 'Inter, sans-serif', color: '#334E43', align: 'center', is_qr: false },
        { field_name: 'certificate_code', field_label: 'Certificate ID / Code', field_type: 'text', x_percent: 50.0, y_percent: 84.0, font_size: 12, font_family: 'Inter, sans-serif', color: '#527A68', align: 'center', is_qr: false },
        { field_name: 'qr_code', field_label: 'Anti-Tamper QR Code', field_type: 'qr', x_percent: 75.0, y_percent: 76.0, font_size: 70, font_family: 'Inter, sans-serif', color: '#000000', align: 'center', is_qr: true }
      ]
    };
  }
}

module.exports = {
  analyzeTemplateImage
};
