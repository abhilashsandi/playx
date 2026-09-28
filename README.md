# 🚀 Distributed Automation Platform

A mock distributed automation platform built with Nx monorepo architecture to demonstrate async workflows, job orchestration, message queues, browser automation, and extensible vendor integrations.

## Architecture

```
┌─────────────┐     POST /api/jobs      ┌─────────────┐
│   Frontend   │ ──────────────────────► │   API        │
│  React+Vite  │                         │   Express    │
│  :4200       │ ◄── SSE /api/jobs/:id ─ │   :3000      │
└─────────────┘        /stream           └──────┬───────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                        ▼                       ▼                       ▼
                 ┌─────────────┐         ┌─────────────┐        ┌─────────────┐
                 │  PostgreSQL  │         │  RabbitMQ    │        │    Redis     │
                 │   :5432      │         │  :5672/:15672│        │   :6379     │
                 │  Job records │         │  Job queue   │        │  Pub/Sub    │
                 └─────────────┘         └──────┬───────┘        └──────┬──────┘
                                                │                       │
                                                ▼                       │
                                         ┌─────────────┐               │
                                         │   Worker     │───────────────┘
                                         │  (Playwright) │  Publishes status
                                         └──────┬───────┘
                                                │
                                                ▼ Browser Automation
                                         ┌─────────────┐
                                         │ Vendor Site  │
                                         │  :4201       │
                                         └─────────────┘
```

## How It Works (End-to-End Flow)

1. **User submits a job** via the React frontend (name, email, quoteId, vendor type)
2. **API server** validates the request, creates a job record in PostgreSQL (status=PENDING), encrypts the payload, and publishes it to RabbitMQ
3. **API returns jobId** immediately — the frontend opens an SSE connection to track progress
4. **Worker** consumes the encrypted message from RabbitMQ, decrypts it, and updates status to IN_PROGRESS
5. **Playwright** launches a browser (visible by default), navigates to the mock vendor site, fills the form, submits, and waits for results
6. **Vendor site** processes the request (1-3s delay, 10% simulated failure), displays a quote result
7. **Playwright scrapes** the result text from the vendor page DOM
8. **Worker** saves the scraped result to PostgreSQL, updates status to COMPLETED, and publishes via Redis pub/sub
9. **API SSE endpoint** receives the Redis pub/sub event and pushes it to the frontend
10. **Frontend** displays the real-time status update with the scraped result

### On Failure
- Worker updates status to FAILED and nacks the RabbitMQ message
- RabbitMQ retries up to 3 times (tracked via x-death headers)
- After 3 failures, the message is routed to the Dead Letter Queue (DLQ)

## Prerequisites

- **Node.js** v18+ and npm
- **Docker** and Docker Compose

## How to Run Locally

### 1. Start Infrastructure

```bash
docker-compose up -d
```

Verify all containers are healthy:
```bash
docker-compose ps
```

| Service    | Port  | Purpose                |
|------------|-------|------------------------|
| PostgreSQL | 5432  | Job data storage       |
| RabbitMQ   | 5672  | Job message queue      |
| RabbitMQ UI| 15672 | Management (guest/guest)|
| Redis      | 6379  | Pub/sub for SSE bridge |

### 2. Install Dependencies

```bash
npm install
```

### 3. Install Playwright Browsers

```bash
npx playwright install chromium
```

### 4. Set Up Database

```bash
# Copy env file
cp .env.example .env

# Generate Prisma client
npm run db:generate

# Run database migration
npm run db:migrate
```

### 5. Start All Services (4 terminals)

```bash
# Terminal 1: Vendor Site (must start first — Playwright navigates here)
npm run start:vendor-site     # http://localhost:4201

# Terminal 2: API Server
npm run start:api             # http://localhost:3000

# Terminal 3: Worker (starts consuming jobs)
npm run start:worker

# Terminal 4: Frontend
npm run start:frontend        # http://localhost:4200
```

## Testing the Job Flow

1. Open `http://localhost:4200` in your browser
2. Fill in the form: Name, Email, Quote ID, select VendorA
3. Click **Submit Job**
4. Watch the status panel update in real-time:
   - ⏳ **PENDING** → 🔄 **IN_PROGRESS** → ✅ **COMPLETED** (or ❌ **FAILED**)
5. On completion, the scraped quote result is displayed
6. Check RabbitMQ management at `http://localhost:15672` (guest/guest)
7. View logs in your terminals to see the process flow

## 🛠️ Database & Infrastructure Access

### PostgreSQL (pgAdmin 4)
To view job records and automation results:
1. Open **pgAdmin 4**
2. Create a new Server connection:
   - **Host:** `localhost`
   - **Port:** `5433`
   - **Maintenance DB:** `automation_platform`
   - **Username:** `postgres`
   - **Password:** `postgres`
3. Expand `Databases` > `automation_platform` > `Schemas` > `public` > `Tables`
4. Right-click on `Job` table and select `View/Edit Data` > `All Rows`

### Redis (Real-time Status)
Redis is used for pub/sub status updates via SSE. To monitor traffic:
```bash
# Connect to the Redis container
docker exec -it playx-redis redis-cli

# Monitor all activity (includes status publishes)
MONITOR

# Or subscribe to status updates directly
PSUBSCRIBE job.status.*
```

### RabbitMQ
- **Management UI:** `http://localhost:15672`
- **Credentials:** `guest` / `guest`
- **Queue:** View `automation.jobs` for pending work or `automation.jobs.dlq` for failed jobs.

## How to Extend the Vendor System

Adding a new vendor (e.g., VendorB) requires 4 changes:

### 1. Add Vendor Type

```typescript
// libs/shared-types/src/job.types.ts
export enum VendorType {
  VENDOR_A = 'VENDOR_A',
  VENDOR_B = 'VENDOR_B',  // ← Add here
}
```

### 2. Create Automation Class

```typescript
// libs/vendors/src/vendor-b.automation.ts
@injectable()
export class VendorBAutomation implements IVendorAutomation {
  async run(jobData: CreateJobDto): Promise<VendorResult> {
    // Playwright automation for VendorB
  }
}
```

### 3. Register in DI Container

```typescript
// apps/worker/src/container.ts
container.bind<IVendorAutomation>(Symbol.for('VendorBAutomation'))
  .to(VendorBAutomation).inTransientScope();
```

### 4. Add to Factory

```typescript
// libs/vendors/src/vendor.factory.ts
case VendorType.VENDOR_B:
  return this.vendorB;
```

## Project Structure

```
playx/
├── apps/
│   ├── api/                 # Express REST API + SSE
│   ├── worker/              # RabbitMQ consumer + Playwright
│   ├── frontend/            # React + Vite UI
│   └── vendor-site/         # Mock vendor portal
├── libs/
│   ├── shared-types/        # DTOs, enums, interfaces
│   ├── core/                # DI tokens, domain interfaces
│   ├── database/            # Prisma schema + repository
│   ├── messaging/           # RabbitMQ client + encryption
│   ├── infrastructure/      # Redis, config (Zod), logger (pino)
│   └── vendors/             # Vendor automations + factory
├── docker-compose.yml       # PostgreSQL, RabbitMQ, Redis
├── .env.example
├── nx.json
└── tsconfig.base.json
```

## Tech Stack

| Layer          | Tech                          |
|----------------|-------------------------------|
| Monorepo       | Nx                            |
| Language       | TypeScript (strict)           |
| Backend        | Express                       |
| DI             | InversifyJS                   |
| ORM            | Prisma                        |
| Queue          | RabbitMQ (amqplib)            |
| Pub/Sub        | Redis (ioredis)               |
| Automation     | Playwright (Chromium)         |
| Frontend       | React + Vite                  |
| Real-time      | Server-Sent Events (SSE)      |
| Logging        | pino                          |
| Config         | zod (env validation)          |
| Encryption     | crypto-js (AES)               |
