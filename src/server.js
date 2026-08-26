const fastify = require('fastify')({
  logger: true
});
const path = require('path');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
require('dotenv').config();

const { initDB } = require('./db/neon');

// 1. Security Headers via Helmet
fastify.register(helmet, {
  contentSecurityPolicy: false, // Allows cross-origin image & canvas rendering
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false
});

// 2. Rate Limiting Protection (DDoS & Brute Force Prevention)
fastify.register(rateLimit, {
  max: 150, // 150 requests per window
  timeWindow: '1 minute',
  errorResponseBuilder: (request, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${context.after}.`
  })
});

// 3. CORS Configuration
fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
});

// 4. Multipart for Secure File Uploads
fastify.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB Max
  }
});

// 5. JWT Authentication
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'cert-verification-secret-key-2026'
});

// Decorate fastify with auth hook
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ message: 'Unauthorized: Authentication required', error: err.message });
  }
});

// Serve uploaded static files securely
const uploadsPath = path.join(__dirname, '../uploads');
fastify.register(fastifyStatic, {
  root: uploadsPath,
  prefix: '/uploads/'
});

// Health check endpoint
fastify.get('/api/health', async (request, reply) => {
  return { status: 'ok', service: 'Certificate Generator & Verification Engine', timestamp: new Date().toISOString() };
});

// Register API Route Plugins
fastify.register(require('./routes/authRoutes'), { prefix: '/api/auth' });
fastify.register(require('./routes/templateRoutes'), { prefix: '/api/templates' });
fastify.register(require('./routes/certificateRoutes'), { prefix: '/api/certificates' });
fastify.register(require('./routes/batchRoutes'), { prefix: '/api/batches' });
fastify.register(require('./routes/analyticsRoutes'), { prefix: '/api/analytics' });
fastify.register(require('./routes/aiRoutes'), { prefix: '/api/ai' });
fastify.register(require('./routes/publicRoutes'), { prefix: '/api/public' });

// Global Error Handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(error.statusCode || 500).send({
    error: error.name || 'InternalServerError',
    message: error.message || 'An unexpected error occurred'
  });
});

// Start Server
const start = async () => {
  try {
    await initDB();
    const port = process.env.PORT || 5000;
    await fastify.listen({ port: parseInt(port, 10), host: '0.0.0.0' });
    console.log(`Certificate Backend Server running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
