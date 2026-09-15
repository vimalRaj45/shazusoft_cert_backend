const { query } = require('../db/neon');
const { generateApiKey } = require('../services/apiKeyAuth');

async function apiKeyRoutes(fastify, options) {
  // All management routes require Admin JWT session
  fastify.addHook('preHandler', fastify.authenticate);

  // List all API keys
  fastify.get('/', async (request, reply) => {
    const res = await query(`
      SELECT id, name, key_prefix, permissions, is_active, last_used_at, created_at
      FROM api_keys
      ORDER BY created_at DESC
    `);
    return { keys: res.rows };
  });

  // Create new API key
  fastify.post('/', async (request, reply) => {
    const { name = 'External Website Integration', permissions = ['certificates:issue', 'certificates:read', 'templates:read'] } = request.body || {};

    if (!name || !name.trim()) {
      return reply.code(400).send({ message: 'Key name is required' });
    }

    const { rawKey, keyPrefix, keyHash } = generateApiKey(name.trim());

    const insertRes = await query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, permissions, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, key_prefix, permissions, is_active, created_at`,
      [name.trim(), keyPrefix, keyHash, permissions]
    );

    const record = insertRes.rows[0];

    return {
      message: 'API Key generated successfully. Please copy it now as it will not be shown again.',
      apiKey: rawKey,
      keyRecord: record
    };
  });

  // Toggle active status
  fastify.put('/:id/toggle', async (request, reply) => {
    const { id } = request.params;
    const res = await query(
      `UPDATE api_keys
       SET is_active = NOT is_active
       WHERE id = $1
       RETURNING id, name, key_prefix, is_active`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.code(404).send({ message: 'API key not found' });
    }

    return {
      message: `API Key ${res.rows[0].is_active ? 'activated' : 'deactivated'} successfully`,
      keyRecord: res.rows[0]
    };
  });

  // Delete API key
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const res = await query(`DELETE FROM api_keys WHERE id = $1 RETURNING id`, [id]);

    if (res.rows.length === 0) {
      return reply.code(404).send({ message: 'API key not found' });
    }

    return { message: 'API key deleted successfully' };
  });
}

module.exports = apiKeyRoutes;
