const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { pool } = require('./neon');

const TABLES = [
  'verification_logs',
  'email_logs',
  'certificates',
  'batches',
  'template_fields',
  'templates',
  'users'
];

async function getTableCounts(client) {
  const counts = {};
  for (const table of TABLES) {
    try {
      const res = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
      counts[table] = parseInt(res.rows[0].count, 10);
    } catch (e) {
      counts[table] = 'N/A';
    }
  }
  return counts;
}

async function truncateAllData(options = {}) {
  const {
    keepUsers = false,
    keepTemplates = false,
    reseedAdmin = true
  } = options;

  const client = await pool.connect();
  try {
    console.log('====================================================');
    console.log('       DATABASE TRUNCATION & RESET SCRIPT           ');
    console.log('====================================================');
    console.log(`Connected to Database: ${process.env.DATABASE_URL ? 'Neon PostgreSQL' : 'Unknown'}`);
    
    console.log('\n[1/3] Fetching table counts before truncation...');
    const initialCounts = await getTableCounts(client);
    console.table(initialCounts);

    console.log('\n[2/3] Truncating tables...');
    await client.query('BEGIN');

    if (keepTemplates && keepUsers) {
      // Truncate only operational data
      console.log(' -> Truncating verification_logs, email_logs, certificates, batches...');
      await client.query(`TRUNCATE TABLE verification_logs, email_logs, certificates, batches CASCADE;`);
    } else if (keepUsers) {
      // Truncate templates and operational data, keep users
      console.log(' -> Truncating verification_logs, email_logs, certificates, batches, template_fields, templates...');
      await client.query(`TRUNCATE TABLE verification_logs, email_logs, certificates, batches, template_fields, templates CASCADE;`);
    } else {
      // Truncate all tables
      console.log(' -> Truncating ALL tables (verification_logs, email_logs, certificates, batches, template_fields, templates, users)...');
      await client.query(`TRUNCATE TABLE verification_logs, email_logs, certificates, batches, template_fields, templates, users CASCADE;`);

      if (reseedAdmin) {
        console.log(' -> Re-seeding default administrator (admin@shazusoft.com)...');
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123';
        const hash = await bcrypt.hash(defaultPassword, 10);
        await client.query(
          `INSERT INTO users (email, name, role, password_hash)
           VALUES ($1, $2, $3, $4)`,
          ['admin@shazusoft.com', 'System Administrator', 'admin', hash]
        );
        console.log(`    Created default admin: admin@shazusoft.com / ${defaultPassword}`);
      }
    }

    await client.query('COMMIT');
    console.log(' -> Truncation committed successfully!');

    console.log('\n[3/3] Fetching table counts after truncation...');
    const finalCounts = await getTableCounts(client);
    console.table(finalCounts);

    console.log('====================================================');
    console.log(' Database truncation completed successfully!         ');
    console.log('====================================================\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during database truncation:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Support running via CLI directly: node truncate.js
if (require.main === module) {
  const args = process.argv.slice(2);
  const dataOnly = args.includes('--data-only');
  const keepUsers = args.includes('--keep-users') || dataOnly;
  const keepTemplates = args.includes('--keep-templates') || dataOnly;
  const noReseed = args.includes('--no-reseed');

  truncateAllData({
    keepUsers,
    keepTemplates,
    reseedAdmin: !noReseed
  })
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch(() => {
      pool.end();
      process.exit(1);
    });
}

module.exports = { truncateAllData, pool };
