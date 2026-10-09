# Load testing the API with Autocannon

This guide runs Autocannon against a local Event RSVP API. Autocannon reports throughput and latency; it does not by itself prove correctness or production capacity.

## Before you start

1. Use a **dedicated local load-test database**, not production or a database containing data you need. The API writes a PostgreSQL `ServerLog` row for every request. Event creation also adds permanent rows; RSVP mutations additionally create RSVP, idempotency, and outbox records.
2. Make sure `.env` `DATABASE_URL` points to the intended test database. Apply migrations and generate the Prisma client:

   ```powershell
   npm run db:generate
   npm run db:migrate
   ```

3. Start the API:

   ```powershell
   npm run dev
   ```

4. Start the worker only if the test includes RSVP writes. Use a webhook receiver you control; RSVP load creates outbox jobs and the worker sends real HTTP requests to `WEBHOOK_URL`. If the worker is stopped, outbox rows and Redis jobs may accumulate instead.
5. Start with a low request rate. Avoid running load tests against a shared or public service without permission.

Autocannon can be run without adding it to this project's dependencies:

```powershell
npx --yes autocannon --version
```

## Read endpoint tests

Use one command per endpoint. `-c` is the number of concurrent connections, `-d` is the run duration in seconds, and `-p 1` disables pipelining so each connection sends one request at a time.

```powershell
$baseUrl = "http://localhost:3000"
$eventId = "replace-with-an-existing-test-event-uuid"

npx --yes autocannon -c 5 -d 10 -p 1 "$baseUrl/health"
npx --yes autocannon -c 5 -d 10 -p 1 "$baseUrl/events"
npx --yes autocannon -c 5 -d 10 -p 1 "$baseUrl/events/$eventId"
npx --yes autocannon -c 5 -d 10 -p 1 "$baseUrl/events/$eventId/rsvps?page=1&limit=20"
npx --yes autocannon -c 2 -d 10 -p 1 "$baseUrl/worker/queue"
npx --yes autocannon -c 2 -d 10 -p 1 "$baseUrl/server-logs?page=1&limit=25"
```

The event detail and RSVP-list tests require an event that exists in the test database. Queue monitoring requires Redis to be reachable. The server-log endpoint reads the same table that receives a log for every request, so it creates database writes while it is being tested; do not interpret it as a read-only workload.

## Event creation test

Event creation does not require an ID or an idempotency key. Each successful request creates a permanent event, and each request also writes a server log. Keep the run short and the connection count low:

```powershell
$body = '{"title":"Autocannon load test","date":"2026-12-01T18:00:00Z","location":"Local test","capacity":100}'
npx --yes autocannon -c 2 -d 5 -p 1 -m POST `
  -H "content-type: application/json" `
  -b $body `
  "http://localhost:3000/events"
```

Review how many records were created before increasing the duration or concurrency. The app does not currently have an event deletion endpoint or automatic cleanup for test records.

## RSVP mutation caution

Do not benchmark `POST /events/{eventId}/rsvps` by repeatedly sending one static Autocannon request with a fixed email and `Idempotency-Key`:

- A repeated key with the same payload replays the original response, so it does not measure new RSVP creation.
- Reusing a key with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- Reusing an email with a new key returns `409 RSVP_ALREADY_EXISTS` once its RSVP is active.
- Distinct successful RSVPs write PostgreSQL RSVP, idempotency, outbox, and server-log rows and may trigger real webhooks.

For RSVP throughput, use a purpose-built harness that generates a unique email and idempotency key for every logical request, targets an isolated database, and monitors PostgreSQL, Redis, the outbox, and webhook receiver. The `/test` console has a bounded concurrency correctness test (up to 100 RSVP requests), but it is a functional test, not a statistically controlled load test.

Cancellation has similar side effects. Replaying a cancellation with the same key measures idempotent replay rather than independent cancellations. Do not run a broad cancellation load against real attendee data.

## Increase load carefully

1. Save the starting database/queue state and record the API/worker versions and machine specs.
2. Establish a short baseline with `-c 1` or `-c 2`.
3. Increase concurrency gradually (for example, 5, 10, then 20) while keeping the duration short.
4. Stop if latency, errors, database connections, queue age, or disk usage rise unexpectedly.
5. Repeat each run and compare the same endpoint, payload shape, concurrency, and duration.
6. Check the Autocannon summary for requests/second, latency percentiles, and non-2xx/timeouts. Check [http://localhost:3000/test](http://localhost:3000/test) for queue state and server logs, and inspect database resource usage separately.
7. Record results as measurements from this machine and configuration—not as a general production capacity guarantee.

## Cleanup

The API currently has no delete endpoints or automatic retention/cleanup for load-generated events, RSVPs, outbox rows, idempotency records, or server logs. Keep the data in a disposable load-test database. Only remove its data or volume when you have verified that it contains no information you need.
