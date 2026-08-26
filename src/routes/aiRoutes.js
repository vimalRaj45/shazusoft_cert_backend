const { answerRagQuery } = require('../services/ragService');

async function aiRoutes(fastify, options) {
  // RAG Chatbot Query Endpoint
  fastify.post('/chat', async (request, reply) => {
    const { message, chatHistory } = request.body || {};

    if (!message || !message.trim()) {
      return reply.code(400).send({ message: 'Query message is required' });
    }

    try {
      const result = await answerRagQuery({
        userQuery: message.trim(),
        chatHistory: Array.isArray(chatHistory) ? chatHistory : []
      });

      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({
        success: false,
        message: 'Failed to process AI chat query',
        error: err.message
      });
    }
  });
}

module.exports = aiRoutes;
