const { query } = require('../db/neon');

/**
 * Resolve template and fields by template_id, association_name, or template_name
 * @param {Object} params
 * @param {string} [params.template_id]
 * @param {string} [params.association_name]
 * @param {string} [params.template_name]
 * @returns {Promise<{ template: Object, fields: Array, mapping?: Object, matchedBy: string } | null>}
 */
async function resolveTemplate({ template_id, association_name, template_name }) {
  let resolvedTemplate = null;
  let matchedBy = null;
  let mappingRecord = null;

  // 1. Direct Template ID match
  if (template_id) {
    const res = await query(`SELECT * FROM templates WHERE id = $1`, [template_id]);
    if (res.rows.length > 0) {
      resolvedTemplate = res.rows[0];
      matchedBy = 'template_id';
    }
  }

  // 2. Association Name mapping match
  if (!resolvedTemplate && association_name) {
    const cleanAssoc = association_name.trim();
    const mapRes = await query(
      `SELECT am.*, t.name as template_name, t.file_url, t.width_px, t.height_px
       FROM association_mappings am
       JOIN templates t ON am.template_id = t.id
       WHERE LOWER(am.association_name) = LOWER($1) AND am.is_active = true
       LIMIT 1`,
      [cleanAssoc]
    );

    if (mapRes.rows.length > 0) {
      mappingRecord = mapRes.rows[0];
      resolvedTemplate = {
        id: mappingRecord.template_id,
        name: mappingRecord.template_name,
        file_url: mappingRecord.file_url,
        width_px: mappingRecord.width_px,
        height_px: mappingRecord.height_px
      };
      matchedBy = 'association_mapping';
    } else {
      // Fallback: Check if any template has the association name in its title
      const fallbackRes = await query(
        `SELECT * FROM templates WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
        [`%${cleanAssoc}%`]
      );
      if (fallbackRes.rows.length > 0) {
        resolvedTemplate = fallbackRes.rows[0];
        matchedBy = 'association_template_name_match';
      }
    }
  }

  // 3. Direct Template Name match
  if (!resolvedTemplate && template_name) {
    const cleanName = template_name.trim();
    // First try exact case-insensitive match
    let nameRes = await query(
      `SELECT * FROM templates WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [cleanName]
    );

    // If not found, try substring match
    if (nameRes.rows.length === 0) {
      nameRes = await query(
        `SELECT * FROM templates WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 1`,
        [`%${cleanName}%`]
      );
    }

    if (nameRes.rows.length > 0) {
      resolvedTemplate = nameRes.rows[0];
      matchedBy = 'template_name';
    }
  }

  if (!resolvedTemplate) {
    return null;
  }

  // Fetch all template field definitions
  const fieldsRes = await query(
    `SELECT * FROM template_fields WHERE template_id = $1 ORDER BY field_key ASC`,
    [resolvedTemplate.id]
  );

  return {
    template: resolvedTemplate,
    fields: fieldsRes.rows,
    mapping: mappingRecord,
    matchedBy
  };
}

/**
 * Get available template choices and associations for error messages / documentation
 */
async function getAvailableChoices() {
  const [templatesRes, mappingsRes] = await Promise.all([
    query(`SELECT id, name FROM templates ORDER BY name ASC`),
    query(`SELECT association_name, template_id FROM association_mappings WHERE is_active = true ORDER BY association_name ASC`)
  ]);

  return {
    templates: templatesRes.rows.map(t => ({ id: t.id, name: t.name })),
    associations: mappingsRes.rows.map(m => m.association_name)
  };
}

module.exports = {
  resolveTemplate,
  getAvailableChoices
};
