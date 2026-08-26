const bcrypt = require('bcryptjs');
const { query } = require('../db/neon');
const { sendOtpEmail } = require('../services/hostingerService');

// In-memory OTP Cache: Map<email, { otp, expiresAt, attempts }>
const otpStore = new Map();

function getAllowedAdminEmails() {
  const envEmails = process.env.ALLOWED_ADMIN_EMAILS || 'admin@shazusoft.com,info@shazusofttechnologies.org';
  return envEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function authRoutes(fastify, options) {
  // 1. Request Login OTP (Restricted to ALLOWED_ADMIN_EMAILS in .env)
  fastify.post('/request-otp', async (request, reply) => {
    const { email } = request.body || {};

    if (!email) {
      return reply.code(400).send({ message: 'Email address is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const allowedEmails = getAllowedAdminEmails();

    // Enforce Allowed Emails Security Filter
    if (!allowedEmails.includes(normalizedEmail)) {
      return reply.code(403).send({
        message: 'Access Denied: This email is not authorized for Admin Console access. Please contact administrator.'
      });
    }

    // Generate Secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 Minutes Expiration

    otpStore.set(normalizedEmail, {
      otp,
      expiresAt,
      attempts: 0
    });

    try {
      // Send OTP via Hostinger Mail API SDK
      await sendOtpEmail({
        recipientEmail: normalizedEmail,
        otp
      });

      return {
        success: true,
        message: `Security OTP sent to ${normalizedEmail}. Please check your inbox.`,
        expiresInSeconds: 300
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        message: 'Failed to dispatch OTP email via Hostinger Mail service. Please try again.',
        error: err.message
      });
    }
  });

  // 2. Verify OTP & Authenticate
  fastify.post('/verify-otp', async (request, reply) => {
    const { email, otp } = request.body || {};

    if (!email || !otp) {
      return reply.code(400).send({ message: 'Email and 6-digit verification code are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
      return reply.code(400).send({ message: 'No active OTP request found. Please request a new verification code.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(normalizedEmail);
      return reply.code(400).send({ message: 'Verification code has expired. Please request a new code.' });
    }

    if (record.attempts >= 5) {
      otpStore.delete(normalizedEmail);
      return reply.code(429).send({ message: 'Too many incorrect attempts. Please request a new code.' });
    }

    if (record.otp !== otp.toString().trim()) {
      record.attempts += 1;
      return reply.code(401).send({ message: `Invalid verification code. ${5 - record.attempts} attempts remaining.` });
    }

    // OTP Verified Successfully -> Clear from store
    otpStore.delete(normalizedEmail);

    // Look up or create Admin user in DB
    let userRes = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    let user;

    if (userRes.rows.length === 0) {
      const defaultName = normalizedEmail.split('@')[0].toUpperCase() + ' Admin';
      const dummyHash = await bcrypt.hash('Admin@123', 10);
      const createRes = await query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin') RETURNING *`,
        [normalizedEmail, dummyHash, defaultName]
      );
      user = createRes.rows[0];
    } else {
      user = userRes.rows[0];
    }

    // Generate Signed JWT
    const token = fastify.jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };
  });

  // 3. Fallback Password Login (still restricted by allowed emails)
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.code(400).send({ message: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const allowedEmails = getAllowedAdminEmails();

    if (!allowedEmails.includes(normalizedEmail)) {
      return reply.code(403).send({ message: 'Access Denied: This email is not authorized for Admin Console access.' });
    }

    const userRes = await query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (userRes.rows.length === 0) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    };
  });

  // Get current user profile
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userRes = await query('SELECT id, email, name, role, created_at FROM users WHERE id = $1', [request.user.id]);
    if (userRes.rows.length === 0) {
      return reply.code(404).send({ message: 'User not found' });
    }
    return { user: userRes.rows[0] };
  });

  // Get allowed emails list for login assistance
  fastify.get('/allowed-domains', async () => {
    const emails = getAllowedAdminEmails();
    return {
      count: emails.length,
      allowedEmails: emails
    };
  });
}

module.exports = authRoutes;
