const { query } = require('../db/neon');

async function analyticsRoutes(fastify, options) {
  // Business Intelligence Dashboard Analytics
  fastify.get('/bi', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      // 1. Core KPIs
      const certCountRes = await query(`
        SELECT 
          COUNT(*) as total_certs,
          COUNT(CASE WHEN status = 'issued' THEN 1 END) as active_certs,
          COUNT(CASE WHEN status = 'revoked' THEN 1 END) as revoked_certs,
          COALESCE(SUM(verified_count), 0) as total_verifications
        FROM certificates
      `);
      const kpis = certCountRes.rows[0];

      const templateCountRes = await query(`SELECT COUNT(*) as total_templates FROM templates`);
      const batchCountRes = await query(`SELECT COUNT(*) as total_batches FROM batches`);

      const emailStatsRes = await query(`
        SELECT 
          COUNT(*) as total_emails,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_emails,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_emails
        FROM email_logs
      `);
      const emailStats = emailStatsRes.rows[0];

      // 2. Template / Course Distribution (Top 6)
      const templateDistRes = await query(`
        SELECT t.name as template_name, COUNT(c.id) as count
        FROM templates t
        LEFT JOIN certificates c ON c.template_id = t.id
        GROUP BY t.id, t.name
        ORDER BY count DESC
        LIMIT 6
      `);

      // 3. Issuance & Verification 7-Day Trend
      const trendRes = await query(`
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '6 days',
            CURRENT_DATE,
            INTERVAL '1 day'
          )::DATE as day
        )
        SELECT 
          TO_CHAR(d.day, 'Mon DD') as label,
          (SELECT COUNT(*) FROM certificates c WHERE c.issued_at::DATE = d.day) as issued_count,
          (SELECT COUNT(*) FROM verification_logs v WHERE v.verified_at::DATE = d.day) as verified_count
        FROM days d
        ORDER BY d.day ASC
      `);

      // 4. Recent Real-time Audit Activity
      const recentActivityRes = await query(`
        SELECT v.id, v.ip, v.verified_at, c.recipient_name, c.unique_code, t.name as template_name
        FROM verification_logs v
        JOIN certificates c ON v.certificate_id = c.id
        JOIN templates t ON c.template_id = t.id
        ORDER BY v.verified_at DESC
        LIMIT 8
      `);

      const totalIssued = parseInt(kpis.total_certs, 10) || 0;
      const totalVerified = parseInt(kpis.total_verifications, 10) || 0;
      const totalTemplates = parseInt(templateCountRes.rows[0].total_templates, 10) || 0;
      const totalBatches = parseInt(batchCountRes.rows[0].total_batches, 10) || 0;
      const totalEmails = parseInt(emailStats.total_emails, 10) || 0;
      const sentEmails = parseInt(emailStats.sent_emails, 10) || 0;

      const verificationRate = totalIssued > 0 ? ((totalVerified / totalIssued) * 100).toFixed(1) : 0;
      const emailSuccessRate = totalEmails > 0 ? ((sentEmails / totalEmails) * 100).toFixed(1) : 100;

      return {
        kpis: {
          totalIssued,
          activeCerts: parseInt(kpis.active_certs, 10) || 0,
          revokedCerts: parseInt(kpis.revoked_certs, 10) || 0,
          totalVerified,
          verificationRate,
          totalTemplates,
          totalBatches,
          totalEmails,
          sentEmails,
          emailSuccessRate
        },
        templateDistribution: templateDistRes.rows,
        trends: trendRes.rows,
        recentActivity: recentActivityRes.rows
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ message: 'Error retrieving BI analytics data', error: err.message });
    }
  });
}

module.exports = analyticsRoutes;
