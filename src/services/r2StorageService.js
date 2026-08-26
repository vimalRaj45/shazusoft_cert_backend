const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '0062c9f9a7ea658980e06d881142fd14';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'shazusofttempate';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://pub-1e694a905cc948daa41632716cb85e30.r2.dev').replace(/\/+$/, '');
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

let s3Client = null;

function getS3Client() {
  if (!s3Client && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY
      }
    });
  }
  return s3Client;
}

/**
 * Upload a file to Cloudflare R2 bucket
 */
async function uploadToR2({ fileBuffer, fileName, mimeType }) {
  const client = getS3Client();
  if (!client) {
    return null; // Fallback to local uploads if R2 credentials not set
  }

  const key = `templates/${Date.now()}_${fileName.replace(/\s+/g, '_')}`;
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType || 'image/jpeg'
  });

  await client.send(command);
  return `${R2_PUBLIC_URL}/${key}`;
}

module.exports = {
  uploadToR2
};
