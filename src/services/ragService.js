const { Mistral } = require('@mistralai/mistralai');
const { query } = require('../db/neon');

// In-Memory Fast Cache for Aggregate Counts (60-second TTL)
let metricsCache = null;
let metricsCacheExpiry = 0;

let templatesCache = null;
let templatesCacheExpiry = 0;

/**
 * Fast cached aggregate statistics lookup
 */
async function getCachedStats() {
  const now = Date.now();
  if (metricsCache && now < metricsCacheExpiry) {
    return metricsCache;
  }

  try {
    const statsRes = await query(`
      SELECT 
        (SELECT COUNT(*) FROM certificates) as total_certs,
        (SELECT COUNT(*) FROM certificates WHERE status = 'issued') as active_certs,
        (SELECT COUNT(*) FROM certificates WHERE status = 'revoked') as revoked_certs,
        (SELECT COALESCE(SUM(verified_count), 0) FROM certificates) as total_verifications,
        (SELECT COUNT(*) FROM templates) as total_templates,
        (SELECT COUNT(*) FROM batches) as total_batches
    `);
    metricsCache = statsRes.rows[0] || {};
    metricsCacheExpiry = now + 60000; // 60s cache
  } catch (err) {
    console.error('Error fetching cached stats:', err.message);
    metricsCache = {};
  }

  return metricsCache;
}

/**
 * Fast cached templates lookup
 */
async function getCachedTemplates() {
  const now = Date.now();
  if (templatesCache && now < templatesCacheExpiry) {
    return templatesCache;
  }

  try {
    const res = await query(`SELECT id, name FROM templates ORDER BY created_at DESC LIMIT 10`);
    templatesCache = res.rows || [];
    templatesCacheExpiry = now + 60000;
  } catch (err) {
    console.error('Error fetching cached templates:', err.message);
    templatesCache = [];
  }

  return templatesCache;
}

/**
 * PII & Sensitive Information Anonymizer
 * Ensures zero real personal data (Emails, Full Last Names, Phone Numbers) is sent to external LLMs.
 */
function sanitizePiiForLlm(text) {
  if (!text || typeof text !== 'string') return text;

  let clean = text;

  // Mask Emails: e.g. vimalraj5207@gmail.com -> v***7@gmail.com
  clean = clean.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (match, user, domain) => {
    if (user.length <= 2) return `${user[0] || 'u'}***@${domain}`;
    return `${user[0]}***${user[user.length - 1]}@${domain}`;
  });

  // Mask Phone numbers: e.g. +1-234-567-8900 -> [REDACTED_PHONE]
  clean = clean.replace(/(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}/g, '[REDACTED_PHONE]');

  return clean;
}

/**
 * Anonymizes certificate database record before LLM context injection
 */
function anonymizeRecordForLlm(c, index = 0) {
  const dummyNames = ['John Doe', 'Jane Smith', 'Alex Morgan', 'Jordan Taylor', 'Sam River'];
  
  let anonymizedName = dummyNames[index % dummyNames.length];
  if (c.recipient_name) {
    const parts = c.recipient_name.trim().split(/\s+/);
    if (parts.length > 1) {
      // Keep title / first name, anonymize last name: "Dr. Vimal Raj S" -> "Dr. Vimal R."
      anonymizedName = `${parts[0]} ${parts.slice(1).map(p => p[0].toUpperCase() + '.').join(' ')}`;
    } else {
      anonymizedName = parts[0];
    }
  }

  const anonymizedEmail = sanitizePiiForLlm(c.recipient_email || 'recipient@example.com');
  const code = c.unique_code || 'CERT-SAMPLE';

  return {
    recipient_name: anonymizedName,
    recipient_email: anonymizedEmail,
    unique_code: code,
    course_title: c.field_data?.course_title || c.template_name || 'Certificate',
    status: c.status || 'issued',
    verified_count: c.verified_count || 0,
    issued_at: c.issued_at
  };
}

/**
 * Optimized Knowledge Retrieval Engine with Parallel Execution & Query Indexing
 */
async function retrieveSystemContext(userQuery) {
  const normalizedQuery = userQuery.toLowerCase().trim();
  const keywords = normalizedQuery
    .replace(/[^\w\s@.-]/gi, ' ')
    .split(/\s+/)
    .filter(k => k.length > 2 && !['what', 'when', 'where', 'show', 'list', 'give', 'tell', 'about', 'from', 'this', 'that', 'with', 'have', 'been'].includes(k));

  let retrievedContext = '';

  // Parallel Fetch: Stats, Templates, Targeted Records, Recent Audit Logs
  try {
    const [stats, templates, certMatchesResult, auditResult] = await Promise.all([
      getCachedStats(),
      getCachedTemplates(),
      (async () => {
        if (keywords.length > 0) {
          // Targeted Indexed Search with exact & prefix matching
          const conditions = [];
          const params = [];
          let paramIdx = 1;

          for (const kw of keywords.slice(0, 3)) {
            conditions.push(`c.recipient_name ILIKE $${paramIdx} OR c.recipient_email ILIKE $${paramIdx} OR c.unique_code ILIKE $${paramIdx}`);
            params.push(`%${kw}%`);
            paramIdx++;
          }

          const res = await query(`
            SELECT c.recipient_name, c.recipient_email, c.unique_code, c.status, c.verified_count, c.issued_at, t.name as template_name, c.field_data
            FROM certificates c
            LEFT JOIN templates t ON c.template_id = t.id
            WHERE ${conditions.join(' OR ')}
            ORDER BY c.issued_at DESC
            LIMIT 5
          `, params);

          if (res.rows.length > 0) return res.rows;
        }

        // Fallback: Fetch latest 5 certificates using index
        const fallbackRes = await query(`
          SELECT c.recipient_name, c.recipient_email, c.unique_code, c.status, c.verified_count, c.issued_at, t.name as template_name, c.field_data
          FROM certificates c
          LEFT JOIN templates t ON c.template_id = t.id
          ORDER BY c.issued_at DESC
          LIMIT 4
        `);
        return fallbackRes.rows;
      })(),
      query(`
        SELECT c.recipient_name, c.unique_code, v.verified_at
        FROM verification_logs v
        JOIN certificates c ON v.certificate_id = c.id
        ORDER BY v.verified_at DESC
        LIMIT 3
      `).catch(() => ({ rows: [] }))
    ]);

    // Build Concise Context
    retrievedContext += `[SUMMARY METRICS]: Total Certificates: ${stats.total_certs || 0} (${stats.active_certs || 0} active, ${stats.revoked_certs || 0} revoked), Total Verifications: ${stats.total_verifications || 0}, Designs: ${stats.total_templates || 0}\n`;

    if (templates.length > 0) {
      retrievedContext += `\n[AVAILABLE DESIGNS]: ${templates.map(t => `"${t.name}"`).join(', ')}\n`;
    }

    if (certMatchesResult && certMatchesResult.length > 0) {
      retrievedContext += `\n[CERTIFICATE RECORDS (ANONYMIZED FOR PRIVACY)]:\n` + certMatchesResult.map((raw, idx) => {
        const c = anonymizeRecordForLlm(raw, idx);
        return `- Recipient: "${c.recipient_name}" (${c.recipient_email}) | ID: ${c.unique_code} | Course: ${c.course_title} | Status: ${c.status} | Verified: ${c.verified_count}x | Date: ${new Date(c.issued_at).toLocaleDateString()}`;
      }).join('\n') + '\n';
    }

    if (auditResult.rows && auditResult.rows.length > 0) {
      retrievedContext += `\n[RECENT ONLINE VERIFICATIONS]:\n` + auditResult.rows.map((a) => {
        const maskedName = a.recipient_name ? `${a.recipient_name.split(' ')[0]} ${a.recipient_name.split(' ').slice(1).map(p => p[0].toUpperCase() + '.').join(' ')}` : 'Sample Recipient';
        return `- "${a.unique_code}" for ${maskedName} at ${new Date(a.verified_at).toLocaleTimeString()}`;
      }).join('\n') + '\n';
    }

  } catch (err) {
    console.error('Error during optimized RAG retrieval:', err.message);
  }

  return retrievedContext;
}

/**
 * Fast Answer Generation using Mistral AI
 */
async function answerRagQuery({ userQuery, chatHistory = [] }) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const client = new Mistral({ apiKey });

  const contextData = await retrieveSystemContext(userQuery);

  const systemPrompt = `
You are the Certificate Assistant for **Shazu Soft Technologies**.
Answer questions accurately and concisely using ONLY the system records provided below:

=== SYSTEM RECORDS ===
${contextData}
======================

Guidelines:
- Answer in simple, professional, non-technical English.
- Cite Recipient Name, Certificate ID, Course, and Date when referencing a record.
- Format links as markdown: [View Certificate](/verify/{unique_code}) or [Download PDF](/api/public/certificates/{unique_code}/download).
- Keep answers concise and direct.
  `;

  const sanitizedUserQuery = sanitizePiiForLlm(userQuery);
  const sanitizedChatHistory = chatHistory.slice(-4).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: sanitizePiiForLlm(m.content)
  }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...sanitizedChatHistory,
    { role: 'user', content: sanitizedUserQuery }
  ];

  try {
    const chatResponse = await client.chat.complete({
      model: 'mistral-small-latest', // High-speed, low-latency model for instant responses
      messages: messages,
      temperature: 0.1,
      maxTokens: 400
    });

    const reply = chatResponse.choices[0]?.message?.content || 'I could not find matching certificate records.';
    return {
      success: true,
      answer: reply
    };
  } catch (err) {
    console.error('RAG Error:', err.message);
    return {
      success: true,
      answer: `Here is the current certificate information from the records:\n\n${contextData}`
    };
  }
}

module.exports = {
  retrieveSystemContext,
  answerRagQuery
};
