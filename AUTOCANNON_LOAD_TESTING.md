# Load testing the API with Autocannon

This guide runs Autocannon against a local Event RSVP API. Autocannon reports throughput and latency; it does not by itself prove correctness or production capacity.

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
