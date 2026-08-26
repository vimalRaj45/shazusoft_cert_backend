const { nanoid } = require('nanoid');
const { query } = require('../db/neon');
const { sendCertificateEmail } = require('./hostingerService');

// In-memory queue with rate-limited dispatch
class BulkQueueService {
  constructor() {
    this.activeJobs = new Map();
    this.batchDelayMs = 400; // ~150 emails/min safe rate
  }

  /**
   * Process a bulk issuance job in the background
   * @param {Object} params
   * @param {string} params.batchId
   * @param {string} params.templateId
   * @param {Array} params.records Array of { recipient_email, recipient_name, field_data }
   * @param {string} params.courseTitle
   * @param {boolean} params.sendEmail
   */
  async processBulkBatch({ batchId, templateId, records, courseTitle = 'Certification', sendEmail = true }) {
    console.log(`Starting bulk processing for batch ${batchId} (${records.length} records)`);
    
    let processed = 0;

    for (const row of records) {
      try {
        const uniqueCode = nanoid(21);
        const fieldData = row.field_data || {};

        // Insert certificate
        const certRes = await query(
          `INSERT INTO certificates 
           (batch_id, template_id, recipient_email, recipient_name, unique_code, field_data, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'issued')
           RETURNING id, unique_code, recipient_email, recipient_name`,
          [
            batchId,
            templateId,
            row.recipient_email,
            row.recipient_name,
            uniqueCode,
            JSON.stringify(fieldData)
          ]
        );

        const cert = certRes.rows[0];

        // Send Brevo Email if requested
        if (sendEmail && row.recipient_email) {
          const emailRes = await sendCertificateEmail({
            recipientEmail: row.recipient_email,
            recipientName: row.recipient_name,
            certificateTitle: fieldData.course_title || fieldData.course || courseTitle,
            uniqueCode: cert.unique_code
          });

          // Log email status
          await query(
            `INSERT INTO email_logs (certificate_id, brevo_message_id, status, error_message)
             VALUES ($1, $2, $3, $4)`,
            [
              cert.id,
              emailRes.messageId || null,
              emailRes.success ? 'sent' : 'failed',
              emailRes.error || null
            ]
          );
        }

        processed++;

        // Update batch progress every 5 records or at end
        if (processed % 5 === 0 || processed === records.length) {
          await query(
            `UPDATE batches SET processed_records = $1 WHERE id = $2`,
            [processed, batchId]
          );
        }

        // Throttle to respect Brevo API limits
        if (sendEmail) {
          await new Promise((resolve) => setTimeout(resolve, this.batchDelayMs));
        }
      } catch (err) {
        console.error(`Error processing record for ${row.recipient_email} in batch ${batchId}:`, err.message);
      }
    }

    // Mark batch complete
    await query(
      `UPDATE batches SET status = 'completed', processed_records = $1 WHERE id = $2`,
      [processed, batchId]
    );

    console.log(`Completed batch ${batchId}. Total processed: ${processed}/${records.length}`);
  }
}

const queueService = new BulkQueueService();

module.exports = {
  queueService
};
