const { query } = require('../db/neon');

async function batchRoutes(fastify, options) {
  // List all batches
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const res = await query(`
      SELECT b.*, t.name as template_name
      FROM batches b
      LEFT JOIN templates t ON b.template_id = t.id
      ORDER BY b.created_at DESC
      LIMIT 100
    `);
    return { batches: res.rows };
  });

  // Get single batch status & progress
  fastify.get('/:id/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const batchRes = await query(`
      SELECT b.*, t.name as template_name
      FROM batches b
      LEFT JOIN templates t ON b.template_id = t.id
      WHERE b.id = $1
    `, [id]);

    if (batchRes.rows.length === 0) {
      return reply.code(404).send({ message: 'Batch not found' });
    }

    return { batch: batchRes.rows[0] };
  });
}

module.exports = batchRoutes;
