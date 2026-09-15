const { query } = require('../db/neon');

async function associationRoutes(fastify, options) {
  // All management routes require Admin JWT session
  fastify.addHook('preHandler', fastify.authenticate);

  // List all association mappings
  fastify.get('/', async (request, reply) => {
    const res = await query(`
      SELECT am.*, t.name as template_name, t.file_url as template_file_url
      FROM association_mappings am
      JOIN templates t ON am.template_id = t.id
      ORDER BY am.created_at DESC
    `);
    return { mappings: res.rows };
  });

  // Create new mapping
  fastify.post('/', async (request, reply) => {
    const {
      association_name,
      template_id,
      default_course_title = '',
      default_issuer_name = 'Shazu Soft Technologies'
    } = request.body || {};

    if (!association_name || !association_name.trim()) {
      return reply.code(400).send({ message: 'Association name is required' });
    }

    if (!template_id) {
      return reply.code(400).send({ message: 'Template ID is required' });
    }

    // Verify template exists
    const templateCheck = await query(`SELECT id, name FROM templates WHERE id = $1`, [template_id]);
    if (templateCheck.rows.length === 0) {
      return reply.code(404).send({ message: 'Selected template not found' });
    }

    // Check duplicate association name
    const dupCheck = await query(
      `SELECT id FROM association_mappings WHERE LOWER(association_name) = LOWER($1)`,
      [association_name.trim()]
    );
    if (dupCheck.rows.length > 0) {
      return reply.code(409).send({ message: `A mapping for association "${association_name.trim()}" already exists.` });
    }

    const insertRes = await query(
      `INSERT INTO association_mappings (association_name, template_id, default_course_title, default_issuer_name, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [association_name.trim(), template_id, default_course_title.trim(), default_issuer_name.trim()]
    );

    return {
      message: 'Association mapping created successfully',
      mapping: {
        ...insertRes.rows[0],
        template_name: templateCheck.rows[0].name
      }
    };
  });

  // Update existing mapping
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      association_name,
      template_id,
      default_course_title,
      default_issuer_name,
      is_active
    } = request.body || {};

    const existing = await query(`SELECT * FROM association_mappings WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ message: 'Association mapping not found' });
    }

    const current = existing.rows[0];
    const newAssocName = association_name !== undefined ? association_name.trim() : current.association_name;
    const newTemplateId = template_id || current.template_id;
    const newCourseTitle = default_course_title !== undefined ? default_course_title.trim() : current.default_course_title;
    const newIssuerName = default_issuer_name !== undefined ? default_issuer_name.trim() : current.default_issuer_name;
    const newIsActive = is_active !== undefined ? !!is_active : current.is_active;

    const res = await query(
      `UPDATE association_mappings
       SET association_name = $1, template_id = $2, default_course_title = $3, default_issuer_name = $4, is_active = $5
       WHERE id = $6
       RETURNING *`,
      [newAssocName, newTemplateId, newCourseTitle, newIssuerName, newIsActive, id]
    );

    return {
      message: 'Association mapping updated successfully',
      mapping: res.rows[0]
    };
  });

  // Delete mapping
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const res = await query(`DELETE FROM association_mappings WHERE id = $1 RETURNING id`, [id]);

    if (res.rows.length === 0) {
      return reply.code(404).send({ message: 'Association mapping not found' });
    }

    return { message: 'Association mapping deleted successfully' };
  });
}

module.exports = associationRoutes;
