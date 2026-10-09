# Event RSVP API

A small RSVP service built with Node.js ES modules, Fastify, PostgreSQL, Prisma, Redis, and BullMQ. The API and webhook worker run directly on the host. Docker Compose starts only PostgreSQL and Redis.

## Architecture

- PostgreSQL is the source of truth for events, guests, idempotency records, and webhook outbox entries.
- Fastify serves event, RSVP, cancellation, and health endpoints.
- Each RSVP capacity change locks its event row with `SELECT ... FOR UPDATE`. This serializes changes to one event without blocking unrelated events.
- A PostgreSQL partial unique index prevents duplicate active registrations for the same event and normalized email. Cancelled guests may register again.
- The API writes each RSVP change and its outbox event in one transaction.
- The worker polls unpublished outbox rows, publishes BullMQ jobs with the outbox ID as their stable job ID, then marks each row published. Webhook calls happen outside database transactions.
- BullMQ retries failed HTTP requests three times, using exponential backoff beginning at one second. Delivery is at-least-once: a crash between publishing and marking an outbox row can cause the same webhook to be sent more than once. Webhook consumers should be idempotent.
- The local API console exposes BullMQ queue counts, connected worker count, and recent job status at `GET /worker/queue`. Job payloads are not exposed by this monitoring endpoint.
- In development mode, `POST /worker/queue/test-job` enqueues an explicit test webhook delivery. It sends a real webhook request when a worker is running.
- API requests and API/worker/outbox lifecycle and error events are persisted in PostgreSQL's `ServerLog` table. Request bodies and headers are not recorded. Logs can be browsed at `GET /server-logs` and in the test console.

## Requirements

- Node.js 20 or newer
- npm
- Docker with the Compose plugin

## Run locally

1. Copy `.env.example` to `.env` and set `WEBHOOK_URL` to a webhook receiver you control. Do not commit `.env`.
2. Start only the database and queue service:

   ```sh
   docker compose up -d
   ```

3. Install dependencies and create the database schema:

   ```sh
   npm install
   npm run db:generate
   npm run db:migrate
   ```

4. Restart the API and worker after database migrations so they use the updated Prisma client and schema.

5. Start the API in one terminal:

   ```sh
   npm run dev
   ```

6. Start the webhook worker in a second terminal:

   ```sh
   npm run worker
   ```

The API listens on `http://localhost:3000` by default. Open `http://localhost:3000/test` (or `/`) for the browser-based API testing console, or use `http://localhost:3000/health` to check the API. The console can create events, register and cancel RSVPs, inspect event details, list RSVPs with status filtering and pagination, run live API smoke and RSVP concurrency tests (including a concurrent cancellation/idempotency test), and trigger a development-only test webhook. Concurrency tests create permanent test event/RSVP/outbox records, so use a local test database. `PORT` can change the port. Stop the local services with `docker compose down`; named volumes retain data. Use `docker compose down -v` only when you intend to delete the local database and Redis data.

Server logs are stored in PostgreSQL and retained until manually removed. The test console's **Server logs** section supports level/source filters and pagination. The API logs request method, path, status, and response time, but not request bodies or headers. Log persistence depends on PostgreSQL availability; failures to write a log are reported to the process console.

## API

Errors use the format `{ "error": { "code": "...", "message": "..." } }`.

### Health

```http
GET /health
```

### Create an event

```http
POST /events
Content-Type: application/json
```

```json
{
  "title": "Tech Meetup",
  "date": "2026-10-20T18:00:00Z",
  "location": "Bengaluru",
  "capacity": 100
}
```

Returns `201 Created`.

### Get event and RSVP counts

```http
GET /events/{eventId}
```

The response includes `counts.confirmed`, `counts.waitlisted`, and `counts.cancelled`.

### List all events

```http
GET /events
```

Returns an array of all events ordered by date, each with confirmed, waitlisted, and cancelled RSVP counts.

### Inspect the webhook worker queue

```http
GET /worker/queue
```

Returns counts for waiting, active, delayed, failed, and completed jobs, the number of connected workers, and up to 25 recent retained jobs with status, attempt counts, timestamps, and failure reason. Job payloads are omitted. Open the console and select **Refresh queue** to view this information. The worker must be running to process queued jobs; jobs can still be inspected while it is stopped.

In development mode only, click **Trigger test webhook** in the console or send:

```http
POST /worker/queue/test-job
```

This enqueues a `WEBHOOK_TEST` job. If the worker is running, it sends the test payload to the configured `WEBHOOK_URL`. Confirm the destination is one you control before triggering it. The endpoint is disabled outside development mode.

### Read server logs

```http
GET /server-logs?page=1&limit=25&level=ERROR&source=WORKER
```

Filters are optional. `level` accepts `INFO`, `WARN`, or `ERROR`; `source` accepts `API`, `WORKER`, or `OUTBOX`. `limit` defaults to 25 and is capped at 100. The response contains `data` and pagination metadata.

The console's **Concurrent RSVP cancellation test** creates a capacity-one event, registers one confirmed guest and two waitlisted guests, then submits multiple cancellation requests for the same RSVP using the same idempotency key. It verifies that all callers receive the same response, exactly one waitlisted guest is promoted, and the final event counts are correct. Generated events, RSVPs, and webhook outbox jobs are retained; use a local test database and consider the configured webhook receiver before running it.

### Register an RSVP

```http
POST /events/{eventId}/rsvps
Idempotency-Key: a-unique-key-for-this-registration
Content-Type: application/json
```

```json
{
  "name": "Swayam Kumar",
  "email": "swayam@example.com"
}
```

Returns the RSVP with status `CONFIRMED` or `WAITLISTED`. Reuse the same key when retrying a logical request after a timeout. A repeated key with the same normalized request replays the original response; reusing that key with a different request returns `409 Conflict`.

### List RSVPs

```http
GET /events/{eventId}/rsvps?page=1&limit=20&status=CONFIRMED
```

`page` defaults to 1, `limit` defaults to 20 and cannot exceed 100. `status` is optional and may be `CONFIRMED`, `WAITLISTED`, or `CANCELLED`. Results are ordered by creation time and then ID. The response contains `data` and pagination metadata, including the total matching count.

### Cancel an RSVP

```http
POST /rsvps/{rsvpId}/cancel
Idempotency-Key: a-unique-key-for-this-cancellation
```

Cancellation returns the cancelled RSVP and the promoted RSVP, or `null` if no guest was promoted. Cancelling a confirmed RSVP promotes at most one oldest waitlisted guest. Cancelling a waitlisted RSVP does not promote anyone.

## Idempotency and concurrency

Idempotency keys are persisted in PostgreSQL, scoped to the RSVP/event operation, and stored in the same transaction as the result. RSVP creation and cancellation lock the event row before checking capacity or changing status. Database locking, rather than an in-memory mutex, protects the last available spot across API processes. The waitlist is promoted in FIFO order (`createdAt`, then `id`) inside the cancellation transaction.

## Tests

Run the webhook delivery unit tests without external services:

```sh
npm test
```

The PostgreSQL integration tests are skipped unless `TEST_DATABASE_URL` points to a dedicated test database. Those tests truncate their tables before each case, so never point this variable at a database containing data you need.

PowerShell example:

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/event_rsvp_test?schema=public"
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npx prisma migrate deploy
npm test
```

Concurrency behavior is exercised against PostgreSQL by issuing overlapping API requests and checking the resulting committed statuses. It is not inferred from mocked database calls.

## Tradeoffs

- The browser console is for local API testing, not a public attendee website. There is no authentication, organizer account model, or event update/delete API; these are intentionally outside the brief.
- The outbox dispatcher polls in batches and is designed for a single local worker process. Stable queue job IDs reduce duplicates during publication retries, but at-least-once delivery still permits duplicate webhooks in crash windows.
- Idempotency records are retained indefinitely in this take-home implementation. A production deployment should define an explicit retention policy that is longer than the maximum client retry window.
- The health endpoint reports API process availability; it is not a database or Redis readiness probe.

## AI use

AI assistance was used to scaffold the implementation and documentation. The project should be validated locally with the setup and test commands above before relying on it in production.
