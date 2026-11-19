# Content Engine - Backend Post Service (LinkedIn & Randomized Scheduler)

A Node.js/TypeScript backend service designed to handle LinkedIn posting, image uploads, and randomized post distribution within customizable time windows.

---

## 🚀 Features

- **LinkedIn Post Service**:
  - Full support for the modern LinkedIn REST Posts API (`https://api.linkedin.com/rest/posts`).
  - Automatic 2-step media upload protocol (initializes asset, streams binary directly, attaches to post).
  - Built-in **Mock / Dry-Run Mode** (`LINKEDIN_MOCK_MODE=true` by default) so you can test end-to-end without needing immediate production OAuth credentials.
- **Human-Like Randomized Scheduler**:
  - Distributes posts across a configurable window (e.g., 09:00 to 21:00).
  - Enforces minimum spacing between consecutive posts (e.g., 30 minutes) to avoid bot detection and spam flagging.
  - Adds randomized jitter ($\pm 1$–3 minutes) so posts never land on exact round minutes.
  - Periodic background cron worker (runs every minute) to auto-publish due posts.
- **RESTful API**:
  - Immediate publish or draft creation.
  - Batch scheduling of multiple posts.
  - Reschedule / cancel actions.
  - Post status tracking (`DRAFT`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `CANCELLED`).

---

## ⚡ Running on AWS Lambda (Serverless Scheduling)

Because AWS Lambda freezes and terminates processes between executions, **in-memory node-cron does not work**.

Instead, this backend supports the **two standard AWS serverless scheduling architectures** via [`src/lambda.ts`](file:///Users/rahulgoswami/projects/content_engine/backend/src/lambda.ts):

### Option 1: Amazon EventBridge Scheduler (Recommended — Zero Polling)
1. When a post is assigned a randomized timestamp (e.g., `2026-11-20T14:27:12`), `awsSchedulerService` creates a one-time schedule via `CreateScheduleCommand` with:
   - `ScheduleExpression: "at(2026-11-20T14:27:12)"`
   - `ActionAfterCompletion: "DELETE"` (auto-deletes after execution)
   - `Target`: Your Lambda function with payload: `{ "action": "PUBLISH_POST", "postId": "..." }`.
2. At that exact second, EventBridge invokes `schedulerHandler` in `src/lambda.ts`, which publishes the post directly to LinkedIn.
3. If a post is cancelled or rescheduled, `awsSchedulerService.cancelSchedule(postId)` automatically deletes/updates the schedule.

### Option 2: EventBridge Rule (Periodic Heartbeat / Tick)
1. An Amazon EventBridge Rule invokes your Lambda handler every 1–5 minutes:
   - `rate(1 minute)` or `cron(* * * * ? *)`
2. `schedulerHandler` runs `schedulerService.processDuePosts()`, which queries for posts where `scheduledAt <= now() AND status = 'SCHEDULED'` and publishes them.

---

## 📂 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── env.ts                 # Environment variable management
│   ├── controllers/
│   │   └── post.controller.ts     # Express request handlers
│   ├── db/
│   │   └── post.store.ts          # Storage repository (JSON persistence / ready for Postgres)
│   ├── routes/
│   │   └── post.routes.ts         # REST API routes
│   ├── services/
│   │   ├── linkedin.service.ts    # LinkedIn REST API & 2-step image uploader
│   │   ├── post.service.ts        # Post lifecycle & batch scheduling orchestrator
│   │   └── scheduler.service.ts   # Randomized time generation & background cron worker
│   ├── types/
│   │   └── post.types.ts          # Data types and DTO interfaces
│   ├── index.ts                   # App entrypoint
│   └── test-demo.ts               # Verification demo script
├── data/
│   └── posts.json                 # Auto-persisted posts data
├── .env.example                   # Environment configuration template
├── package.json
└── tsconfig.json
```

---

## 🛠️ Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

If you don't have LinkedIn credentials yet, leave `LINKEDIN_MOCK_MODE=true` (default). To connect to live LinkedIn:
- Set `LINKEDIN_MOCK_MODE=false`
- Set `LINKEDIN_ACCESS_TOKEN=<your_oauth_token>`
- Set `LINKEDIN_AUTHOR_URN=urn:li:person:<id>` or `urn:li:organization:<id>`

### 3. Start Development Server
```bash
npm run dev
```

### 4. Build for Production
```bash
npm run build
npm start
```

---

## 📡 API Reference

### 1. Create a Post
`POST /api/posts`

```json
{
  "content": "Why asynchronous pipelines scale 10x better than monolithic scrapers. #Engineering #SystemDesign",
  "publishNow": false,
  "scheduledAt": "2026-11-20T10:15:00.000Z",
  "media": [
    {
      "type": "IMAGE",
      "url": "https://example.com/chart.png",
      "altText": "Architecture diagram"
    }
  ]
}
```

### 2. Batch Schedule Across a Random Window
`POST /api/posts/schedule-batch`

```json
{
  "windowStart": "09:00",
  "windowEnd": "21:00",
  "minGapMinutes": 30,
  "jitterMinutes": 3,
  "posts": [
    { "content": "Post #1: Hook and breakdown." },
    { "content": "Post #2: Case study results." },
    { "content": "Post #3: Best practices." }
  ]
}
```

### 3. Publish Post Immediately
`POST /api/posts/:id/publish-now`

### 4. Reschedule Post
`PATCH /api/posts/:id/reschedule`
```json
{
  "scheduledAt": "2026-11-20T14:30:00.000Z"
}
```

### 5. Cancel Scheduled Post
`POST /api/posts/:id/cancel`

### 6. List Posts
`GET /api/posts?status=SCHEDULED`
# content-pipeline-workflow
