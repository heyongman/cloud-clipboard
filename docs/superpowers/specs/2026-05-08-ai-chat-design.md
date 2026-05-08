# AI Chat Page Design

## Goal

Add a NextChat-style AI chat page to Cloud Clipboard. The page uses OpenAI-compatible Responses API through the Node backend, supports streaming text, image input, image generation, built-in web search, local conversation history, role presets, Markdown rendering, token visibility, and shared server-side AI settings.

## Scope

This feature targets the existing Vue 2/Vuetify frontend and the `server-node` Koa backend. The PHP/Swoole backend is out of scope.

The first version uses one shared AI configuration for everyone who can pass the existing clipboard authentication. Conversations stay in the browser. API keys and default model settings are saved on the backend.

## API Integration Choice

The backend will call the OpenAI-compatible REST API with Node 18+ native `fetch`, not the OpenAI SDK.

REST is a better fit for this project because the backend acts as a thin proxy that:

- supports a configurable API base URL;
- forwards Responses API streaming events as SSE;
- keeps the API key off the browser;
- avoids adding a dependency for a small surface area;
- remains compatible with OpenAI-like gateways when they implement the same endpoints.

The SDK can be introduced later if the project starts using broader OpenAI resources such as file stores, vector stores, assistants, or complex tool orchestration.

## Backend Design

Create focused AI backend modules under `server-node/app/ai`.

- `config-store.js`: read and save shared AI settings from JSON.
- `openai-client.js`: build URLs, headers, request bodies, and REST calls.
- `stream.js`: parse upstream SSE lines and emit normalized downstream SSE events.
- `model-context.js`: map known models to maximum context windows.

Add `server.aiConfigFile` to `server-node/app/config.js`. If not set, use `server-node/ai-config.json` from the backend working directory. This file is local runtime data and should not be committed.

### AI Settings Shape

```json
{
  "apiBase": "https://api.openai.com/v1",
  "apiKey": "",
  "defaultModel": "gpt-5",
  "defaultReasoningEffort": "medium",
  "summaryModel": "gpt-5-mini"
}
```

`GET /ai/config` returns the settings with `apiKey` masked as `hasApiKey: true/false`. `PUT /ai/config` accepts a new key, or keeps the existing key when the submitted key is empty and `keepApiKey` is true.

### Backend Routes

All private AI routes use the existing `authMiddleware`.

- `GET /ai/config`: returns shared AI settings, without the raw key.
- `PUT /ai/config`: saves shared AI settings.
- `GET /ai/models`: calls `${apiBase}/models` and returns model IDs sorted by name.
- `GET /ai/models/context`: returns known context windows for common models.
- `POST /ai/responses/stream`: accepts the conversation payload, calls `${apiBase}/responses` with `stream: true`, and returns downstream SSE.
- `POST /ai/summary`: calls `${apiBase}/responses` without streaming and returns a concise conversation summary.
- `POST /ai/token-estimate`: returns a practical local estimate for current conversation tokens.

### Responses Request Shape

The frontend sends a compact, backend-owned shape:

```json
{
  "model": "gpt-5",
  "reasoningEffort": "medium",
  "rolePrompt": "You are a programming expert...",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Analyze this screenshot" },
        { "type": "image", "mimeType": "image/png", "dataUrl": "data:image/png;base64,..." }
      ]
    }
  ],
  "tools": {
    "webSearch": true,
    "imageGeneration": false
  }
}
```

The backend converts this into Responses API input items. Text becomes `input_text`. Images become `input_image` with `image_url` set to the data URL. Enabled tools become `tools: [{ "type": "web_search" }]` and/or `tools: [{ "type": "image_generation" }]`.

Reasoning effort is sent as `reasoning: { "effort": "low|medium|high" }` only when a value is selected.

### Downstream SSE

The backend normalizes upstream events so the frontend does not depend on every OpenAI event type:

- `event: text_delta` with `{ "delta": "..." }`
- `event: image` with `{ "mimeType": "image/png", "dataUrl": "data:image/png;base64,..." }`
- `event: usage` with `{ "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 }`
- `event: complete` with `{ "responseId": "resp_..." }`
- `event: error` with `{ "message": "..." }`

The stream parser also forwards enough unknown events as debug data in development logs, but does not expose sensitive request headers.

## Frontend Design

Add a new route `/chat` and a navigation drawer item named `AI聊天`.

Create `client/src/views/Chat.vue` as the main page. It can stay as one view file for the first version, with helper modules for storage and OpenAI payload shaping.

Create:

- `client/src/utils/chat-storage.js`: localStorage persistence, migration, import/export-safe data shape.
- `client/src/utils/chat-markdown.js`: lazy-load and configure `markdown-it` consistently with the existing Markdown page.
- `client/src/utils/chat-tokens.js`: local token estimate display helpers.

### Layout

The page is a work-focused chat interface, not a landing page.

- Left rail: conversation list, new chat button, role selection for new chats.
- Header: current chat title, temporary model selector, reasoning selector, web search switch, image generation switch, token/context indicator, settings button.
- Message area: user and assistant messages rendered as Markdown, with attachment thumbnails and generated images.
- Composer: multiline input, attachment preview row, send button, clear attachments button.

Desktop uses a two-column layout. Mobile collapses the conversation list behind a drawer or top button.

### Conversation Storage

Conversations are saved in browser storage under a versioned key such as `cloudClipboard.aiChat.v1`.

Each conversation stores:

```json
{
  "id": "chat_...",
  "title": "New chat",
  "roleId": "programming",
  "rolePrompt": "...",
  "model": "gpt-5",
  "reasoningEffort": "medium",
  "webSearch": false,
  "imageGeneration": false,
  "summary": "",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0
  },
  "messages": []
}
```

Images pasted into a conversation are stored as data URLs. To prevent unbounded localStorage growth, the UI warns when the saved data exceeds a practical size threshold and allows removing attachments from older turns.

### Input Behavior

- `Enter` inserts a newline.
- `Ctrl+Enter` sends the message.
- `Ctrl+V` / paste handles text normally and extracts files/images from the clipboard.
- Pasted images show thumbnails before sending.
- Pasted non-image files are listed by name, size, and type. The first version sends only images to the model; other files are kept as visible attachments but marked "not sent to AI" unless the user converts them to text in a future version.

### Markdown And Copying

Assistant and user text content render through `markdown-it` with HTML disabled.

Each assistant message exposes:

- copy text: copies plain text;
- copy markdown: copies the original Markdown;
- copy generated image: copies/downloads the generated image where browser support allows.

### Roles

New chats can start from built-in roles:

- 美股审计专家: focuses on US public company filings, audit risks, accounting policies, and evidence-backed financial analysis.
- 编程专家: focuses on pragmatic engineering, code review, debugging, and implementation guidance.
- 医生: gives general medical information and risk triage, with clear reminders that it is not a substitute for professional diagnosis.
- 通用助手: neutral default assistant.

Role prompt text is saved into the conversation at creation time so future edits to built-in presets do not rewrite old chats.

### Summary

The summary button sends the current conversation to `/ai/summary` using the configured summary model. The summary is saved on the conversation and can be shown near the title. When the user starts a long chat, the summary is included as compact context before recent messages.

### Token And Context Display

The frontend displays:

- estimated current conversation tokens from `/ai/token-estimate`;
- latest usage returned by `response.completed`;
- known max context for the selected model from `/ai/models/context`.

Known context windows are best-effort metadata. Unknown models display `未知` instead of inventing a number.

## Error Handling

- Missing API key: settings dialog opens and the chat send action is blocked.
- Model query failure: keep manual model input usable and show an error toast.
- Streaming failure: assistant draft message is marked failed and can be retried.
- OpenAI API error: return the upstream error message when safe; otherwise return a generic failure.
- Oversized pasted image: block or warn before sending, based on a conservative size threshold.
- Browser storage quota: show a clear message and let users delete old chats or attachments.

## Testing And Verification

Backend:

- Add unit tests for AI config save/read behavior.
- Add unit tests for payload conversion from frontend messages to Responses API input.
- Add unit tests for SSE parsing and normalized downstream events.
- Run `cd server-node && npm test`.

Frontend:

- Add focused tests for local chat storage and token estimate helpers if practical in the existing test setup.
- Run `cd client && npm run build` after route and page changes.

Manual verification:

- Save AI settings.
- Query models.
- Send a streaming text message.
- Paste an image and send it.
- Toggle web search and verify the backend sends the tool.
- Toggle image generation and verify generated images appear when the API returns an image generation call.
- Generate and persist a conversation summary.
- Reload the browser and verify conversations remain.

## Out Of Scope For First Version

- Multi-user AI settings.
- Server-side conversation history.
- PDF/document parsing.
- File upload to OpenAI Files API.
- Full tokenization parity with OpenAI tokenizer.
- Fine-grained per-role settings editor.
- PHP backend support.
