# PlayX Distributed Automation Platform — Complete Technical Deep Dive

> **Author:** Senior Distributed Systems Architect (Mentor Document)
> **Audience:** Backend engineer preparing for senior-level system design interviews
> **Codebase:** `@playx/monorepo` — Nx monorepo with 4 apps and 5 libraries

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Complete Request Lifecycle](#2-complete-request-lifecycle-step-by-step)
3. [Technology Deep Dive](#3-technology-deep-dive)
4. [Failure & Resiliency Analysis](#4-failure--resiliency-analysis)
5. [Performance & Scalability](#5-performance--scalability)
6. [Code Walkthrough](#6-code-walkthrough)
7. [Design Patterns Used](#7-design-patterns-used)
8. [Production Hardening & Improvements](#8-production-hardening--improvements)
9. [Learning Roadmap](#9-learning-roadmap-for-you)

---

## 1. SYSTEM ARCHITECTURE OVERVIEW

### 1.1 Architectural Style

This system is an **event-driven, asynchronous job-processing platform** with a **distributed worker architecture**. It combines three architectural styles:

| Style | Where It Appears |
|-------|-----------------|
| **Request/Reply (REST)** | Frontend ↔ API server for job submission and status queries |
| **Event-Driven (Pub/Sub)** | Worker → Redis → API → Frontend for real-time status streaming |
| **Async Job Queue (Producer/Consumer)** | API → RabbitMQ → Worker for decoupled job execution |

The system is **NOT** a traditional synchronous web app. The API server never waits for the browser automation to finish. It fires-and-forgets to the message queue and returns immediately. This is the single most important architectural decision in the system.

### 1.2 Why Asynchronous Processing?

Browser automation (Playwright) is inherently slow — each job takes 3–30+ seconds. If the API server processed jobs synchronously:

1. **HTTP timeout risk**: The client would wait 30+ seconds. Load balancers and proxies typically timeout at 30–60s.
2. **Thread/connection exhaustion**: Each in-flight request holds an Express connection open. With 100 concurrent users, you'd need 100 simultaneous Playwright browsers on the same machine.
3. **No retry capability**: If the browser crashes mid-job, the entire request fails with no recovery.
4. **No backpressure**: With synchronous processing, overload crashes the API server. With a queue, messages simply wait.

The async architecture gives you: **instant API response**, **retry on failure**, **horizontal scaling of workers**, and **backpressure via the queue**.

### 1.3 Component Responsibilities and Boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Nx Monorepo                                  │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │  apps/       │  │  apps/       │  │  apps/       │  │ apps/      │ │
│  │  frontend    │  │  api         │  │  worker      │  │ vendor-site│ │
│  │  (React+Vite)│  │  (Express)   │  │  (Node.js)   │  │ (React)    │ │
│  │  Port 4200   │  │  Port 3000   │  │  No port     │  │ Port 4201  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │                │        │
│  ┌──────┴─────────────────┴─────────────────┴────────────────┴──────┐ │
│  │                      libs/ (shared code)                          │ │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐ ┌────────┐ ┌─────┐ │ │
│  │  │shared-   │ │messaging  │ │infrastructure│ │database│ │core │ │ │
│  │  │types     │ │(RabbitMQ  │ │(Redis,Config │ │(Prisma │ │(DI, │ │ │
│  │  │(DTOs,    │ │EncryptAES)│ │Logger,Zod)   │ │Repos)  │ │intf)│ │ │
│  │  │enums)    │ │           │ │              │ │        │ │     │ │ │
│  │  └──────────┘ └───────────┘ └──────────────┘ └────────┘ └─────┘ │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

External Infrastructure (Docker Compose):
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │PostgreSQL│    │ RabbitMQ │    │  Redis   │
  │Port 5433 │    │Port 5672 │    │Port 6379 │
  │          │    │UI: 15672 │    │          │
  └──────────┘    └──────────┘    └──────────┘
```

| Component | Responsibility | Does NOT do |
|-----------|---------------|------------|
| **Frontend** | Form submission, SSE consumption, DLQ dashboard display | Never talks to RabbitMQ, Redis, or DB directly |
| **API Server** | REST endpoints, input validation, DB writes (PENDING), publish to RabbitMQ, SSE bridging from Redis | Never runs Playwright, never processes jobs |
| **Worker** | Consumes from RabbitMQ, decrypts messages, runs Playwright, writes results to DB, publishes status to Redis | Never serves HTTP, never talks to Frontend directly |
| **Vendor Site** | Mock target website for Playwright to automate against | Pure UI, no backend logic |
| **PostgreSQL** | Durable storage for jobs and quotes | Not used for queuing or pub/sub |
| **RabbitMQ** | Job queue with retry/DLQ semantics | Not used for status updates or caching |
| **Redis** | Real-time pub/sub bridge between Worker and API | Not used for job queuing (that's RabbitMQ's job) |

### 1.4 High-Level Data Flow Summary

```
User → Frontend → API → [DB: PENDING] → [RabbitMQ: encrypted msg]
                    ↑                              ↓
                    │ SSE                    Worker consumes
                    │                              ↓
               Redis Pub/Sub ← Worker → [Playwright → Vendor Site]
                                   ↓
                              [DB: COMPLETED + Quote saved]
```

### 1.5 Text-Based Architecture Diagram

```
                    ┌─────────────────────┐
                    │       USER          │
                    │  (Browser Client)   │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
              ┌─────│     FRONTEND        │◄─────────────────┐
              │     │   React + Vite      │                  │
              │     │   Port 4200         │                  │
              │     └─────────────────────┘                  │
              │                                              │
         POST /api/jobs                          SSE /api/jobs/:id/stream
         (submit job)                            (real-time updates)
              │                                              │
              ▼                                              │
    ┌─────────────────────┐                                  │
    │     API SERVER       │                                 │
    │   Express + DI       │──── Redis SUBSCRIBE ────────────┘
    │   Port 3000          │     (job.status.{jobId})
    └────┬────────┬────────┘
         │        │
    DB INSERT   MQ PUBLISH
    (PENDING)   (encrypted)
         │        │
         ▼        ▼
   ┌──────────┐  ┌──────────────────┐
   │PostgreSQL│  │    RabbitMQ      │
   │          │  │                  │
   │ jobs     │  │ automation.jobs  │──┐
   │ quotes   │  │ automation.dlq   │  │  DLX routing
   └──────────┘  └────────┬─────────┘  │  on nack
                          │            │
                    CONSUME│            │
                          ▼            │
                ┌──────────────────┐   │
                │     WORKER       │   │
                │  Job Processor   │   │
                │  + Playwright    │   │
                └───┬──────┬───────┘   │
                    │      │           │
              DB UPDATE  Redis PUBLISH │
              (COMPLETED) (status event)
                    │      │
                    ▼      ▼
              ┌──────┐  ┌──────┐
              │ DB   │  │Redis │──► API SSE ──► Frontend
              └──────┘  └──────┘

                ┌──────────────────┐
                │   VENDOR SITE    │
                │  Mock Portal     │◄── Playwright navigates here
                │  Port 4201       │
                └──────────────────┘
```

---

## 2. COMPLETE REQUEST LIFECYCLE (STEP-BY-STEP)

This section traces what happens when a user submits a job, from click to completion. Every step is annotated with failure modes, delivery guarantees, and idempotency considerations.

### Step 1: User Submits Job Form (Frontend → API)

**What happens:**
1. User fills in `name`, `email`, `quoteId`, selects `vendor` (VENDOR_A or VENDOR_B).
2. `JobForm.tsx` calls `createJob()` from `apps/frontend/src/api/jobs.ts`.
3. This sends `POST http://localhost:3000/api/jobs` with JSON body.

**Why this component is needed:**
The frontend is the human interface. It collects structured input and provides visual feedback.

**What if it fails:**
- Network error → user sees error message, can retry.
- No side effects yet. Nothing is persisted anywhere.

**Delivery guarantee:** None at this point — it's a user-initiated HTTP call.

### Step 2: API Validates and Creates Job (API → PostgreSQL)

**What happens:**
1. `job.routes.ts` receives the POST. Validates required fields and vendor type.
2. Calls `jobService.createJob(dto)`.
3. `JobService` generates a UUID (`uuidv4()`), then calls `jobRepo.create()`.
4. Prisma inserts a row into the `jobs` table with `status = 'PENDING'`.

**Relevant code (simplified):**
```typescript
// job.service.ts
const jobId = uuidv4();
await this.jobRepo.create({
    id: jobId,
    vendor: dto.vendor,
    status: JobStatus.PENDING,
    inputPayload: dto,
});
```

**Why this step is needed:**
The database is the **source of truth** for job existence and status. Even if RabbitMQ is temporarily down, the job record exists. You can query it, display it, and manually re-queue it later. Without this, a RabbitMQ failure means the job vanishes entirely.

**What if it fails:**
- DB connection error → API returns 500 → user sees error → no orphaned state.
- This is the first mutation. If it fails, the whole operation is cleanly aborted.

**Delivery guarantee:** Exactly-once for the DB insert (single SQL INSERT; UUIDs guarantee no collisions).

**Idempotency consideration:** The UUID is generated server-side. If the client retries the same POST, a *new* job is created with a different ID. To make this idempotent, you'd need a client-provided idempotency key (not implemented yet).

### Step 3: Encrypt and Publish to RabbitMQ (API → RabbitMQ)

**What happens:**
1. `JobService` builds a `JobMessage` object containing `jobId`, `vendor`, and `payload`.
2. Serializes to JSON and encrypts with AES using the shared `ENCRYPTION_KEY`.
3. Publishes to `automation.exchange` with routing key `job.process`.
4. Message properties: `persistent: true`, header `x-max-retries: 3`.

**Relevant code:**
```typescript
const encrypted = encryptMessage(JSON.stringify(message), config.ENCRYPTION_KEY);
await this.rabbitMQ.publish(encrypted, {
    headers: { 'x-max-retries': dto.maxRetries || 3 }
});
```

**Why encryption:**
Messages on the queue contain PII (name, email). If RabbitMQ is compromised, the attacker sees ciphertext, not plaintext. AES symmetric encryption with `crypto-js` provides defense-in-depth.

**Why `persistent: true`:**
This tells RabbitMQ to write the message to disk. If the broker restarts, the message survives. Without it, messages exist only in RAM and are lost on restart.

**What if it fails:**
- RabbitMQ is down → `publish()` throws → API returns 500.
- **Critical gap:** The job was already written to DB as PENDING in Step 2. Now it's an orphan — it exists in DB but never reaches the queue. **This is a real bug.** Fix: wrap Steps 2 and 3 in a transaction/saga pattern, or implement a transactional outbox.

**Delivery guarantee:** At-most-once for the publish itself (the `publish()` call in amqplib is fire-and-forget without publisher confirms). To get at-least-once, enable RabbitMQ publisher confirms.

### Step 4: API Returns jobId (API → Frontend)

**What happens:**
```typescript
res.status(201).json({ jobId });
```
The API returns the `jobId` immediately. The frontend now has a handle to track the job.

**Critical insight:** The job is NOT finished. The API returned in ~50ms. The actual browser automation hasn't started yet. This is the essence of async processing — the HTTP request/response is completely decoupled from the job execution.

### Step 5: Frontend Opens SSE Connection (Frontend → API → Redis)

**What happens:**
1. `JobStatus.tsx` receives `jobId` as a prop.
2. Creates `EventSource` pointing to `GET /api/jobs/:id/stream`.
3. The API route handler:
   - Verifies the job exists.
   - Sends SSE headers (`Content-Type: text/event-stream`).
   - Sends the current job state as the first SSE event.
   - If already terminal (COMPLETED/FAILED), closes immediately.
   - Otherwise, subscribes to Redis channel `job.status.{jobId}`.
   - Starts a heartbeat every 15 seconds to prevent proxy timeouts.

**Relevant code:**
```typescript
res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
});
res.write(`data: ${JSON.stringify(job)}\n\n`);

await redis.subscribeToJob(jobId, (_channel, message) => {
    res.write(`data: ${message}\n\n`);
});
```

**Why SSE and not WebSockets:**
SSE is simpler. The data flows one direction: server → client. The frontend never sends status updates TO the server. SSE uses plain HTTP, works through proxies and load balancers without special configuration, and auto-reconnects natively via the `EventSource` API.

**What if the SSE connection drops:**
The frontend's `EventSource.onerror` fires. The current implementation closes and stops. A more robust implementation would reconnect with exponential backoff. The user can still poll `GET /api/jobs/:id` manually—the job state is persisted in DB.

### Step 6: Worker Consumes Message (RabbitMQ → Worker)

**What happens:**
1. The worker process started earlier with `processor.start()`.
2. `RabbitMQClient.consume()` is actively listening on `automation.jobs.v2`.
3. Prefetch is set to 1 — the worker processes exactly one job at a time.
4. When a message arrives, the handler receives the raw encrypted content and the `x-retry-count` header.

**Why prefetch=1:**
Each job launches a full Chromium browser. Memory usage per browser: ~100–300MB. Prefetch=1 ensures the worker doesn't pull 10 messages and try to run 10 browsers simultaneously, which would OOM the process.

**What if it fails:**
- Worker crashes before consuming → message stays in queue (unacked messages return to the queue).
- Worker crashes after consuming but before ack → depends on whether ack was sent. See Step 10.

### Step 7: Decrypt and Parse (Worker)

**What happens:**
```typescript
const decrypted = decryptMessage(encryptedMessage, config.ENCRYPTION_KEY);
const jobMessage: JobMessage = JSON.parse(decrypted);
const { jobId, vendor, payload } = jobMessage;
```
AES decryption with the same shared key. If the key is wrong, you get garbage or an error.

**What if it fails:**
- Wrong encryption key → decryption returns garbled text → `JSON.parse` throws → `catch` block triggers → message is retried or sent to DLQ.
- This is a permanent failure—retrying won't help. The message should go straight to DLQ.

### Step 8: Simulated Failure Check (Worker)

**What happens:**
```typescript
if (Math.random() < config.SIMULATED_FAILURE_RATE) {
    throw new Error(`Simulated random failure (Rate: ${config.SIMULATED_FAILURE_RATE})`);
}
```
This is a testing/debugging feature. It randomly throws errors to test the retry and DLQ machinery.

**Why it exists:** You built this to verify that the retry logic and DLQ routing actually work without needing real vendor failures.

### Step 9: Update Status to IN_PROGRESS (Worker → DB + Redis)

**What happens:**
1. `jobRepo.updateStatus(jobId, JobStatus.IN_PROGRESS)` — SQL UPDATE.
2. `publishStatusUpdate(jobId, JobStatus.IN_PROGRESS)` — Redis PUBLISH to `job.status.{jobId}`.
3. The API's SSE route receives this Redis message and forwards it to the frontend.
4. The frontend's `JobStatus` component adds it to the timeline.

**Why both DB AND Redis:**
- **DB** is the durable source of truth. If Redis is down, you can still query the DB for the current status.
- **Redis Pub/Sub** is the real-time notification channel. The DB can't push changes to the API—it can only respond to queries. Redis Pub/Sub allows the worker to "push" status changes to anyone listening in real-time.

### Step 10: Run Playwright Automation (Worker → Vendor Site)

**What happens:**
1. `VendorFactory.getVendor(vendor)` returns the correct `IVendorAutomation` implementation.
2. `vendorAutomation.run(payload)` is called:
   a. **Launch browser** — either local (`chromium.launch()`) or remote (`chromium.connectOverCDP(wsEndpoint)`).
   b. **Create context** — `browser.newContext()` creates an isolated browser context (like an incognito window). Each job gets its own context, so cookies/session from one job don't leak into another.
   c. **Navigate** — `page.goto(vendorSiteUrl, { waitUntil: 'networkidle' })`. The `networkidle` strategy waits until there are no network requests for 500ms, ensuring the page is fully loaded.
   d. **Fill form** — `page.fill('#name', ...)`, `page.fill('#email', ...)`, `page.fill('#quoteId', ...)`.
   e. **Submit** — `page.click('#submit-btn')`.
   f. **Wait for result** — `page.waitForSelector('#result, #error', { timeout: 30000 })`. Waits up to 30 seconds for either the success or error element to appear.
   g. **Scrape** — `resultElement.textContent()` extracts the text.
   h. **Close browser** — in the `finally` block, always.

**Browser lifecycle:**
```
chromium.launch() → browser
  browser.newContext() → context (isolated session)
    context.newPage() → page
      page.goto(url)
      page.fill(selector, value)
      page.click(selector)
      page.waitForSelector(selector)
      page.$(selector).textContent()
    page is closed with context
  context is closed
browser.close()
```

**Why Playwright instead of HTTP calls (e.g., Axios):**
The vendor site is a JavaScript-rendered React SPA. The form submission triggers client-side state changes and async processing. There is no REST API to call directly. The only way to interact with it is through a real browser that can:
- Execute JavaScript
- Handle DOM mutations
- Wait for dynamic content to appear
- Interact with form elements

An HTTP GET to the vendor site would return an empty React shell (`<div id="root"></div>`), not the rendered form.

**What if it fails:**
- Navigation timeout → Error thrown → caught by job-processor → retry logic in RabbitMQ client.
- Browser crash → Playwright throws → same retry path.
- Vendor site 10% failure → `#error` element appears → `throw new Error('Vendor error: ...')`.
- All of these trigger the retry/DLQ machinery.

### Step 11: Save Results (Worker → DB)

**What happens:**
1. `quoteRepo.create(jobId, result)` — inserts into the `quotes` table.
2. `jobRepo.updateResult(jobId, result)` — updates the `jobs` table with `status = COMPLETED` and `result_payload = <scraped data>`.

**Why two tables:**
The `jobs` table stores status and a copy of the result for simple queries. The `quotes` table is a normalized store for the actual business data (the scraped quote result). A job has many quotes (one-to-many via `jobId`), allowing future extension where a single job might produce multiple quotes.

### Step 12: Publish COMPLETED Status (Worker → Redis → API → Frontend)

**What happens:**
```typescript
await this.publishStatusUpdate(jobId, JobStatus.COMPLETED, result);
```
Redis receives a JSON event on channel `job.status.{jobId}`. The API's SSE handler forwards it. The frontend displays the green "COMPLETED" badge and the scraped result text.

### Step 13: ACK the Message (Worker → RabbitMQ)

**What happens:**
Back in `rabbitmq-client.ts`, after the handler resolves successfully:
```typescript
this.channel.ack(msg);
```
This tells RabbitMQ: "I'm done processing this message. Remove it from the queue permanently."

**What if ack is never sent (worker crashes):**
RabbitMQ marks the message as "unacked." When the consumer's connection drops, RabbitMQ requeues the message for another consumer (or the same one when it reconnects). This gives you **at-least-once delivery**.

### Step 14: Failure Path — Retry or DLQ

If the handler throws (Steps 7–10), the `catch` block in `consume()` fires:

```
retryCount < maxRetries?
  YES → Publish NEW message with x-retry-count + 1, ACK original
  NO  → NACK without requeue → DLX routes to DLQ
```

**Why republish instead of nack+requeue:**
Native nack+requeue puts the message back at the head of the queue with the same headers. There's no way to increment a counter in the message itself. So the system creates a brand new message with `x-retry-count: N+1` and acks the old one. This gives explicit control over the retry count.

**DLQ routing works because:**
The main queue was declared with:
```typescript
arguments: {
    'x-dead-letter-exchange': 'automation.dlx',
    'x-dead-letter-routing-key': 'job.dead',
}
```
When a message is nacked without requeue, RabbitMQ automatically routes it to `automation.dlx` → `automation.jobs.dlq`.

---

## 3. TECHNOLOGY DEEP DIVE

### 3A. RabbitMQ

**What is it:** A message broker that implements the AMQP 0-9-1 protocol. Think of it as a post office for your application's messages.

**Exchange Types in this system:**
- `automation.exchange` — type: `direct`, durable. Routes messages to the main queue using routing key `job.process`.
- `automation.dlx` — type: `direct`, durable. Routes dead-lettered messages using routing key `job.dead`.

**Queue topology:**
```
Producer (API)
    │
    │ publish(exchange='automation.exchange', routingKey='job.process')
    ▼
┌───────────────────────────┐
│  automation.exchange       │  (direct, durable)
│  Binding: job.process → ──┼──► automation.jobs.v2  (main queue)
└───────────────────────────┘       │
                                    │ x-dead-letter-exchange: automation.dlx
                                    │ x-dead-letter-routing-key: job.dead
                                    ▼
                              ┌───────────────────────────┐
                              │  automation.dlx            │ (direct, durable)
                              │  Binding: job.dead → ─────┼──► automation.jobs.dlq
                              └───────────────────────────┘
```

**Consumer Acknowledgement modes:**
- `ack(msg)` — "I processed it successfully, delete it."
- `nack(msg, false, true)` — "I failed, put it back in the queue." (requeue=true)
- `nack(msg, false, false)` — "I failed permanently, send to DLX/DLQ." (requeue=false)

**Durable queues vs persistent messages:**
- **Durable queue**: The queue definition survives broker restart. It's like saving the mailbox.
- **Persistent message**: The message content is written to disk, not just RAM. It's like saving the letter inside the mailbox.
- You need BOTH for messages to survive a broker restart.

**Retry pattern used (manual republish):**

| Attempt | x-retry-count | What happens |
|---------|--------------|-------------|
| 1st | 0 (default) | Handler processes, fails, republish with count=1, ack original |
| 2nd | 1 | Handler processes, fails, republish with count=2, ack original |
| 3rd | 2 | Handler processes, fails, republish with count=3, ack original |
| 4th | 3 | count >= maxRetries(3), nack without requeue → DLQ |

### 3B. Redis

**Role in this project:** Redis serves exactly one purpose — **real-time Pub/Sub** to bridge the Worker and API for SSE streaming.

**It is NOT used for:**
- Caching (no GET/SET with TTL)
- Rate limiting
- Session storage
- Job queuing (that's RabbitMQ)

**Why two connections:**
```typescript
this.publisher = new Redis({ host, port });
this.subscriber = new Redis({ host, port });
```
When a Redis client enters subscriber mode (`SUBSCRIBE`), it can ONLY receive messages and manage subscriptions. It cannot issue `PUBLISH`, `GET`, `SET`, or any other command. So you need a separate connection for publishing.

**Channel naming:**
```
job.status.{jobId}   e.g., job.status.a1b2c3d4-e5f6-7890-abcd-ef1234567890
```
Each job gets its own channel. This means:
- The API subscribes only to the specific job the SSE client cares about.
- The worker publishes to the exact channel for the job it's processing.
- No fan-out waste — messages go only where needed.

**Pub/Sub is fire-and-forget:**
If nobody is subscribed when a message is published, the message is lost. Redis Pub/Sub has no persistence. This is fine because:
- The DB is the durability layer.
- If the SSE client isn't connected yet, it gets the initial state from the DB.
- If the SSE client disconnects and reconnects, it queries the DB for current state.

**Failure recovery:**
If Redis goes down, SSE stops working but the job still processes. The worker catches and logs the Redis publish error, then continues with the DB update. The user can refresh the page and query the API to get the final state from PostgreSQL.

### 3C. PostgreSQL

**Schema:**
```sql
TABLE jobs (
    id              UUID PRIMARY KEY,
    vendor          TEXT,           -- 'VENDOR_A' or 'VENDOR_B'
    status          TEXT DEFAULT 'PENDING',  -- PENDING | IN_PROGRESS | COMPLETED | FAILED
    input_payload   JSONB,         -- Original form submission
    result_payload  JSONB,         -- Scraped quote data (nullable)
    error_message   TEXT,          -- Error details (nullable)
    created_at      TIMESTAMP DEFAULT now(),
    updated_at      TIMESTAMP      -- Auto-updated by Prisma
)

TABLE quotes (
    id              UUID PRIMARY KEY,
    job_id          UUID REFERENCES jobs(id),
    data            JSONB,         -- Scraped quote result
    created_at      TIMESTAMP DEFAULT now()
)
```

**Indexes:**
```
@@index([status])     -- For querying jobs by status (e.g., "show all FAILED jobs")
@@index([createdAt])  -- For time-range queries (e.g., "jobs in the last hour")
```

**Why JSONB for payloads:**
The input/output payloads are semi-structured — they vary by vendor type and may evolve over time. JSONB lets you store flexible data without schema migrations for every field change. PostgreSQL JSONB supports indexing, querying with operators (`->`, `->>`, `@>`), and is stored in a compressed binary format.

**Why `status` is TEXT and not an ENUM:**
In Prisma, using a native PostgreSQL ENUM requires a migration every time you add a new status. Using TEXT with application-level validation (the `JobStatus` TypeScript enum) is simpler and more flexible. The tradeoff is weaker database-level constraints—the DB will accept any string, not just valid statuses.

**Transaction boundaries:**
Currently, each DB operation is a separate query. There's no transaction wrapping Steps 2+3 (create job + publish to RabbitMQ). This means:
- If the DB create succeeds but RabbitMQ publish fails → orphaned PENDING job.
- If the worker updates status to IN_PROGRESS but the Playwright step fails → the DB shows IN_PROGRESS but the job is actually being retried.

**Why job status is stored in DB AND published via events:**
- **DB**: durability. The status persists across crashes, restarts, and deployments. Any component can query the current state at any time.
- **Redis events**: immediacy. Push notification to interested parties in real-time (milliseconds). Polling the DB every 100ms would be far too expensive.

### 3D. Playwright

**What it is:** A browser automation library by Microsoft. It controls Chromium, Firefox, or WebKit via the Chrome DevTools Protocol (CDP) over WebSocket.

**Architecture under the hood:**
```
Node.js Process (Worker)
    │
    │ WebSocket (CDP)
    ▼
Chromium Browser Process
    │
    ├── Browser Context 1 (like incognito)
    │       └── Page (tab)
    │
    └── Browser Context 2
            └── Page (tab)
```

**Why `browser.newContext()` per job:**
Each context is an isolated session with its own cookies, localStorage, and cache. This prevents cross-contamination between jobs. If Job A sets a cookie on the vendor site, Job B won't see it.

**`waitUntil: 'networkidle'`:**
Playwright waits until there are zero network requests for 500ms. This is the most reliable strategy for SPAs that load data asynchronously. Alternatives:
- `'load'` — waits for the `load` event (DOM + images). Doesn't wait for XHR/fetch.
- `'domcontentloaded'` — waits for HTML parsing. Very early; JS hasn't executed yet.

**`waitForSelector('#result, #error', { timeout: 30000 })`:**
This is a CSS selector combinator. Playwright watches the DOM tree and resolves as soon as ANY element matching `#result` OR `#error` appears. This handles both success and failure paths with a single wait call. The 30-second timeout prevents infinite hangs if the vendor site is broken.

**Security implications:**
- The worker runs a full browser process. A malicious vendor site could attempt to exploit browser vulnerabilities.
- Each job gets a fresh context, limiting damage from cookie/session attacks.
- **Risk:** If `headless: false` (current default for dev), a local attacker could see the browser window and interact with it. In production, always use `headless: true`.

**Scalability constraints:**
Each Chromium instance uses 100–300MB RAM and significant CPU. A machine with 4GB RAM can realistically run 8–15 concurrent browsers. This is why the worker uses `prefetch=1` — it processes one job at a time.

### 3E. SSE (Server-Sent Events)

**What it is:** A unidirectional server → client streaming protocol built on top of standard HTTP.

**SSE vs WebSockets:**

| Feature | SSE | WebSockets |
|---------|-----|-----------|
| Direction | Server → Client only | Bidirectional |
| Protocol | HTTP/1.1 or HTTP/2 | Upgrade to ws:// |
| Auto-reconnect | Built-in (`EventSource`) | Must implement manually |
| Binary data | No (text only) | Yes |
| Complexity | Simple | More complex |
| Proxy support | Works through HTTP proxies | May require special config |

SSE is the right choice here because the data flow is unidirectional: status updates flow from the server to the client. The client never sends status updates.

**Connection lifecycle in this system:**
1. Client opens `EventSource` → HTTP GET with `Accept: text/event-stream`.
2. Server sends headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
3. Server pushes current job state immediately.
4. Server subscribes to Redis channel.
5. Each Redis message is forwarded as `data: {...}\n\n`.
6. Heartbeat every 15 seconds: `: heartbeat\n\n`. (Comment line in SSE, ignored by client, prevents TCP timeout.)
7. On terminal state (COMPLETED/FAILED), client closes `EventSource`.
8. On client disconnect, server unsubscribes from Redis.

---

## 4. FAILURE & RESILIENCY ANALYSIS

### 4.1 Worker Crashes Mid-Job

**Scenario:** Worker has consumed a message, updated status to IN_PROGRESS, launched Playwright, and is mid-scrape. Worker process is killed (OOM, SIGKILL, power failure).

**What happens:**
1. The RabbitMQ message was NOT acked yet. RabbitMQ detects the consumer's TCP connection dropped.
2. RabbitMQ requeues the message (unacked messages return to the queue on consumer disconnect).
3. The same worker (when restarted) or another worker picks up the message.
4. The DB still shows IN_PROGRESS.

**Problems:**
- The retry will update the DB to IN_PROGRESS again (no-op, already IN_PROGRESS).
- If the first attempt actually scraped a result but crashed before saving, the second attempt duplicates the work but doesn't create duplicate DB records (idempotent final write by jobId).
- **Gap:** If the browser was launched but never closed (process killed), you might have orphaned Chromium processes consuming resources. On Heroku, the dyno restart cleans this up. On a bare VM, you'd need process monitoring.

### 4.2 RabbitMQ Restarts

**Scenario:** RabbitMQ broker process restarts or the container is recreated.

**What happens:**
- **Queues survive** because both queues are declared `durable: true`.
- **Messages survive** because they're published with `persistent: true`.
- **Consumer connections drop.** The worker's `amqplib` connection throws an error.
- **Current gap:** The worker does NOT implement reconnection logic. If RabbitMQ restarts, the worker crashes and must be manually restarted.

**Fix needed:** Implement connection recovery with exponential backoff. `amqplib` does not auto-reconnect; you must listen for the `close` event and reconnect manually.

### 4.3 Redis Goes Down

**Scenario:** Redis container crashes.

**What happens:**
- SSE connections stop receiving updates (the subscribe callback never fires).
- Worker's `publishStatus()` throws an error, but it's caught → job processing continues.
- Job still completes → DB is updated → user can refresh the page and see the result from the DB via `GET /api/jobs/:id`.

**Impact:** Loss of **real-time** updates only. No data loss.

### 4.4 Playwright Crashes

**Scenario:** Chromium process crashes during automation.

**What happens:**
- Playwright throws an error (e.g., `browser.close()` or `page.goto()` fails).
- The error propagates to `job-processor.ts` catch block.
- DB is updated with FAILED status and error message.
- Redis publishes FAILED status.
- The error is re-thrown → `rabbitmq-client.ts` catch block → retry logic kicks in.
- If retries remain, a new message is published with incremented retry count.
- If max retries reached, message goes to DLQ.

### 4.5 DLQ Depth Monitoring

**How it works:**
```typescript
// worker/main.ts
setInterval(async () => {
    await rabbitMQ.checkDlqDepth();
}, 60000); // Every 60 seconds
```

```typescript
// rabbitmq-client.ts
async checkDlqDepth(): Promise<number> {
    const { messageCount } = await this.channel.checkQueue(DLQ_QUEUE);
    if (messageCount > 5) {
        console.error(`[OPERATIONS ALERT] DLQ depth is ${messageCount}`);
    }
    return messageCount;
}
```

The Dashboard frontend polls `GET /api/admin/stats` every 5 seconds for the DLQ count.

**Limitation:** The "alert" is just a `console.error`. In production, this should trigger PagerDuty/Slack/email notifications.

### 4.6 Delivery Semantics Summary

| Component | Guarantee | Explanation |
|-----------|----------|-------------|
| API → DB | Exactly-once | Single SQL INSERT |
| API → RabbitMQ | At-most-once | No publisher confirms enabled |
| RabbitMQ → Worker | At-least-once | Unacked messages are requeued on disconnect |
| Worker → DB | At-least-once | May re-run on retry, but UPDATE is idempotent by jobId |
| Worker → Redis | At-most-once | Fire-and-forget publish |

### 4.7 Idempotent Job Processing

Currently, the system is **NOT** fully idempotent. If a job is retried:
- The DB update to COMPLETED is idempotent (same jobId, overwrites previous state).
- But `quoteRepo.create(jobId, result)` creates a NEW quote row each time → **duplicate quotes on retry**.

**Fix:** Add a unique constraint on `(job_id)` in the `quotes` table, or check for existing quotes before inserting.

---

## 5. PERFORMANCE & SCALABILITY

### 5.1 Horizontal Scaling Strategy for Workers

Workers are stateless consumers. To scale:
1. Start N worker processes, each connecting to the same RabbitMQ queue.
2. RabbitMQ distributes messages round-robin across consumers.
3. Each worker processes one job at a time (prefetch=1).
4. 10 workers = 10 concurrent browser automations.

**Constraint:** Each worker needs enough RAM for one Chromium instance (~200MB). A 2GB machine can support 5–8 workers.

### 5.2 Bottlenecks

| Bottleneck | Component | Why | Mitigation |
|-----------|-----------|-----|-----------|
| **Memory** | Worker + Playwright | Each browser uses 100-300MB RAM | Remote browsers (Browserless) |
| **CPU** | Worker + Playwright | Browser rendering is CPU-intensive | More workers on more machines |
| **DB connections** | Prisma | Default pool size ~5 connections | Use PgBouncer or increase pool |
| **Single channel** | RabbitMQ | All publishing through one channel | Use channel pooling |
| **SSE connections** | API Server | Each SSE holds an open HTTP connection | Use HTTP/2 multiplexing or a dedicated SSE service |

### 5.3 Under 10x Load (100 concurrent jobs)

| Component | Current (10 jobs) | At 100 jobs |
|-----------|------------------|-------------|
| API Server | 10 SSE connections | 100 SSE connections (OK for Node.js) |
| RabbitMQ | 10 messages queued | 100 messages queued (trivial) |
| Worker (1 instance) | 1 job at a time, 10 in queue | 1 job at a time, 100 in queue (slow backlog) |
| Workers (10 instances) | N/A | 10 concurrent, 90 in queue (10x faster) |
| PostgreSQL | 10 rows | 100 rows (trivial) |
| Redis | 10 channels | 100 channels (trivial) |
| Browser RAM | 200MB per worker | 200MB × 10 workers = 2GB total |

**The bottleneck at 10x is always Playwright.** The queue and DB are fast and cheap. Browser automation is the expensive, slow operation.

### 5.4 Where Rate Limiting Should Exist

1. **API POST /api/jobs** — Prevent a client from submitting thousands of jobs per second. Use `express-rate-limit` with IP-based limiting (e.g., 10 jobs/minute per IP).
2. **Vendor site** — Real vendor sites will rate-limit or block automated traffic. Implement per-vendor concurrency limits in the worker.
3. **RabbitMQ publish rate** — Not needed unless you have a misbehaving producer.

---

## 6. CODE WALKTHROUGH

### 6.1 API Route Handling (`apps/api/src/routes/job.routes.ts`)

```typescript
router.post('/jobs', async (req, res, next) => {
    // 1. Destructure and validate
    const { name, email, quoteId, vendor } = req.body as CreateJobDto;
    if (!name || !email || !quoteId || !vendor) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // 2. Validate vendor enum
    if (!Object.values(VendorType).includes(vendor)) {
        return res.status(400).json({ error: 'Invalid vendor type' });
    }

    // 3. Create job (DB + MQ) and return immediately
    const jobId = await jobService.createJob(dto);
    res.status(201).json({ jobId });
});
```

**Line-by-line:**
- `req.body as CreateJobDto` — TypeScript type assertion. Express parsed the JSON body via `express.json()` middleware.
- Validation is manual. In production, use Zod or Joi schemas for proper validation with error messages.
- `jobService.createJob()` is the orchestration method that writes to DB then publishes to RabbitMQ.
- `res.status(201)` — HTTP 201 Created is the correct status for resource creation.

### 6.2 Message Publishing (`libs/messaging/src/rabbitmq-client.ts`)

```typescript
this.channel.publish(
    MAIN_EXCHANGE,       // 'automation.exchange'
    MAIN_ROUTING_KEY,    // 'job.process'
    Buffer.from(message), // Encrypted message as binary
    {
        persistent: true,   // Write to disk (survive broker restart)
        contentType: 'application/json',
        headers: options?.headers, // { x-max-retries: 3 }
    }
);
```

**Line-by-line:**
- `publish()` sends to an EXCHANGE, not directly to a queue. The exchange uses the routing key to decide which queue receives the message.
- `Buffer.from(message)` — AMQP requires binary content. The message is already encrypted, so it's a base64-like string.
- `persistent: true` corresponds to `deliveryMode: 2` in AMQP. Mode 1 is transient (RAM only).

### 6.3 Worker Processing Logic (`apps/worker/src/job-processor.ts`)

```typescript
await this.rabbitMQ.consume(async (encryptedMessage, retryCount) => {
    // Decrypt
    const decrypted = decryptMessage(encryptedMessage, config.ENCRYPTION_KEY);
    const jobMessage = JSON.parse(decrypted);

    try {
        // Failure simulation
        if (Math.random() < config.SIMULATED_FAILURE_RATE) throw new Error('Simulated failure');

        // Update to IN_PROGRESS
        await this.jobRepo.updateStatus(jobId, JobStatus.IN_PROGRESS);
        await this.publishStatusUpdate(jobId, JobStatus.IN_PROGRESS);

        // Run automation
        const vendorAutomation = this.vendorFactory.getVendor(vendor);
        const result = await vendorAutomation.run(payload);

        // Save result
        await this.quoteRepo.create(jobId, result);
        await this.jobRepo.updateResult(jobId, result);

        // Publish completion
        await this.publishStatusUpdate(jobId, JobStatus.COMPLETED, result);
    } catch (error) {
        // Save error, publish failure, re-throw for retry/DLQ
        await this.jobRepo.updateError(jobId, errorMessage);
        await this.publishStatusUpdate(jobId, JobStatus.FAILED, undefined, errorMessage);
        throw error;
    }
});
```

**Critical insight:** The `throw error` at the end of the catch block is what triggers the retry mechanism. The `consume()` method in `rabbitmq-client.ts` wraps this handler in its own try/catch that handles ack/nack/republish logic.

### 6.4 Playwright Automation (`libs/vendors/src/vendor-a.automation.ts`)

```typescript
// Connect to remote or launch local browser
if (config.BROWSER_WS_ENDPOINT) {
    browser = await chromium.connectOverCDP(config.BROWSER_WS_ENDPOINT);
} else {
    browser = await chromium.launch({ headless: config.BROWSER_HEADLESS });
}

// Isolated context per job
const context = await browser.newContext();
const page = await context.newPage();

// Navigate and interact
await page.goto(config.VENDOR_SITE_URL, { waitUntil: 'networkidle' });
await page.fill('#name', jobData.name);
await page.fill('#email', jobData.email);
await page.fill('#quoteId', jobData.quoteId);
await page.click('#submit-btn');

// Wait for dynamic result
await page.waitForSelector('#result, #error', { timeout: 30000 });

// Check for vendor-side errors
const errorElement = await page.$('#error');
if (errorElement) {
    throw new Error(`Vendor error: ${await errorElement.textContent()}`);
}

// Scrape the result
const scrapedText = await (await page.$('#result'))!.textContent();
return { success: true, data: scrapedText!.trim(), scrapedAt: new Date().toISOString() };
```

### 6.5 SSE Endpoint Implementation (`job.routes.ts`)

```typescript
router.get('/jobs/:id/stream', async (req, res) => {
    // 1. Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',  // Required for SSE
        'Cache-Control': 'no-cache',           // Prevent caching
        'Connection': 'keep-alive',            // Keep TCP open
    });

    // 2. Send initial state
    res.write(`data: ${JSON.stringify(job)}\n\n`);

    // 3. Subscribe to Redis for real-time updates
    await redis.subscribeToJob(jobId, (channel, message) => {
        res.write(`data: ${message}\n\n`);
    });

    // 4. Heartbeat to prevent TCP timeout
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);

    // 5. Cleanup on disconnect
    req.on('close', async () => {
        clearInterval(heartbeat);
        await redis.unsubscribeFromJob(jobId);
    });
});
```

**SSE format:** Each message is `data: <json>\n\n`. The double newline terminates the event. The colon prefix (`: heartbeat`) marks a comment, ignored by `EventSource`.

---

## 7. DESIGN PATTERNS USED

### 7.1 Producer/Consumer Pattern ✅ (Present)
- **Producer:** API server publishes encrypted job messages to RabbitMQ.
- **Consumer:** Worker process consumes messages and processes them.
- This is the backbone of the async architecture.

### 7.2 Pub/Sub Pattern ✅ (Present)
- **Publisher:** Worker publishes status events to Redis.
- **Subscribers:** API server's SSE endpoints subscribe to Redis channels.
- Unlike Producer/Consumer (which has point-to-point delivery), Pub/Sub is broadcast: if 5 SSE clients are watching the same job, they all receive the update.

### 7.3 Factory Pattern ✅ (Present)
- `VendorFactory.getVendor(vendorType)` returns the correct `IVendorAutomation` implementation.
- Adding a new vendor requires: (1) create class implementing `IVendorAutomation`, (2) add case to factory, (3) bind in DI container.

### 7.4 Repository Pattern ✅ (Present)
- `IJobRepository` interface in `libs/core` defines the data access contract.
- `JobRepository` in `libs/database` implements it with Prisma.
- Allows swapping Prisma for another ORM without changing business logic.

### 7.5 Dependency Injection ✅ (Present)
- InversifyJS with `@injectable()` and `@inject()` decorators.
- Two separate DI containers: one for API, one for Worker.
- `SERVICE_IDENTIFIERS` are Symbol tokens used as binding keys.

### 7.6 Singleton Pattern ✅ (Present)
- `PrismaClient` uses the singleton pattern (`getPrismaClient()`).
- Most DI bindings use `inSingletonScope()`.

### 7.7 Saga Pattern ❌ (NOT Present)
- A saga coordinates distributed transactions across services. This system has no compensating transactions. If the RabbitMQ publish fails after the DB insert, the system does not roll back the DB insert.
- **Should be considered:** An outbox pattern or saga would fix the DB+MQ atomicity gap.

### 7.8 CQRS ❌ (NOT Present)
- Command Query Responsibility Segregation separates read and write models. This system uses the same `jobs` table for both writes (status updates) and reads (GET /api/jobs/:id).
- The SSE stream is a lightweight read model, but it's not a separate data store.

### 7.9 Circuit Breaker ❌ (NOT Present)
- No circuit breaker exists. If the vendor site is completely down, every job will fail, retry 3 times, and go to DLQ. The system wastes 4 browser launches per job before giving up.
- **Should be added:** After N consecutive failures for a vendor, stop sending jobs to that vendor for a cooldown period.

### 7.10 Retry Pattern ✅ (Present)
- Manual retry via republishing with incremented counter.
- Max retries configurable via `x-max-retries` header.
- **Missing:** Exponential backoff. Currently retries immediately. Should add increasing delays (1s, 5s, 30s) between retries.

---

## 8. PRODUCTION HARDENING & IMPROVEMENTS

### 8.1 Logging Strategy
**Current:** Pino with `pino-pretty` in development. Logs to stdout.
**Improvements:**
- Add correlation IDs: every log line should include `jobId` for tracing.
- In production, use structured JSON logging (Pino default without `pino-pretty`).
- Ship logs to a centralized platform (Datadog, Grafana Loki, or ELK stack).
- Add request logging middleware for API (request ID, method, path, duration, status code).

### 8.2 Observability
**Add:**
- **Metrics:** Prometheus counters for jobs_created, jobs_completed, jobs_failed, dlq_depth, job_duration_seconds.
- **Tracing:** OpenTelemetry traces spanning API → RabbitMQ → Worker → Playwright → DB. Each trace shows the full lifecycle of a job.
- **Dashboards:** Grafana dashboards for queue depth, processing latency, failure rates, browser memory usage.

### 8.3 Security Hardening
- **CORS** is currently `cors()` with no restrictions (allows all origins). Restrict to your frontend's domain.
- **Input validation** is manual. Use Zod schemas on the API routes.
- **Encryption key** is in `.env`. Use a secrets manager (AWS Secrets Manager, Vault) in production.
- **RabbitMQ credentials** are `guest/guest`. Create dedicated users with minimal permissions.
- **Browser isolation:** Run Playwright in Docker containers or a remote browser service (Browserless) to sandbox execution.

### 8.4 Retry/Backoff Improvements
Replace immediate retry with exponential backoff using RabbitMQ's delayed message exchange plugin, or a simple TTL-based approach:
- Retry 1: wait 1 second
- Retry 2: wait 5 seconds
- Retry 3: wait 30 seconds

### 8.5 Transactional Outbox
Fix the DB-insert + MQ-publish atomicity gap:
1. Write the job AND the outbox message in a single DB transaction.
2. A background process reads the outbox table and publishes to RabbitMQ.
3. After successful publish, mark the outbox entry as "sent."

---

## 9. LEARNING ROADMAP FOR YOU

### Phase 1 — Async Backend Fundamentals (2 weeks)

**Goal:** Deeply understand why synchronous ≠ scalable for IO-heavy work.

| Topic | What to Learn | Resources |
|-------|-------------|-----------|
| Node.js Event Loop | How single-threaded async I/O works. Understand `setTimeout`, `setImmediate`, microtasks vs macrotasks. | Node.js official docs: "The Node.js Event Loop" |
| Promises & async/await | How `await` yields control. What happens when you `await` a DB query. | MDN: "Using Promises" |
| Express middleware chain | How `req → middleware1 → middleware2 → route → res` works. Error handling middleware. | Express.js Guide |
| HTTP 1.1 vs HTTP/2 | Connection multiplexing, keep-alive, head-of-line blocking. | "HTTP/2 in Action" by Barry Pollard |
| REST API design | Status codes, idempotency keys, rate limiting, pagination. | "RESTful Web APIs" by Leonard Richardson |

**Exercise:** Build a simple Express API that accepts a task, writes to PostgreSQL, and returns immediately. Then build a separate "worker" process that polls the DB for pending tasks and processes them.

### Phase 2 — RabbitMQ Internals (2 weeks)

**Goal:** Understand message brokers deeply enough to debug production issues.

| Topic | What to Learn |
|-------|-------------|
| AMQP 0-9-1 protocol | Connections, channels, exchanges, queues, bindings, acknowledgements |
| Exchange types | Direct, fanout, topic, headers — when to use each |
| Message delivery guarantees | `basic.ack`, `basic.nack`, `basic.reject`, publisher confirms |
| Dead Letter Exchanges | How DLX routing works, `x-dead-letter-exchange`, `x-death` headers |
| Queue durability vs message persistence | `durable: true` vs `persistent: true` — you need BOTH |
| Prefetch/QoS | How `prefetch(N)` controls consumer backpressure |
| Clustering & Mirroring | How RabbitMQ HA works (quorum queues in v3.8+) |

**Exercise:** Set up RabbitMQ locally. Create a direct exchange with a DLQ. Publish 100 messages. Have a consumer that fails every 3rd message. Watch messages flow through retries to DLQ.

**Key resource:** RabbitMQ official tutorials (rabbitmq.com/tutorials) — do ALL six.

### Phase 3 — Redis Deep Dive (1.5 weeks)

| Topic | What to Learn |
|-------|-------------|
| Data structures | Strings, hashes, lists, sets, sorted sets, streams |
| Pub/Sub vs Streams | Pub/Sub is fire-and-forget (no persistence). Streams are persistent (like Kafka). Understand when to use each. |
| Persistence (RDB + AOF) | How Redis survives restarts |
| Memory management | `maxmemory`, eviction policies (LRU, LFU, noeviction) |
| Pipelining | How to batch commands for performance |
| Redis Sentinel & Cluster | High availability and horizontal scaling |

**Exercise:** Build a real-time chat app with Redis Pub/Sub. Then rebuild it with Redis Streams and compare the behavior when a subscriber disconnects and reconnects.

### Phase 4 — Browser Automation with Playwright (1.5 weeks)

| Topic | What to Learn |
|-------|-------------|
| Chrome DevTools Protocol (CDP) | How Playwright controls the browser over WebSocket |
| Page lifecycle | `DOMContentLoaded`, `load`, `networkidle` |
| Selectors | CSS selectors, XPath, text selectors, Playwright-specific locators |
| Browser Contexts | Isolated sessions, parallel execution |
| Headless vs headed mode | Debugging strategies |
| Anti-bot detection | User-agent spoofing, stealth plugins, CAPTCHA handling |
| Resource management | Browser memory usage, connection pooling with Browserless |

**Exercise:** Automate logging into a real website (e.g., GitHub), scraping your profile data, and saving it to a file. Handle the case where the login fails (wrong credentials) gracefully.

### Phase 5 — Distributed Systems Reliability (3 weeks)

| Topic | What to Learn |
|-------|-------------|
| CAP Theorem | Consistency vs Availability vs Partition Tolerance |
| Exactly-once delivery | Why it's nearly impossible, and how to simulate it with at-least-once + idempotency |
| Idempotency keys | How to make operations safely retryable |
| Transactional Outbox | Pattern for atomically writing to DB and publishing to message broker |
| Saga Pattern | Coordinating distributed transactions with compensating actions |
| Circuit Breaker | Protecting your system when a dependency is down (Hystrix pattern) |
| Backpressure | How queues absorb load spikes; what happens when they overflow |
| Observability (3 pillars) | Logs + Metrics + Traces. OpenTelemetry. |

**Key books:**
- "Designing Data-Intensive Applications" by Martin Kleppmann (Chapters 8-11)
- "Release It!" by Michael Nygard

### Phase 6 — Production-Grade System Design (Ongoing)

| Topic | What to Learn |
|-------|-------------|
| Container orchestration | Docker, Kubernetes, or Heroku for deployment |
| CI/CD | Automated testing, build pipelines, zero-downtime deployments |
| Load testing | k6, Artillery, or Locust for simulating 100+ concurrent users |
| Database scaling | Connection pooling (PgBouncer), read replicas, partitioning |
| Monitoring & alerting | Grafana + Prometheus, PagerDuty integration |
| Blue/green deployments | Deploying without downtime |
| Secrets management | Vault, AWS Secrets Manager |

**Exercise:** Take this PlayX system and deploy it to Heroku (or Railway). Set up CloudAMQP for RabbitMQ, Heroku Postgres for the DB, and a Redis add-on. Run a load test with 50 concurrent job submissions. Monitor queue depth, processing time, and error rate. Identify and fix the first bottleneck you hit.

---

## Summary — The 5 Most Important Concepts in This System

1. **Async decoupling via message queue** — The API never waits for Playwright. This is non-negotiable for any system with slow operations.

2. **At-least-once delivery with manual retry** — Messages are retried via republishing with an incremented counter. Understand why this is better than `nack(requeue=true)`.

3. **Dual-channel state propagation** — DB for durability, Redis Pub/Sub for real-time. Neither alone is sufficient.

4. **Browser automation as the expensive resource** — Everything else (API, DB, Redis, RabbitMQ) scales cheaply. Playwright is the bottleneck, and the architecture is designed around that constraint.

5. **DLQ as the safety net** — After all retries are exhausted, the message goes to DLQ for human investigation, not silent data loss.

---

*Document generated from complete source code analysis of the PlayX monorepo. Every code reference corresponds to actual files in the codebase.*
