import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configure Dify API client
const difyClient = axios.create({
  baseURL: process.env.DIFY_API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.DIFY_API_KEY}`,
    'Content-Type': 'application/json',
  }
});

// Helper function to convert OpenAI messages to Dify query
function convertOpenAIToDifyFormat(messages) {
  // Get the last user message
  const lastUserMessage = messages.reverse().find(msg => msg.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  // Find the conversation ID if it exists in previous assistant messages
  const lastAssistantMessage = messages.find(msg => msg.role === 'assistant');
  const conversationId = lastAssistantMessage?.conversationId || '';

  return {
    query: lastUserMessage.content,
    conversation_id: conversationId,
    user: 'default-user', // This could be made configurable
    inputs: {},
    response_mode: 'streaming'
  };
}

// Helper function to convert Dify streaming response to OpenAI format
function convertDifyToOpenAIStreamFormat(difyChunk) {
  const data = JSON.parse(difyChunk.replace('data: ', ''));
  
  if (data.event === 'message') {
    return {
      id: data.message_id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-3.5-turbo',
      choices: [{
        index: 0,
        delta: {
          content: data.answer
        },
        finish_reason: null
      }],
      conversationId: data.conversation_id
    };
  } else if (data.event === 'message_end') {
    return {
      id: data.id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-3.5-turbo',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }],
      conversationId: data.conversation_id
    };
  }
  
  return null;
}

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, stream = false } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    const difyRequest = convertOpenAIToDifyFormat(messages);

    if (stream) {
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Make streaming request to Dify
      const response = await difyClient.post('/chat-messages', difyRequest, {
        responseType: 'stream'
      });

      // Process the Dify stream
      response.data.on('data', chunk => {
        const chunkStr = chunk.toString();
        if (!chunkStr.startsWith('data:')) return;

        const openAIFormat = convertDifyToOpenAIStreamFormat(chunkStr);
        if (openAIFormat) {
          res.write(`data: ${JSON.stringify(openAIFormat)}\n\n`);
        }
      });

      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      // Handle client disconnect
      req.on('close', () => {
        response.data.destroy();
      });
    } else {
      // Non-streaming request
      difyRequest.response_mode = 'blocking';
      const response = await difyClient.post('/chat-messages', difyRequest);
      
      const openAIResponse = {
        id: response.data.message_id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-3.5-turbo',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.data.answer
          },
          finish_reason: 'stop'
        }],
        usage: response.data.metadata?.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        conversationId: response.data.conversation_id
      };

      res.json(openAIResponse);
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: {
        message: 'An error occurred during your request.',
        type: 'internal_server_error'
      }
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Dify2OpenAI middleware running on port ${port}`);
});
