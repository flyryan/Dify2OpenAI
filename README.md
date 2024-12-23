# Dify2OpenAI Middleware

This middleware application provides an OpenAI-compatible endpoint for Dify instances, allowing you to use OpenAI API clients with Dify's API. It maintains conversation context and supports both streaming and non-streaming responses.

## Requirements

- Node.js >= 18.0.0
- A running Dify instance with API access
- Your Dify API key

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/dify2openai.git
cd dify2openai
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your settings
nano .env  # or use your preferred editor
```

Required environment variables:
- `DIFY_API_URL`: Your Dify API URL (e.g., http://your-dify-instance/v1)
- `DIFY_API_KEY`: Your Dify API key (found in your Dify application settings)
- `PORT`: Port number for the middleware server (default: 3000)
- `LOG_LEVEL`: Logging verbosity level (default: info)
  - `error`: Only errors
  - `warn`: Errors and warnings
  - `info`: Basic operational info (default)
  - `debug`: Detailed debugging information

## Usage

1. Start the server:
```bash
# Production mode
npm start

# Development mode with auto-reload
npm run dev
```

2. The middleware will run on `http://localhost:3000` (or your configured PORT)

3. Use any OpenAI API client by pointing it to your middleware URL. Examples:

### Node.js (using OpenAI SDK)
```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'not-needed'  // The middleware uses Dify's API key
});

const completion = await openai.chat.completions.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'gpt-3.5-turbo',  // Model name is ignored, Dify's configured model is used
  stream: true  // Supports both streaming and non-streaming
});
```

### Python (using OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="not-needed"  # The middleware uses Dify's API key
)

completion = client.chat.completions.create(
    messages=[{"role": "user", "content": "Hello!"}],
    model="gpt-3.5-turbo",  # Model name is ignored
    stream=True  # Supports both streaming and non-streaming
)
```

### cURL
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Features

- OpenAI API compatibility:
  - Supports the chat completions endpoint
  - Works with any OpenAI API client
  - Maintains conversation context
- Response formats:
  - Supports both streaming and non-streaming responses
  - Matches OpenAI's response format
- Error handling:
  - Graceful error handling and reporting
  - OpenAI-compatible error responses
- Development friendly:
  - Easy setup with environment variables
  - Development mode with auto-reload
  - Configurable logging levels
  - Detailed debug information

## Logging

The middleware uses a leveled logging system with timestamps:

```
[2024-01-23T12:34:56.789Z] [INFO] Dify2OpenAI middleware running on port 3000
```

Log levels (from least to most verbose):
1. `error`: Critical issues that need immediate attention
2. `warn`: Important issues that don't affect core functionality
3. `info`: General operational information (default)
4. `debug`: Detailed information for debugging

Configure the log level in your .env file:
```bash
# Set to error, warn, info, or debug
LOG_LEVEL=info
```

Debug logs include:
- Conversation ID tracking
- Message format conversion details
- Request/response information
- Streaming events
- Client connections/disconnections

## API Endpoint

The middleware exposes a single endpoint that mimics OpenAI's chat completions API:

`POST /v1/chat/completions`

Request format follows OpenAI's specification:
```javascript
{
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "model": "gpt-3.5-turbo",  // Ignored, uses Dify's model
  "stream": true,  // Optional, defaults to false
  "user": "user123"  // Optional
}
```

## Limitations

- Only supports the chat completions endpoint
- Model selection is ignored (uses Dify's configured model)
- Some OpenAI-specific parameters may be ignored
- Function calling is not supported

## Health Check

The middleware provides a health check endpoint:

`GET /health`

Returns `{"status": "ok"}` when the server is running.

## Error Handling

The middleware handles various error cases:
- Invalid request format
- Missing/invalid messages
- API errors from Dify
- Network errors
- Server errors

All errors are returned in a format compatible with OpenAI's error responses:
```javascript
{
  "error": {
    "message": "Error description",
    "type": "error_type",
    "status": 400  // HTTP status code
  }
}
```