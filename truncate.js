/**
 * Quick entry point to run DB truncation from backend root
 * Usage:
 *   node truncate.js                 # Truncates all tables and reseeds default admin
 *   node truncate.js --data-only     # Truncates certs, logs, batches (keeps templates & users)
 *   node truncate.js --keep-users    # Truncates templates, certs, batches (keeps users)
 *   node truncate.js --no-reseed     # Truncates everything without reseeding admin
 */
const { truncateAllData, pool } = require('./src/db/truncate');

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
  .catch((err) => {
    console.error('Truncation failed:', err);
    pool.end();
    process.exit(1);
  });

