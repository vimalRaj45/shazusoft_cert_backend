const axios = require('axios');
require('dotenv').config();

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Send Transactional Email using Brevo API
 * @param {Object} params
 * @param {string} params.recipientEmail
 * @param {string} params.recipientName
 * @param {string} params.certificateTitle
 * @param {string} params.uniqueCode
 * @param {string} [params.customMessage]
 */
async function sendCertificateEmail({
  recipientEmail,
  recipientName,
  certificateTitle,
  uniqueCode,
  customMessage
}) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'vsgrpsemail@gmail.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'Shazu Soft Technologies';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const apiUrl = process.env.PUBLIC_API_URL || 'http://localhost:5000';

  const downloadUrl = `${apiUrl}/api/public/certificates/${uniqueCode}/download`;
  const verifyUrl = `${frontendUrl}/verify/${uniqueCode}`;
  
  // LinkedIn Add to Profile URL
  const courseEncoded = encodeURIComponent(certificateTitle || 'Certificate of Completion');
  const orgNameEncoded = encodeURIComponent(senderName);
  const now = new Date();
  const issueYear = now.getFullYear();
  const issueMonth = now.getMonth() + 1;
  const linkedinAddUrl = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${courseEncoded}&organizationName=${orgNameEncoded}&issueYear=${issueYear}&issueMonth=${issueMonth}&certUrl=${encodeURIComponent(verifyUrl)}&certId=${uniqueCode}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Certificate is Ready</title>
      <style>
        body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%); color: #ffffff; padding: 36px 30px; text-align: center; }
        .header h1 { margin: 0 0 8px 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
        .header p { margin: 0; opacity: 0.9; font-size: 15px; }
        .content { padding: 32px 30px; }
        .congrats { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
        .message { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
        .card { background: #f1f5f9; border-left: 4px solid #4f46e5; border-radius: 6px; padding: 16px 20px; margin-bottom: 28px; }
        .card-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
        .card-label { color: #64748b; font-weight: 500; }
        .card-val { color: #0f172a; font-weight: 600; }
        .actions { text-align: center; margin: 30px 0; }
        .btn-download { display: inline-block; background: #4f46e5; color: #ffffff !important; font-weight: 600; font-size: 16px; padding: 14px 32px; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35); transition: background 0.2s; margin-bottom: 12px; }
        .btn-secondary { display: inline-block; background: #ffffff; color: #4f46e5 !important; border: 1px solid #c7d2fe; font-weight: 600; font-size: 14px; padding: 10px 20px; border-radius: 8px; text-decoration: none; margin: 4px; }
        .btn-linkedin { display: inline-block; background: #0077b5; color: #ffffff !important; font-weight: 600; font-size: 14px; padding: 10px 20px; border-radius: 8px; text-decoration: none; margin: 4px; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 30px; text-align: center; font-size: 12px; color: #94a3b8; }
        .code-box { display: inline-block; font-family: monospace; background: #e2e8f0; padding: 4px 10px; border-radius: 4px; font-size: 14px; color: #334155; margin-top: 5px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${senderName}</h1>
          <p>Certificate of Achievement & Verification</p>
        </div>
        <div class="content">
          <div class="congrats">Congratulations, ${recipientName}! 🎓</div>
          <div class="message">
            ${customMessage || `We are proud to present your official certificate for <strong>${certificateTitle || 'successful course completion'}</strong>. Your achievement has been authenticated and permanently recorded on our public verification system.`}
          </div>
          
          <div class="card">
            <div class="card-row">
              <span class="card-label">Recipient:</span>
              <span class="card-val">${recipientName}</span>
            </div>
            <div class="card-row">
              <span class="card-label">Certificate Title:</span>
              <span class="card-val">${certificateTitle || 'Course Certificate'}</span>
            </div>
            <div class="card-row">
              <span class="card-label">Certificate ID:</span>
              <span class="card-val code-box">${uniqueCode}</span>
            </div>
            <div class="card-row" style="margin-bottom:0;">
              <span class="card-label">Issue Date:</span>
              <span class="card-val">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>

          <div class="actions">
            <div>
              <a href="${downloadUrl}" class="btn-download" target="_blank">📥 Download Certificate (PDF)</a>
            </div>
            <div style="margin-top: 12px;">
              <a href="${verifyUrl}" class="btn-secondary" target="_blank">🔍 Verify Online</a>
              <a href="${linkedinAddUrl}" class="btn-linkedin" target="_blank">🔗 Add to LinkedIn</a>
            </div>
          </div>

          <p style="font-size: 13px; color: #64748b; text-align: center; margin-top: 24px;">
            Anyone can verify this credential at any time by scanning the certificate QR code or visiting:<br>
            <a href="${verifyUrl}" style="color: #4f46e5; text-decoration: underline;">${verifyUrl}</a>
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${senderName}. All rights reserved.</p>
          <p>This is an automated transactional email sent to ${recipientEmail}.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: {
          name: senderName,
          email: senderEmail
        },
        to: [
          {
            email: recipientEmail,
            name: recipientName
          }
        ],
        subject: `🎓 Your Certificate: ${certificateTitle || 'Achievement Award'} (${uniqueCode})`,
        htmlContent: htmlContent
      },
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    return {
      success: true,
      messageId: response.data.messageId || 'sent'
    };
  } catch (error) {
    const errData = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('Brevo API Error:', errData);
    return {
      success: false,
      error: errData
    };
  }
}

module.exports = {
  sendCertificateEmail
};
