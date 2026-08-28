const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDB() {
  const client = await pool.connect();
  try {
    console.log('Connected to Neon PostgreSQL. Running schema initialization...');

    // gen_random_uuid() is built-in in modern PostgreSQL (v13+)
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    } catch (e) {
      // pgcrypto may already be enabled
    }

    // 1. Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin','user')),
        password_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        width_px INT NOT NULL DEFAULT 1920,
        height_px INT NOT NULL DEFAULT 1080,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 3. Template Fields table (stored as percentage of width & height)
    await client.query(`
      CREATE TABLE IF NOT EXISTS template_fields (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
        field_key TEXT NOT NULL,
        label TEXT NOT NULL,
        x NUMERIC NOT NULL,
        y NUMERIC NOT NULL,
        font_family TEXT DEFAULT 'sans-serif',
        font_size INT DEFAULT 28,
        font_color TEXT DEFAULT '#1e293b',
        font_weight TEXT DEFAULT 'normal',
        align TEXT DEFAULT 'center',
        opacity NUMERIC DEFAULT 1.0,
        is_required BOOLEAN DEFAULT true,
        is_qr BOOLEAN DEFAULT false,
        is_underline BOOLEAN DEFAULT false
      );
      ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS opacity NUMERIC DEFAULT 1.0;
      ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS is_underline BOOLEAN DEFAULT false;
    `);

    // 4. Batches table
    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
        template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
        source TEXT CHECK (source IN ('csv','form')),
        filename TEXT,
        total_records INT DEFAULT 0,
        processed_records INT DEFAULT 0,
        status TEXT DEFAULT 'processing',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 5. Certificates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS certificates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
        template_id UUID REFERENCES templates(id) ON DELETE RESTRICT,
        recipient_email TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        unique_code TEXT UNIQUE NOT NULL,
        field_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'issued' CHECK (status IN ('issued','revoked')),
        issued_at TIMESTAMPTZ DEFAULT now(),
        verified_count INT DEFAULT 0
      );
    `);

    // 6. Email Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        certificate_id UUID REFERENCES certificates(id) ON DELETE CASCADE,
        brevo_message_id TEXT,
        status TEXT DEFAULT 'sent',
        error_message TEXT,
        sent_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 7. Verification Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        certificate_id UUID REFERENCES certificates(id) ON DELETE CASCADE,
        ip TEXT,
        user_agent TEXT,
        verified_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Performance Indexes for Instant RAG & Search Lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_certs_recipient_email ON certificates(recipient_email);
      CREATE INDEX IF NOT EXISTS idx_certs_recipient_name ON certificates(recipient_name);
      CREATE INDEX IF NOT EXISTS idx_certs_unique_code ON certificates(unique_code);
      CREATE INDEX IF NOT EXISTS idx_certs_issued_at ON certificates(issued_at DESC);
      CREATE INDEX IF NOT EXISTS idx_certs_status ON certificates(status);
      CREATE INDEX IF NOT EXISTS idx_verification_logs_cert_id ON verification_logs(certificate_id);
      CREATE INDEX IF NOT EXISTS idx_verification_logs_verified_at ON verification_logs(verified_at DESC);
    `);

    // Check and seed default admin
    const adminCheck = await client.query(`SELECT id FROM users WHERE email = $1`, ['admin@shazusoft.com']);
    let adminId;
    if (adminCheck.rows.length === 0) {
      const defaultPassword = 'Admin@123';
      const hash = await bcrypt.hash(defaultPassword, 10);
      const insertAdmin = await client.query(
        `INSERT INTO users (email, name, role, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['admin@shazusoft.com', 'System Administrator', 'admin', hash]
      );
      adminId = insertAdmin.rows[0].id;
      console.log('Seeded default admin user: admin@shazusoft.com / Admin@123');
    } else {
      adminId = adminCheck.rows[0].id;
    }

    console.log('Database initialization completed successfully.');
  } catch (err) {
    console.error('Error during database initialization:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDB,
  query: (text, params) => pool.query(text, params)
};
