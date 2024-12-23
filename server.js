import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Configure logging
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function log(level, ...args) {
  if (LOG_LEVELS[level] <= currentLogLevel) {
    const timestamp = new Date().toISOString();
    console[level === 'debug' ? 'log' : level](`[${timestamp}] [${level.toUpperCase()}]`, ...args);
  }
}

// Store conversation IDs in memory
const conversationStore = new Map();

app.use(cors());
app.use(express.json());

// Validate required environment variables
if (!process.env.DIFY_API_URL || !process.env.DIFY_API_KEY) {
  log('error', 'DIFY_API_URL and DIFY_API_KEY environment variables are required');
  process.exit(1);
}

// Configure Dify API client
const difyClient = axios.create({
  baseURL: process.env.DIFY_API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.DIFY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Helper function to convert OpenAI messages to Dify query
function convertOpenAIToDifyFormat(messages, conversationKey, user = 'default-user') {
  // Create a copy of messages to avoid modifying the original array
  const messagesCopy = [...messages];
  
  // Get the last user message without modifying the array
  const lastUserMessage = messagesCopy.reverse().find(msg => msg.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found');
  }

  // Try to get existing conversation ID from store
  let conversationId = conversationStore.get(conversationKey) || '';

  // Debug log conversation ID extraction
  log('debug', 'Conversation ID Extraction:', {
    found: !!conversationId,
    value: conversationId,
    messageCount: messages.length,
    messageFormats: messages.map(msg => ({
      hasDirectId: !!msg.conversation_id,
      hasChoices: !!msg.choices,
      hasMessage: !!msg.message,
      hasDelta: !!msg.delta
    }))
  });

  // Debug log conversion
  log('debug', 'OpenAI -> Dify Conversion:', {
    messageCount: messages.length,
    conversationId,
    lastUserMessage: lastUserMessage.content,
    allMessages: messages.map(m => ({
      role: m.role,
      content: m.content,
      id: m.message_id || m.id
    }))
  });

  // Format messages for conversation history
  const history = [];
  
  // Filter out system messages and process the rest chronologically
  const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
  
  for (const msg of nonSystemMessages) {
    // Extract content and IDs, handling various message formats
    const content = msg.content || 
                   msg.message?.content || 
                   msg.delta?.content || 
                   '';
    
    const messageId = msg.message_id || 
                     msg.id || 
                     msg.message?.id || 
                     msg.message?.message_id;
                     
    // If this is an assistant message, try to get conversation ID from various locations
    let msgConversationId = '';
    if (msg.role === 'assistant') {
      msgConversationId = msg.conversation_id || 
                         msg.message?.conversation_id || 
                         msg.delta?.conversation_id || 
                         (msg.choices && msg.choices[0]?.message?.conversation_id) ||
                         (msg.choices && msg.choices[0]?.delta?.conversation_id) ||
                         '';
      
      // If we found a conversation ID in an assistant message, use it
      if (msgConversationId) {
        conversationId = msgConversationId;
      }
    }

    history.push({
      role: msg.role,
      content: content,
      message_id: messageId,
      ...(msgConversationId ? { conversation_id: msgConversationId } : {})
    });
  }

  // Format request for Dify
  const request = {
    query: lastUserMessage.content,
    conversation_id: conversationId,
    user,
    inputs: {},
    response_mode: 'streaming',
    conversation_history: history
  };

  // Add conversation ID to history items if we have one
  if (conversationId) {
    request.conversation_history = history.map(msg => ({
      ...msg,
      conversation_id: msg.conversation_id || conversationId
    }));
  }

  // Debug log conversation history
  log('debug', 'Conversation History:', {
    history: history.map(msg => ({
      role: msg.role,
      content: msg.content,
      message_id: msg.message_id
    })),
    request: {
      query: request.query,
      conversation_id: request.conversation_id,
      user: request.user,
      history_length: request.conversation_history.length
    }
  });

  return request;
}

// Helper function to convert Dify streaming response to OpenAI format
function convertDifyToOpenAIStreamFormat(difyChunk, conversationKey) {
  // Clean up the chunk by removing 'data: ' prefix and handling any newlines
  const cleanChunk = difyChunk.replace('data: ', '').trim();
  if (!cleanChunk) return null;
  
  try {
    // Fix JSON format by adding missing commas between properties
    const fixedJson = cleanChunk.replace(/"\s+"(?!\})/g, '", "');
    const data = JSON.parse(fixedJson);
    if (data.event === 'message') {
      // Debug log message event
      log('debug', 'Dify -> OpenAI Message:', {
        messageId: data.message_id,
        conversationId: data.conversation_id,
        answer: data.answer,
        event: data.event,
        metadata: data.metadata
      });

      const response = {
        id: data.message_id || data.id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-3.5-turbo',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: data.answer
          },
          finish_reason: null
        }]
      };

      // Store conversation ID when we get it from Dify
      if (data.conversation_id) {
        conversationStore.set(conversationKey, data.conversation_id);
        response.conversation_id = data.conversation_id;
        response.choices[0].delta.conversation_id = data.conversation_id;
      }

      return response;
    } else if (data.event === 'message_end') {
      // Debug log message end event
      log('debug', 'Dify -> OpenAI End:', {
        messageId: data.id,
        conversationId: data.conversation_id,
        metadata: data.metadata,
        usage: data.metadata?.usage
      });

      const response = {
        id: data.message_id || data.id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'gpt-3.5-turbo',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant'
          },
          finish_reason: 'stop'
        }]
      };

      // Store conversation ID when we get it from Dify
      if (data.conversation_id) {
        conversationStore.set(conversationKey, data.conversation_id);
        response.conversation_id = data.conversation_id;
        response.choices[0].delta.conversation_id = data.conversation_id;
      }

      return response;
    }
  
    return null;
  } catch (error) {
    log('error', 'Error parsing Dify chunk:', error);
    return null;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  log('debug', 'Health check requested');
  res.json({ status: 'ok' });
});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, stream = false, user } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      log('warn', 'Invalid request format: messages must be an array');
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // Use first message content as conversation key since it's stable across requests
    const conversationKey = messages[0]?.content || '';
    log('info', `Processing ${stream ? 'streaming' : 'non-streaming'} request`, { 
      messageCount: messages.length,
      user: user || 'default-user'
    });

    const difyRequest = convertOpenAIToDifyFormat(messages, conversationKey, user);

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
        try {
          const chunkStr = chunk.toString();
          
          // Split multiple chunks that might be received together
          const chunks = chunkStr.split('\n').filter(line => line.startsWith('data:'));
          
          for (const chunk of chunks) {
            const openAIFormat = convertDifyToOpenAIStreamFormat(chunk, conversationKey);
            if (openAIFormat) {
              const formattedResponse = `data: ${JSON.stringify(openAIFormat)}\n\n`;
              res.write(formattedResponse);
            }
          }
        } catch (error) {
          log('error', 'Error processing chunk:', error);
          // Continue processing next chunks even if one fails
        }
      });

      response.data.on('error', error => {
        log('error', 'Stream error:', error);
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('end', () => {
        log('debug', 'Stream ended');
        res.write('data: [DONE]\n\n');
        res.end();
      });

      // Handle client disconnect
      req.on('close', () => {
        log('debug', 'Client disconnected');
        response.data.destroy();
      });
    } else {
      // Non-streaming request
      difyRequest.response_mode = 'blocking';
      const response = await difyClient.post('/chat-messages', difyRequest);
      
      const openAIResponse = {
        id: response.data.message_id || response.data.id,
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
        }
      };

      // Store and add conversation ID
      if (response.data.conversation_id) {
        conversationStore.set(conversationKey, response.data.conversation_id);
        openAIResponse.conversation_id = response.data.conversation_id;
        openAIResponse.choices[0].message.conversation_id = response.data.conversation_id;
      }

      log('debug', 'Non-streaming response:', { 
        messageId: openAIResponse.id,
        conversationId: openAIResponse.conversation_id
      });

      res.json(openAIResponse);
    }
  } catch (error) {
    log('error', 'Server error:', error);
    
    if (axios.isAxiosError(error)) {
      // Handle Dify API errors
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;
      
      res.status(status).json({
        error: {
          message: `Dify API error: ${message}`,
          type: 'dify_api_error',
          status
        }
      });
    } else {
      // Handle other errors
      res.status(500).json({
        error: {
          message: 'An internal server error occurred.',
          type: 'internal_server_error'
        }
      });
    }
  }
});

// Start the server
app.listen(port, () => {
  log('info', `Dify2OpenAI middleware running on port ${port}`);
  log('info', `Log level: ${process.env.LOG_LEVEL?.toLowerCase() || 'info'}`);
});
