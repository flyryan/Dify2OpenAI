# Dify2OpenAI Middleware

This middleware application provides an OpenAI-compatible endpoint for Dify instances, allowing you to use OpenAI API clients with Dify's API.

## Setup

1. Clone this repository
2. Install dependencies:
```bash
npm install
```
3. Configure environment variables by copying `.env.example` to `.env` and updating the values:
```bash
DIFY_API_URL=http://your-dify-instance/v1
DIFY_API_KEY=your_dify_api_key
PORT=3000
```

## Usage

1. Start the server:
```bash
npm start
```

2. The middleware will run on `http://localhost:3000` (or your configured PORT)

3. Use any OpenAI API client by pointing it to your middleware URL instead of OpenAI's API URL. For example:

```javascript
const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'not-needed'  // The middleware uses Dify's API key
});

const completion = await openai.chat.completions.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'gpt-3.5-turbo',  // This value is ignored, Dify's configured model is used
});
```

## Features

- Supports both streaming and non-streaming responses
- Maintains conversation context using Dify's conversation_id
- Converts OpenAI API requests to Dify format and vice versa
- Handles errors gracefully

## API Endpoint

The middleware exposes a single endpoint that mimics OpenAI's chat completions API:

- `POST /v1/chat/completions`

The request and response formats follow OpenAI's API specification, making it compatible with existing OpenAI API clients.

## Error Handling

The middleware handles various error cases:
- Invalid message format
- Missing user messages
- API errors from Dify
- Network errors

Errors are returned in a format compatible with OpenAI's error responses.

## Limitations

- Only supports the chat completions endpoint
- Model selection is ignored (uses Dify's configured model)
- Some OpenAI-specific parameters may be ignored
- Function calling is not supported

## License

ISC
