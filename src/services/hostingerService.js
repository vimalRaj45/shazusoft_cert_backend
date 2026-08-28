const { Configuration, AccountApi, SendApi } = require('hostinger-mail-api-sdk');

let cachedMailboxId = null;

async function getMailboxId(config) {
  if (cachedMailboxId) return cachedMailboxId;
  try {
    const accountApi = new AccountApi(config);
    const res = await accountApi.getCurrentAccount();
    const mailboxes = res.data?.data?.mailboxes || [];
    if (mailboxes.length > 0) {
      cachedMailboxId = mailboxes[0].resourceId;
      return cachedMailboxId;
    }
  } catch (err) {
    console.error('Error fetching Hostinger mailbox id:', err.message);
  }
  return 'AC27733647b7b2b04cefeca882d854';
}

/**
 * Send Transactional Certificate Email via Hostinger Mail API SDK
 */
async function sendCertificateEmail({
  recipientEmail,
  recipientName,
  courseTitle,
  certificateTitle,
  certificateCode,
  uniqueCode,
  downloadUrl,
  verifyUrl,
  issuerName = 'Shazu Soft Technologies'
}) {
  const apiKey = process.env.HOSTINGER_API_KEY;
  const senderName = process.env.HOSTINGER_SENDER_NAME || 'Shazu Soft Technologies';

  const title = courseTitle || certificateTitle || 'Certificate of Achievement';
  const code = certificateCode || uniqueCode || '';

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const apiUrl = process.env.PUBLIC_API_URL || 'http://localhost:5000';

  const finalDownloadUrl = downloadUrl || `${apiUrl}/api/public/certificates/${code}/download`;
  const finalVerifyUrl = verifyUrl || `${frontendUrl}/verify/${code}`;

  const config = new Configuration({ accessToken: apiKey });
  const sendApi = new SendApi(config);
  const mailboxId = await getMailboxId(config);

  const subject = `🎓 Official Certificate of Achievement: ${title}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Official Certificate</title>
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F5F3EC; margin: 0; padding: 20px; color: #26322E; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #D3DDD7; box-shadow: 0 4px 12px rgba(18, 59, 50, 0.08); }
    .header { background: linear-gradient(135deg, #123B32 0%, #2F5B4E 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0 0; font-size: 13px; color: #E8EFEB; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 18px; font-weight: 600; color: #123B32; margin-bottom: 12px; }
    .message { font-size: 14px; line-height: 1.6; color: #334E43; margin-bottom: 24px; }
    .card { background: #E8EFEB; border: 1px solid #D3DDD7; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center; }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #527A68; letter-spacing: 0.05em; margin-bottom: 6px; }
    .card-course { font-size: 18px; font-weight: 700; color: #123B32; margin-bottom: 10px; }
    .card-code { font-family: monospace; font-size: 13px; color: #123B32; background: #ffffff; padding: 6px 12px; border-radius: 6px; display: inline-block; border: 1px solid #D3DDD7; font-weight: bold; }
    .btn-group { text-align: center; margin-bottom: 24px; }
    .btn-primary { display: inline-block; background: #123B32; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-right: 8px; margin-bottom: 8px; }
    .btn-secondary { display: inline-block; background: #ffffff; color: #123B32 !important; text-decoration: none; padding: 14px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; border: 1.5px solid #123B32; margin-bottom: 8px; }
    .footer { background: #F5F3EC; padding: 20px; text-align: center; font-size: 12px; color: #527A68; border-top: 1px solid #D3DDD7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${issuerName}</h1>
      <p>Official Credential Authentication System</p>
    </div>
    <div class="content">
      <div class="greeting">Congratulations, ${recipientName}!</div>
      <p class="message">
        We are pleased to inform you that your official credential for <strong>"${title}"</strong> has been authenticated and permanently recorded.
      </p>
      
      <div class="card">
        <div class="card-title">Authenticated Credential</div>
        <div class="card-course">${title}</div>
        <div class="card-code">Certificate ID: ${code}</div>
      </div>

      <div class="btn-group">
        <a href="${finalDownloadUrl}" class="btn-primary">Download Official Certificate (PDF)</a>
        <a href="${finalVerifyUrl}" class="btn-secondary">View & Share on LinkedIn</a>
      </div>

      <p class="message" style="font-size: 12px; color: #527A68; text-align: center;">
        Your high-resolution PDF certificate is generated securely on-demand with anti-tamper QR code verification.
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} ${issuerName}. All rights reserved.<br>
      This is an automated transactional message.
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `
Congratulations, ${recipientName}!

Your official certificate for "${courseTitle}" from ${issuerName} is ready.

Certificate ID: ${certificateCode}

Download Official Certificate (PDF): ${downloadUrl}
Public Verification & LinkedIn Share: ${verifyUrl}

Authenticated by ${issuerName}.
  `;

  const payload = {
    to: [recipientEmail],
    displayName: senderName,
    subject: subject,
    text: textContent,
    html: htmlContent
  };

  try {
    const response = await sendApi.sendEmail(mailboxId, payload);
    return { success: true, messageId: response.data?.messageId || 'hostinger-sent' };
  } catch (error) {
    console.error('Hostinger Mail SDK Send Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || error.message);
  }
}

/**
 * Send Security Login OTP Email via Hostinger Mail API SDK
 */
async function sendOtpEmail({ recipientEmail, otp, issuerName = 'Shazu Soft Technologies' }) {
  const apiKey = process.env.HOSTINGER_API_KEY;
  const senderName = process.env.HOSTINGER_SENDER_NAME || 'Shazu Soft Technologies';

  const config = new Configuration({ accessToken: apiKey });
  const sendApi = new SendApi(config);
  const mailboxId = await getMailboxId(config);

  const subject = `🔐 Your Admin Login Verification Code: ${otp}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login Verification</title>
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F5F3EC; margin: 0; padding: 20px; color: #26322E; }
    .container { max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1.5px solid #D3DDD7; box-shadow: 0 4px 12px rgba(18, 59, 50, 0.08); }
    .header { background: linear-gradient(135deg, #123B32 0%, #2F5B4E 100%); padding: 28px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .header p { margin: 4px 0 0 0; font-size: 13px; color: #E8EFEB; }
    .content { padding: 32px 24px; text-align: center; }
    .message { font-size: 14px; line-height: 1.6; color: #334E43; margin-bottom: 24px; }
    .otp-box { background: #E8EFEB; border: 2px dashed #123B32; border-radius: 12px; padding: 18px; margin: 0 auto 24px auto; display: inline-block; }
    .otp-code { font-family: monospace; font-size: 34px; font-weight: 800; color: #123B32; letter-spacing: 8px; margin: 0; }
    .expiry { font-size: 12px; color: #C47D4C; font-weight: 600; margin-bottom: 16px; }
    .footer { background: #F5F3EC; padding: 16px; text-align: center; font-size: 12px; color: #527A68; border-top: 1px solid #D3DDD7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${issuerName}</h1>
      <p>Admin Console Access Verification</p>
    </div>
    <div class="content">
      <p class="message">
        We received a sign-in request for your authorized administrator account: <strong>${recipientEmail}</strong>.
      </p>
      
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>

      <div class="expiry">⏱️ This code will expire in 5 minutes.</div>

      <p style="font-size: 12px; color: #527A68; line-height: 1.5; margin: 0;">
        If you did not request this verification code, please ignore this email or contact security.
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} ${issuerName}. Enterprise Security.
    </div>
  </div>
</body>
</html>
  `;

  const payload = {
    to: [recipientEmail],
    displayName: senderName,
    subject: subject,
    text: `Your Admin Login Verification Code is: ${otp}. It will expire in 5 minutes.`,
    html: htmlContent
  };

  try {
    const response = await sendApi.sendEmail(mailboxId, payload);
    return { success: true, messageId: response.data?.messageId || 'hostinger-otp-sent' };
  } catch (error) {
    console.error('Hostinger OTP Send Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error || error.message);
  }
}

module.exports = {
  sendCertificateEmail,
  sendOtpEmail
};
