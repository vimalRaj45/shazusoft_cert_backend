const crypto = require('crypto');
const { query } = require('../db/neon');

/**
 * Hash raw API key using SHA-256
 */
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generate a new API Key with live prefix
 */
function generateApiKey(name = 'External Website') {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  const rawKey = `cv_live_${randomBytes}`;
  const keyPrefix = rawKey.substring(0, 16); // e.g. "cv_live_1a2b3c4d"
  const keyHash = hashKey(rawKey);

  return {
    rawKey,
    keyPrefix,
    keyHash,
    name
  };
}

/**
 * Fastify preHandler hook to validate external API Key
 */
async function authenticateApiKey(request, reply) {
  // Check X-API-Key header or Authorization: Bearer <key>
  let rawKey = request.headers['x-api-key'];
  if (!rawKey && request.headers.authorization) {
    const parts = request.headers.authorization.split(' ');
    if (parts.length === 2 && (parts[0].toLowerCase() === 'bearer' || parts[0].toLowerCase() === 'apikey')) {
      rawKey = parts[1];
    }
  }

  if (!rawKey) {
    return reply.code(401).send({
      success: false,
      error: 'Unauthorized',
      message: 'Missing API Key. Please provide X-API-Key header or Authorization: Bearer <key>.'
    });
  }

  rawKey = rawKey.trim();
  const keyPrefix = rawKey.substring(0, 16);
  const calculatedHash = hashKey(rawKey);

  try {
    const res = await query(
      `SELECT * FROM api_keys WHERE key_prefix = $1 AND is_active = true`,
      [keyPrefix]
    );

    if (res.rows.length === 0) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or inactive API Key.'
      });
    }

    const keyRecord = res.rows[0];

    // Constant-time comparison to prevent timing attacks
    const hashBuf = Buffer.from(keyRecord.key_hash, 'hex');
    const calcBuf = Buffer.from(calculatedHash, 'hex');

    if (hashBuf.length !== calcBuf.length || !crypto.timingSafeEqual(hashBuf, calcBuf)) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid API Key secret.'
      });
    }

    // Asynchronously update last_used_at without blocking response
    query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [keyRecord.id]).catch((err) => {
      console.warn('Failed to update api_key last_used_at:', err.message);
    });

    // Attach API key context to request
    request.apiKey = keyRecord;
  } catch (err) {
    console.error('API key verification error:', err);
    return reply.code(500).send({
      success: false,
      error: 'InternalServerError',
      message: 'Failed to verify API credentials'
    });
  }
}

module.exports = {
  hashKey,
  generateApiKey,
  authenticateApiKey
};
