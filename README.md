# Event RSVP API

A small RSVP service built with Node.js ES modules, Fastify, PostgreSQL, Prisma, Redis, and BullMQ. The API and webhook worker run directly on the host. Docker Compose starts only PostgreSQL and Redis.

## Architecture

- See [ARCHITECTURE.md](./ARCHITECTURE.md) for the component and data-flow diagrams, persistence model, consistency guarantees, webhook delivery semantics, and operational considerations.
- PostgreSQL is the source of truth for events, guests, idempotency records, and webhook outbox entries.
- Fastify serves event, RSVP, cancellation, and health endpoints.
- Each RSVP capacity change locks its event row with `SELECT ... FOR UPDATE`. This serializes changes to one event without blocking unrelated events.
- A PostgreSQL partial unique index prevents duplicate active registrations for the same event and normalized email. Cancelled guests may register again.
- The API writes each RSVP change and its outbox event in one transaction.
- The worker polls unpublished outbox rows, publishes BullMQ jobs with the outbox ID as their stable job ID, then marks each row published. Webhook calls happen outside database transactions.
- BullMQ retries failed HTTP requests using exponential backoff beginning at one second. `WEBHOOK_MAX_RETRIES` sets retries after the initial attempt (default `2`, for three total attempts; set to `0` to disable retries). Delivery is at-least-once: a crash between publishing and marking an outbox row can cause the same webhook to be sent more than once. Webhook consumers should be idempotent.
- The webhook worker rate-limits delivery to one job per second by default (`WEBHOOK_RATE_LIMIT_MS=1000`). Increase the interval if your receiver, such as webhook.site, has a stricter rate limit.
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

The worker sends at most one webhook job per `WEBHOOK_RATE_LIMIT_MS` interval (default `1000`, one second). Configure a larger positive integer in `.env` if the webhook receiver rate-limits more strictly, then restart the worker. This queues excess jobs rather than slowing RSVP API responses.


Set `WEBHOOK_MAX_RETRIES` to a non-negative integer to control how many retries follow the first failed delivery. The default is `2`, preserving three total attempts. Restart the API and worker after changing it; the setting applies to newly enqueued jobs.

The API listens on `http://localhost:3000` by default. Open `http://localhost:3000/test` (or `/`) for the browser-based API testing console, or use `http://localhost:3000/health` to check the API. The console can create events, register and cancel RSVPs, inspect event details, list RSVPs with status filtering and pagination, run live API smoke and RSVP concurrency tests, and trigger a development-only test webhook. The cancellation concurrency test takes an existing event ID, an RSVP status, and a count; it concurrently cancels that many distinct randomly selected RSVPs of the chosen status, using a separate idempotency key for each cancellation. Cancelling confirmed RSVPs may promote waitlisted guests. These cancellations are permanent and create webhook outbox records, so use a local test event/database; the worker may deliver notifications. `PORT` can change the port. Stop the local services with `docker compose down`; named volumes retain data. Use `docker compose down -v` only when you intend to delete the local database and Redis data.

Server logs are stored in PostgreSQL and retained until manually removed. The test console's **Server logs** section supports level/source filters and pagination. The API logs request method, path, status, and response time, but not request bodies or headers. Log persistence depends on PostgreSQL availability; failures to write a log are reported to the process console.

For safe local API load testing with Autocannon, see [AUTOCANNON_LOAD_TESTING.md](./AUTOCANNON_LOAD_TESTING.md). Mutating load tests write persistent records and RSVP tests can trigger real webhooks, so use a dedicated test database and controlled receiver.

## API reference

Local base URL: `http://localhost:3000`. Send JSON requests with `Content-Type: application/json`. Application errors use this shape:

```json
{ "error": { "code": "ERROR_CODE", "message": "Description" } }
```

Invalid request data generally returns `400 VALIDATION_ERROR`. UUID path parameters must be valid UUIDs.

### `GET /health`

Returns `200 OK`:

```json
{ "status": "ok" }
```

This checks that the API process responds; it does not check database, Redis, or webhook health.

### `POST /events`

Create an event. All fields are required; extra fields are rejected.

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

Validation: `title` is non-blank and at most 200 characters; `date` is an ISO date-time; `location` is non-blank and at most 300 characters; `capacity` is a positive integer.

Returns `201 Created` with the event record (`id`, `title`, `date`, `location`, `capacity`, `createdAt`).

### `GET /events`

List all events, ordered by date then ID. Returns `200 OK` with an array of event records. Each record includes RSVP counts:

```json
{
  "id": "event-uuid",
  "title": "Tech Meetup",
  "date": "2026-10-20T18:00:00.000Z",
  "location": "Bengaluru",
  "capacity": 100,
  "createdAt": "2026-10-10T00:00:00.000Z",
  "counts": { "confirmed": 12, "waitlisted": 2, "cancelled": 1 }
}
```

Returns `[]` when there are no events.

### `GET /events/{eventId}`

Get an event and its RSVP counts (`confirmed`, `waitlisted`, `cancelled`). Returns `200 OK` with the event record as above. Returns `404 EVENT_NOT_FOUND` if it does not exist.

### `GET /events/{eventId}/rsvps`

List RSVPs for an event:

```http
GET /events/{eventId}/rsvps?page=1&limit=20&status=CONFIRMED
```

| Query parameter | Default | Description |
|---|---:|---|
| `page` | `1` | Positive integer page number |
| `limit` | `20` | Page size, integer from 1 to 100 |
| `status` | — | Optional `CONFIRMED`, `WAITLISTED`, or `CANCELLED` filter |

Items are ordered by `createdAt`, then ID. Returns `200 OK`:

```json
{
  "data": [
    {
      "id": "rsvp-uuid",
      "eventId": "event-uuid",
      "name": "Swayam Kumar",
      "email": "swayam@example.com",
      "status": "CONFIRMED",
      "createdAt": "2026-10-10T00:00:00.000Z",
      "cancelledAt": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Returns `404 EVENT_NOT_FOUND` if the event does not exist.

### `POST /events/{eventId}/rsvps`

Register a guest. An `Idempotency-Key` header is required (1–200 characters).

```http
POST /events/{eventId}/rsvps
Idempotency-Key: unique-registration-request-1
Content-Type: application/json
```

```json
{ "name": "Swayam Kumar", "email": "swayam@example.com" }
```

Both properties are required; additional properties are rejected. Name is non-blank and at most 200 characters. Email must be valid and at most 320 characters. Name and email are trimmed, and email is lowercased.

Returns `201 Created` with the RSVP record. The status is `CONFIRMED` if event capacity is available, otherwise `WAITLISTED`.

| Status | Error code | Meaning |
|---:|---|---|
| `400` | `VALIDATION_ERROR` | Invalid body/path/header |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | Missing or invalid idempotency key |
| `404` | `EVENT_NOT_FOUND` | Event does not exist |
| `409` | `RSVP_ALREADY_EXISTS` | Email already has an active RSVP for the event |
| `409` | `IDEMPOTENCY_KEY_REUSED` | Key was used with a different request |

Retry a logical request with the same key and same normalized input to replay its original response.

### `POST /rsvps/{rsvpId}/cancel`

Cancel an RSVP. Requires an `Idempotency-Key` header from 1 to 200 characters.

```http
POST /rsvps/{rsvpId}/cancel
Idempotency-Key: unique-cancellation-request-1
```

Returns `200 OK` with:

```json
{
  "rsvp": {
    "id": "rsvp-uuid",
    "eventId": "event-uuid",
    "name": "Swayam Kumar",
    "email": "swayam@example.com",
    "status": "CANCELLED",
    "createdAt": "2026-10-10T00:00:00.000Z",
    "cancelledAt": "2026-10-10T01:00:00.000Z"
  },
  "promoted": null
}
```

If the cancelled RSVP was confirmed, `promoted` contains the oldest waitlisted RSVP changed to `CONFIRMED`, or `null` if no guest was waiting. Cancelling a waitlisted RSVP does not promote anyone. Errors: `400 VALIDATION_ERROR`, `400 IDEMPOTENCY_KEY_REQUIRED`, `404 RSVP_NOT_FOUND`, or `404 EVENT_NOT_FOUND`.

### `GET /worker/queue`

Inspect BullMQ queue state. Returns `200 OK` with queue name, connected worker count, counts for `active`, `waiting`, `delayed`, `failed`, and `completed`, and up to 25 recent jobs. Job payloads are not included. A worker must be connected to process jobs; queue status is still available while the worker is stopped.

Each job includes `id`, `name`, `state`, `attemptsMade`, configured `attempts`, timestamps (`timestamp`, `processedOn`, `finishedOn`), and `failedReason`.

Returns `503 QUEUE_UNAVAILABLE` if queue monitoring is not configured.

### `POST /worker/queue/test-job` (development only)

Enqueue a test webhook job. This endpoint is enabled only in development and sends a real webhook to `WEBHOOK_URL` if the worker is running; only configure a receiver you control.

Returns `202 Accepted`:

```json
{ "jobId": "generated-job-id", "name": "WEBHOOK_TEST", "status": "queued" }
```

Returns `404 TEST_TRIGGER_DISABLED` outside development or `503 QUEUE_UNAVAILABLE` if the queue is unavailable.

### `GET /server-logs`

Read persisted logs, newest first:

```http
GET /server-logs?page=1&limit=25&level=ERROR&source=WORKER
```

| Query parameter | Default | Accepted values |
|---|---:|---|
| `page` | `1` | Positive integer |
| `limit` | `25` | Integer from 1 to 100 |
| `level` | — | `INFO`, `WARN`, or `ERROR` |
| `source` | — | `API`, `WORKER`, or `OUTBOX` |

Returns `200 OK` with `data` entries (`id`, `level`, `source`, `message`, optional `context`, `createdAt`) and `pagination` (`page`, `limit`, `total`, `totalPages`). Invalid filters or pagination return `400 VALIDATION_ERROR`.

### `GET /` and `GET /test`

Serve the browser-based development console for exercising the API, viewing events/RSVPs, running concurrency tests, inspecting the queue, and browsing logs. Concurrency tests create persistent records; RSVP operations can enqueue real webhooks if a worker is running. Use a dedicated test database and a webhook receiver you control.

## Idempotency and concurrency

Idempotency keys are persisted in PostgreSQL, scoped to the RSVP/event operation, and stored in the same transaction as the result. RSVP creation and cancellation lock the event row before checking capacity or changing status. Database locking, rather than an in-memory mutex, protects the last available spot across API processes. The waitlist is promoted in FIFO order (`createdAt`, then `id`) inside the cancellation transaction.

## Tests

Run the webhook delivery unit tests without external services:

```sh
npm test
```

The PostgreSQL integration tests load `.env` and run whenever `TEST_DATABASE_URL` is set. They truncate the `Event`, `Rsvp`, `IdempotencyRecord`, and `OutboxEvent` tables before each case. Point the URL only at a local/disposable database, or a database whose data you are prepared to lose; never use a production database.
The integration suite includes automated coverage for RSVP confirmation and waitlisting at capacity, concurrent requests for the last available slot, FIFO waitlist promotion after cancellation, cancellation of waitlisted guests, and idempotency/duplicate registration behavior.

PowerShell example:

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/event_rsvp_test?schema=public"
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npx prisma migrate deploy
npm test
```

Keep `TEST_DATABASE_URL` in `.env`; the integration test loads it automatically and uses it in preference to `DATABASE_URL`. Ensure the database has the project migrations applied before running the suite.

Concurrency behavior is exercised against PostgreSQL by issuing overlapping API requests and checking the resulting committed statuses. It is not inferred from mocked database calls.

## Tradeoffs

- The browser console is for local API testing, not a public attendee website. There is no authentication, organizer account model, or event update/delete API; these are intentionally outside the brief.
- The outbox dispatcher polls in batches and is designed for a single local worker process. Stable queue job IDs reduce duplicates during publication retries, but at-least-once delivery still permits duplicate webhooks in crash windows.
- Idempotency records are retained indefinitely in this take-home implementation. A production deployment should define an explicit retention policy that is longer than the maximum client retry window.
- The health endpoint reports API process availability; it is not a database or Redis readiness probe.
- For scale, measure event-row lock contention, coordinate outbox row claims before running multiple dispatchers, and move high-volume logs to a dedicated aggregation service with retention controls. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the rationale and fuller scaling path.

## AI use

AI tools helped draft implementation code, automated tests, and documentation. Suggestions were reviewed against the implementation; the final design notes distinguish outbox publication from webhook delivery, describe delivery as at-least-once (not exactly-once), and clarify that Prisma client generation is separate from applying migrations. The PostgreSQL concurrency tests must still be run against a dedicated test database; AI-generated code or tests alone are not evidence of production readiness.
