import 'dotenv/config';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
let app;
let prisma;

integration('event and RSVP API (PostgreSQL)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const appModule = await import('../src/app.js');
    const prismaModule = await import('../src/plugins/prisma.js');
    prisma = prismaModule.prisma;
    app = appModule.buildApp({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "OutboxEvent", "IdempotencyRecord", "Rsvp", "Event" CASCADE'
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  async function makeEvent(capacity = 1) {
    const response = await app.inject({
      method: 'POST',
      url: '/events',
      payload: {
        title: 'Test Event',
        date: '2026-10-20T18:00:00Z',
        location: 'Bengaluru',
        capacity
      }
    });
    return { response, event: response.json() };
  }

  async function rsvp(eventId, email, key, name = 'Guest') {
    return app.inject({
      method: 'POST',
      url: `/events/${eventId}/rsvps`,
      headers: { 'idempotency-key': key },
      payload: { name, email }
    });
  }

  it('creates events and validates required fields', async () => {
    const { response, event } = await makeEvent(2);
    expect(response.statusCode).toBe(201);
    expect(event.capacity).toBe(2);

    const invalid = await app.inject({ method: 'POST', url: '/events', payload: { capacity: 0 } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('confirms available guests, waitlists excess guests, and returns counts and pagination', async () => {
    const { event } = await makeEvent(1);
    const confirmed = await rsvp(event.id, 'ONE@example.com', 'create-1');
    const waiting = await rsvp(event.id, 'two@example.com', 'create-2');
    expect(confirmed.json().status).toBe('CONFIRMED');
    expect(waiting.json().status).toBe('WAITLISTED');

    const counts = await app.inject({ method: 'GET', url: `/events/${event.id}` });
    expect(counts.json().counts).toEqual({ confirmed: 1, waitlisted: 1, cancelled: 0 });

    const list = await app.inject({ method: 'GET', url: `/events/${event.id}/rsvps?page=1&limit=1` });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it('promotes the oldest waitlisted guest when a confirmed RSVP is cancelled', async () => {
    const { event } = await makeEvent(1);
    const first = await rsvp(event.id, 'first@example.com', 'fifo-1');
    const oldest = await rsvp(event.id, 'oldest@example.com', 'fifo-2');
    await rsvp(event.id, 'newest@example.com', 'fifo-3');

    const cancelled = await app.inject({
      method: 'POST',
      url: `/rsvps/${first.json().id}/cancel`,
      headers: { 'idempotency-key': 'cancel-first' }
    });
    expect(cancelled.json().promoted.id).toBe(oldest.json().id);
    expect(cancelled.json().promoted.status).toBe('CONFIRMED');
  });

  it('does not promote anyone when a waitlisted RSVP is cancelled', async () => {
    const { event } = await makeEvent(1);
    await rsvp(event.id, 'confirmed@example.com', 'wait-1');
    const waiting = await rsvp(event.id, 'waiting@example.com', 'wait-2');

    const cancelled = await app.inject({
      method: 'POST',
      url: `/rsvps/${waiting.json().id}/cancel`,
      headers: { 'idempotency-key': 'cancel-waiting' }
    });
    expect(cancelled.json().promoted).toBeNull();
    expect(cancelled.json().rsvp.status).toBe('CANCELLED');
  });

  it('replays idempotent requests and rejects key reuse with a different payload', async () => {
    const { event } = await makeEvent(2);
    const first = await rsvp(event.id, 'same@example.com', 'same-key', 'Same');
    const replay = await rsvp(event.id, 'SAME@example.com', 'same-key', 'Same');
    const conflict = await rsvp(event.id, 'other@example.com', 'same-key', 'Same');

    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.rsvp.count({ where: { eventId: event.id } })).toBe(1);
  });

  it('rejects duplicate active emails but allows a cancelled guest to register again', async () => {
    const { event } = await makeEvent(2);
    const first = await rsvp(event.id, 'guest@example.com', 'email-first');
    const duplicate = await rsvp(event.id, ' GUEST@example.com ', 'email-duplicate');

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('RSVP_ALREADY_EXISTS');

    await app.inject({
      method: 'POST',
      url: `/rsvps/${first.json().id}/cancel`,
      headers: { 'idempotency-key': 'email-cancel' }
    });
    const renewed = await rsvp(event.id, 'guest@example.com', 'email-renewed');
    expect(renewed.statusCode).toBe(201);
    expect(renewed.json().status).toBe('CONFIRMED');
  });

  it('repeated cancellation does not promote multiple waitlisted guests', async () => {
    const { event } = await makeEvent(1);
    const confirmed = await rsvp(event.id, 'cancel-main@example.com', 'cancel-rsvp-1');
    const queued = await rsvp(event.id, 'cancel-queued@example.com', 'cancel-rsvp-2');
    const request = {
      method: 'POST',
      url: `/rsvps/${confirmed.json().id}/cancel`,
      headers: { 'idempotency-key': 'cancel-retry' }
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.json()).toEqual(replay.json());
    expect(first.json().promoted.id).toBe(queued.json().id);
    expect(await prisma.rsvp.count({ where: { eventId: event.id, status: 'CONFIRMED' } })).toBe(1);
  });

  it('allows exactly one confirmed RSVP for the last slot under concurrent requests', async () => {
    const { event } = await makeEvent(1);
    const responses = await Promise.all([
      rsvp(event.id, 'parallel-a@example.com', 'parallel-a'),
      rsvp(event.id, 'parallel-b@example.com', 'parallel-b')
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(await prisma.rsvp.count({ where: { eventId: event.id, status: 'CONFIRMED' } })).toBe(1);
    expect(await prisma.rsvp.count({ where: { eventId: event.id, status: 'WAITLISTED' } })).toBe(1);
  });
});
