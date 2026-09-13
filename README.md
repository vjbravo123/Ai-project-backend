# AI Backend (NestJS + LangChain + Gemini)

A scalable NestJS backend for an AI-integrated product: per-user chat history,
image-to-description, and an autonomous "research → summarize → draft →
simulate-send" newsletter agent.

## Stack

- **NestJS 10** — modular structure, DI, guards, pipes
- **MongoDB + Mongoose** — users, per-user conversations/messages
- **@langchain/google-genai** — talks to Gemini through LangChain's `ChatGoogleGenerativeAI`
- **JWT (passport-jwt)** — auth; every AI endpoint is scoped to the logged-in user
- **class-validator** — request validation on every DTO
- **@nestjs/throttler** — basic global rate limiting (30 req/min/client by default)
- **CORS** — enabled and configurable via `CORS_ORIGIN`

## Project layout

```
src/
  main.ts                  # bootstrap: CORS, validation pipe, global prefix
  app.module.ts             # wires all feature modules together
  app.controller.ts         # /health
  common/
    gemini/                 # ONE shared service that talks to Gemini — everything else uses this
  modules/
    auth/                   # register/login, JWT strategy, guard, @CurrentUser decorator
    users/                  # User schema + service
    chat/                   # general chatbot, conversation history per user
    vision/                 # image -> description endpoint
    news-agent/             # the agentic newsletter workflow
```

`common/` holds shared, cross-cutting building blocks (right now just the
Gemini wrapper); `modules/` holds self-contained feature modules, each with
its own controller/service/module/dto/schema. As the app grows, anything
else reused across features (e.g. a future `mailer/` or `logger/`) goes in
`common/`, and any new product feature gets its own folder under `modules/`.

Why one shared `GeminiService`: every feature (chat, vision, news agent) needs
a Gemini call, but you don't want three different places instantiating the
client, holding the API key, or handling errors differently. `GeminiModule`
exports it once; `ChatModule`, `VisionModule`, and `NewsAgentModule` each just
import `GeminiModule`. If you ever swap models or add retry/backoff logic,
you change it in one file.

## 1. Prerequisites

- Node.js 20+
- A MongoDB instance (local `mongod`, Docker, or Atlas free tier)
- A Gemini API key from Google AI Studio
- A free NewsAPI.org API key (for the newsletter agent)

## 2. Install

```bash
npm install
```

## 3. Configure environment

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

```dotenv
PORT=3000
CORS_ORIGIN=http://localhost:5173      # your frontend's origin, comma-separate for multiple

MONGO_URI=mongodb://localhost:27017/ai-backend

JWT_SECRET=some_long_random_string
JWT_EXPIRES_IN=7d

GEMINI_API_KEY=...
GEMINI_CHAT_MODEL=gemini-3.8-flash
GEMINI_VISION_MODEL=gemini-3.8-flash

NEWSAPI_KEY=...
```

## 4. Run

```bash
npm run start:dev     # watch mode
npm run build && npm run start:prod   # production
```

Server listens on `http://localhost:3000/api/v1` (global prefix `api/v1`).

Health check: `GET /api/v1/health`

## 5. Auth flow

All AI endpoints require a Bearer JWT.

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"password123","name":"Me"}'

# Login (same response shape)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"password123"}'
```

Both return `{ accessToken, user }`. Send `Authorization: Bearer <accessToken>`
on every request below.

## 6. Chatbot with per-user history

- `POST /api/v1/chat/message` — `{ message, conversationId? }`. Omit
  `conversationId` to start a new conversation; the response includes the new
  `conversationId` so the frontend can keep sending it on subsequent turns.
- `GET /api/v1/chat/conversations` — list the logged-in user's conversations
- `GET /api/v1/chat/conversations/:id` — full message history for one conversation
- `DELETE /api/v1/chat/conversations/:id` — delete a conversation

History is stored per-user in MongoDB (`Conversation` documents, one per
thread, embedding a `messages[]` array). Each turn, the last 20 messages are
replayed to Gemini as LangChain `HumanMessage`/`AIMessage` objects so the
model has conversational context — this cap keeps token usage/latency bounded
as a conversation grows; swap in a summarization step later if you need
longer memory.

```bash
curl -X POST http://localhost:3000/api/v1/chat/message \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"What is LangChain?"}'
```

## 7. Image → description

`POST /api/v1/vision/describe` — multipart form with an `image` file field
and an optional `instruction` text field to steer the description.

```bash
curl -X POST http://localhost:3000/api/v1/vision/describe \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/photo.jpg" \
  -F "instruction=Describe this for an alt-text tag"
```

Accepts PNG/JPEG/WebP/HEIC up to 8 MB (both limits configurable in
`vision.controller.ts`). The buffer is base64-encoded and sent to Gemini as
a multimodal `HumanMessage`.

## 8. Autonomous newsletter agent

`POST /api/v1/news-agent/run` — `{ goal?, topic? }`, both optional.

Reproduces exactly the workflow described in the brief:

1. **Research** — `NewsApiService` calls NewsAPI.org for recent articles on
   `topic` (default `"AI agents"`).
2. **Reason** — a single Gemini call is given the raw article list and asked
   to pick the 5-7 most relevant, summarize each, and draft a subject/intro/outro
   as strict JSON.
3. **Act** — the JSON draft is rendered into both Markdown and HTML.
4. **Simulate send** — instead of calling a real email API, the newsletter is
   written to `generated-newsletters/<timestamp>-<slug>.md` and logged, and
   the full content + subject is returned in the response so you can "read"
   the email that would have gone out.

```bash
curl -X POST http://localhost:3000/api/v1/news-agent/run \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"goal":"Create a weekly newsletter on the latest AI agent news and send it to our subscribers."}'
```

Response: `{ subject, articleCount, markdown, html, savedTo }`.

To wire this to real email later, replace `simulateSend()` in
`news-agent.service.ts` with a call to SendGrid/SES/Postmark — nothing else
in the pipeline needs to change.

## 9. Scalability / production notes

- **Stateless app layer**: JWT auth means any request can hit any instance —
  horizontally scale by running more Node processes behind a load balancer.
- **Rate limiting**: `@nestjs/throttler` is applied globally (30 req/min per
  client by default) since Gemini/NewsAPI calls cost money — tune per-route
  with `@Throttle()` if some endpoints need stricter limits.
- **DB indexes**: `Conversation.userId` is indexed so per-user history lookups
  stay fast as the collection grows.
- **Bounded context window**: chat only replays the last 20 messages to Gemini,
  not the entire history, keeping latency/cost predictable regardless of how
  long a conversation gets.
- **One Gemini client**: `GeminiService` is the single integration point —
  makes it trivial to add retries, response caching, or swap models/providers.
- **Validation everywhere**: global `ValidationPipe` with `whitelist: true`
  rejects unexpected fields before they reach any service.
- **Horizontal DB scaling**: swap `MONGO_URI` for a replica set / Atlas
  cluster with no code changes.
- **Next steps for heavier load**: move the news-agent run to a background
  queue (BullMQ + Redis) and return a job id immediately instead of blocking
  the HTTP request on 2 Gemini calls + a NewsAPI call.

## 10. A note on the model name

`gemini-3.8-flash` is set as the default in `.env.example`. If Google renames
or retires it, only `GEMINI_CHAT_MODEL` / `GEMINI_VISION_MODEL` need to
change — no code touches the model name directly.
