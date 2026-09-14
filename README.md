# AI Backend (NestJS + LangChain + Gemini)

A scalable NestJS backend for an AI-integrated product: per-user chat history,
image-to-description, and an autonomous "research → summarize → draft →
simulate-send" newsletter agent.

## Stack

- **NestJS 11** — modular structure, DI, guards, pipes
- **MongoDB + Mongoose** — users, per-user conversations/messages, revision topics
- **@langchain/google-genai** — talks to Gemini through LangChain's `ChatGoogleGenerativeAI` (text, vision, and audio input)
- **JWT (passport-jwt)** — auth; every AI endpoint is scoped to the logged-in user
- **Resend** — OTP verification emails + spaced-repetition revision reminders
- **@nestjs/schedule** — cron sweep that sends due revision reminders
- **class-validator** — request validation on every DTO
- **@nestjs/throttler** — basic global rate limiting (30 req/min/client by default), tighter limits on the OTP endpoints
- **CORS** — enabled and configurable via `CORS_ORIGIN`

## Project layout

```
src/
  main.ts                  # bootstrap: CORS, validation pipe, global prefix
  app.module.ts             # wires all feature modules together
  app.controller.ts         # /health
  common/
    gemini/                 # ONE shared service that talks to Gemini — everything else uses this
    mail/                   # ONE shared service that sends email via Resend — OTP + reminders use this
  modules/
    auth/                   # register (OTP) / verify-otp / resend-otp / login, JWT strategy, guard, @CurrentUser decorator
    users/                  # User schema + service
    chat/                   # general chatbot, conversation history per user
    vision/                 # image -> description endpoint
    news-agent/             # the agentic newsletter workflow
    revision/               # speak-what-you-studied -> SM-2 spaced-repetition reminders
```

`common/` holds shared, cross-cutting building blocks (the Gemini wrapper and
the Resend mailer); `modules/` holds self-contained feature modules, each with
its own controller/service/module/dto/schema. As the app grows, anything
else reused across features goes in `common/`, and any new product feature
gets its own folder under `modules/`.

Why one shared `GeminiService`: every feature (chat, vision, news agent) needs
a Gemini call, but you don't want three different places instantiating the
client, holding the API key, or handling errors differently. `GeminiModule`
exports it once; `ChatModule`, `VisionModule`, and `NewsAgentModule` each just
import `GeminiModule`. If you ever swap models or add retry/backoff logic,
you change it in one file.

## 1. Prerequisites

- Node.js 20+
- A MongoDB instance (local `mongod`, Docker, or Atlas free tier)
- A Gemini API key from Google AI Studio (the vision-capable model is also used to transcribe/analyze spoken revision sessions)
- A free NewsAPI.org API key (for the newsletter agent)
- A Resend account with your sending domain verified, and an API key (for OTP emails + revision reminders)

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

RESEND_API_KEY=...
RESEND_FROM_EMAIL=Revision Buddy <reminders@yourdomain.com>   # must be on a domain verified in Resend

OTP_TTL_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5

REVISION_REMINDER_CRON=*/10 * * * *    # how often the reminder sweep runs
```

## 4. Run

> **A packaging note on `@nestjs/schedule`**: this project compiles to
> CommonJS (Nest's default). `@nestjs/schedule@12.x` ships as ESM-only
> (`"type": "module"`, no CJS build), which crashes a CJS app at boot with
> `ERR_REQUIRE_ESM`. `package.json` pins `@nestjs/schedule` to `^6.1.3` — the
> latest release that's still CJS and peer-compatible with NestJS 11 — on
> purpose. Don't `npm update` past that major without checking it's shipped a
> CJS build (or migrating the whole project to ESM) first.


```bash
npm run start:dev     # watch mode
npm run build && npm run start:prod   # production
```

Server listens on `http://localhost:3000/api/v1` (global prefix `api/v1`).

Health check: `GET /api/v1/health`

## 5. Auth flow: register with email OTP (via Resend)

Registration is two steps — no account is usable until the emailed code is
verified. All AI endpoints require a Bearer JWT, obtained after verification.

```bash
# Step 1: register -> creates an unverified account, emails a 6-digit code
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"password123","name":"Me"}'
# -> { "message": "Verification code sent to your email.", "email": "me@example.com" }

# Step 2: verify the code from the email -> activates the account, returns a JWT
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","otp":"004821"}'
# -> { "accessToken": "...", "user": { "id": "...", "email": "..." } }

# Didn't get it / it expired? Resend (rate-limited: one every 60s by default)
curl -X POST http://localhost:3000/api/v1/auth/resend-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com"}'

# Login (only works once verified)
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"password123"}'
```

OTP codes are 6 digits, bcrypt-hashed at rest (never stored in plaintext),
expire after `OTP_TTL_MINUTES`, and lock out after `OTP_MAX_ATTEMPTS` wrong
guesses until a new code is requested. `login`/`verify-otp` both return
`{ accessToken, user }`. Send `Authorization: Bearer <accessToken>` on every
request below.

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

## 9. Revision reminders: speak what you studied, get reminded when to revisit it

The idea: after studying something, the user records a short voice note (or
types it) describing what they just learned. The backend transcribes it,
figures out the topic and how well they seem to understand it, and schedules
the next reminder using the SM-2 spaced-repetition algorithm (the same one
behind Anki/SuperMemo) — the better the recall, the further out the next
reminder; a shaky explanation brings it back tomorrow.

**Log a session from recorded audio** (frontend records e.g. webm/wav/m4a and
posts it as multipart form data — no separate speech-to-text step needed,
Gemini transcribes and analyzes it in one call):

```bash
curl -X POST http://localhost:3000/api/v1/revision/log \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@/path/to/recording.webm"
```

**Or log from text directly** (if the frontend already has a transcript, or
the user just typed it):

```bash
curl -X POST http://localhost:3000/api/v1/revision/log-text \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Today I learned that mitochondria are the powerhouse of the cell..."}'
```

Both return the updated `RevisionTopic` document: `title`, `latestSummary`,
the SM-2 state (`repetitions`, `easeFactor`, `intervalDays`), `nextRevisionAt`,
and the full `history[]` of past sessions (transcript, summary, key points,
`understandingScore` 0-5 for that session).

Sessions are matched to an existing topic by a normalized title (so "the
Krebs cycle" and "krebs cycle" merge into one), or create a new topic.

**Other endpoints:**

- `GET /api/v1/revision` — all of the user's topics, soonest-due first
- `GET /api/v1/revision/due` — only topics due right now (for the frontend to
  poll and show in-app, in addition to the emailed reminder)
- `POST /api/v1/revision/:id/review` — `{ quality: 0-5 }`, for logging a
  manual review (e.g. a quiz result) without new audio/text
- `DELETE /api/v1/revision/:id` — stop tracking a topic

**How the timing is decided** (`src/modules/revision/scheduling/sm2.ts`):
recall quality < 3 resets the repetition streak and schedules the next
revision for 1 day out; quality ≥ 3 grows the interval (1 day → 6 days →
`previous interval × ease factor`), and the ease factor itself is nudged up
or down each time using the standard SM-2 formula (floored at 1.3 so a topic
never gets scheduled arbitrarily far apart no matter how easy it gets, and
capped at ~2 years so it never disappears from rotation).

**How the reminder actually gets sent**: `ReminderScheduler` runs a cron sweep
(`REVISION_REMINDER_CRON`, every 10 minutes by default) that finds topics past
their `nextRevisionAt` with no reminder sent yet for the current schedule, and
emails the user via Resend. Each topic is only emailed once per due date —
logging a new session (or a manual review) recomputes the schedule and clears
the "reminder sent" flag for the new date.

## 10. Scalability / production notes

- **Stateless app layer**: JWT auth means any request can hit any instance —
  horizontally scale by running more Node processes behind a load balancer.
- **Rate limiting**: `@nestjs/throttler` is applied globally (30 req/min per
  client by default) since Gemini/NewsAPI calls cost money — tune per-route
  with `@Throttle()` if some endpoints need stricter limits.
- **DB indexes**: `Conversation.userId` is indexed for fast per-user history
  lookups; `RevisionTopic` has a compound unique index on `(userId,
  normalizedTitle)` so sessions merge into the right topic instead of
  duplicating, plus an index on `nextRevisionAt` for the reminder sweep.
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
  the HTTP request on 2 Gemini calls + a NewsAPI call. The revision reminder
  cron is in-process, single-instance-safe as written — if you scale to
  multiple app instances, move it to a queue/leader-elected job runner (or a
  managed cron trigger hitting a dedicated internal endpoint) so the sweep
  doesn't run — and double-send reminders — on every instance.

## 11. A note on the model name

`gemini-3.8-flash` is set as the default in `.env.example`. If Google renames
or retires it, only `GEMINI_CHAT_MODEL` / `GEMINI_VISION_MODEL` need to
change — no code touches the model name directly.
