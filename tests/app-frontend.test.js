import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { writeServerLog } from '../src/utils/server-logs.js';

describe('API testing console', () => {
  it.each(['/', '/test'])('serves the browser console from %s', async (url) => {
    const app = buildApp({ logger: false });
    try {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Test your RSVP API.');
      expect(response.body).toContain('Register guest');
      expect(response.body).toContain('Webhook worker queue');
      expect(response.body).toContain('Trigger test webhook');
      expect(response.body).toContain('Run API tests');
      expect(response.body).toContain('RSVP concurrency test');
      expect(response.body).toContain('Run concurrency test');
      expect(response.body).toContain('Concurrent RSVP cancellation test');
      expect(response.body).toContain('Run cancellation concurrency test');
      expect(response.body).toContain('Distinct RSVPs to cancel concurrently');
      expect(response.body).toContain('cancel-concurrency-${runId}-${index + 1}');
      expect(response.body).toContain('cancelConcurrencyEventId');
      expect(response.body).toContain('Any confirmed RSVP');
      expect(response.body).toContain('Any waitlisted RSVP');
      expect(response.body).toContain('This permanently cancels ${requestCount} distinct');
      expect(response.body).toContain('selectedRsvps.map');
      expect(response.body).not.toContain('Creating a test event, three RSVPs');
      expect(response.body).toContain('Server logs');
      expect(response.body).toContain('Load logs');
      expect(response.body).toContain('No worker logs yet. Start or restart the worker with npm run worker');
      expect(response.body).toContain('No outbox activity logs yet.');
      expect(response.body).toContain('Promise.all');
      expect(response.body).toContain('Date &amp; location');
      expect(response.body).toContain('<th>Capacity</th>');
      expect(response.body).toContain('<th>Created</th>');
    } finally {
      await app.close();
    }
  });
});

describe('server log persistence', () => {
  it('persists API request status and timing without logging the query string', async () => {
    const serverLog = { create: vi.fn().mockResolvedValue({}) };
    const app = buildApp({ logger: false, prisma: { serverLog } });
    try {
      const response = await app.inject({ method: 'GET', url: '/health?token=must-not-be-logged' });
      expect(response.statusCode).toBe(200);
      expect(serverLog.create).toHaveBeenCalledWith({
        data: {
          level: 'INFO',
          source: 'API',
          message: 'GET /health',
          context: expect.objectContaining({
            method: 'GET',
            path: '/health',
            statusCode: 200,
            responseTimeMs: expect.any(Number)
          })
        }
      });
      expect(JSON.stringify(serverLog.create.mock.calls)).not.toContain('must-not-be-logged');
    } finally {
      await app.close();
    }
  });

  it('redacts credentials in persisted error contexts', async () => {
    const serverLog = { create: vi.fn().mockResolvedValue({}) };
    await writeServerLog({ serverLog }, {
      level: 'ERROR',
      source: 'WORKER',
      message: 'Worker failure',
      context: { err: new Error('Could not connect to redis://user:secret@localhost:6379') }
    });
    expect(serverLog.create).toHaveBeenCalledWith({
      data: {
        level: 'ERROR',
        source: 'WORKER',
        message: 'Worker failure',
        context: {
          err: {
            name: 'Error',
            message: 'Could not connect to redis://[REDACTED]@localhost:6379'
          }
        }
      }
    });
  });
});

describe('server logs API', () => {
  it('returns paginated logs and filters by level and source', async () => {
    const logs = [{
      id: '33333333-3333-4333-8333-333333333333',
      level: 'ERROR',
      source: 'WORKER',
      message: 'Webhook delivery failed',
      context: { jobId: 'job-1' },
      createdAt: new Date('2026-10-10T10:00:00Z')
    }];
    const serverLog = {
      findMany: vi.fn().mockResolvedValue(logs),
      count: vi.fn().mockResolvedValue(1)
    };
    const app = buildApp({ logger: false, prisma: { serverLog } });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/server-logs?page=2&limit=10&level=ERROR&source=WORKER'
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: [{ level: 'ERROR', source: 'WORKER', message: 'Webhook delivery failed' }],
        pagination: { page: 2, limit: 10, total: 1, totalPages: 1 }
      });
      expect(serverLog.findMany).toHaveBeenCalledWith({
        where: { level: 'ERROR', source: 'WORKER' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10
      });
    } finally {
      await app.close();
    }
  });

  it('rejects unsupported log filters and unsafe page sizes', async () => {
    const app = buildApp({ logger: false, prisma: { serverLog: {} } });
    try {
      const invalidLevel = await app.inject({ method: 'GET', url: '/server-logs?level=TRACE' });
      const invalidLimit = await app.inject({ method: 'GET', url: '/server-logs?limit=101' });
      expect(invalidLevel.statusCode).toBe(400);
      expect(invalidLimit.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('event listing API', () => {
  it('returns every event with RSVP counts', async () => {
    const events = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Earlier Event',
        date: new Date('2026-10-10T10:00:00Z'),
        location: 'Bengaluru',
        capacity: 10
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Later Event',
        date: new Date('2026-10-11T10:00:00Z'),
        location: 'Mysuru',
        capacity: 20
      }
    ];
    const app = buildApp({
      logger: false,
      prisma: {
        event: { findMany: async () => events },
        rsvp: {
          groupBy: async () => [
            { eventId: events[0].id, status: 'CONFIRMED', _count: { _all: 2 } },
            { eventId: events[0].id, status: 'WAITLISTED', _count: { _all: 1 } },
            { eventId: events[1].id, status: 'CANCELLED', _count: { _all: 3 } }
          ]
        }
      }
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/events' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject([
        { id: events[0].id, counts: { confirmed: 2, waitlisted: 1, cancelled: 0 } },
        { id: events[1].id, counts: { confirmed: 0, waitlisted: 0, cancelled: 3 } }
      ]);
    } finally {
      await app.close();
    }
  });

  it('returns an empty list without querying RSVP counts when there are no events', async () => {
    let groupByCalled = false;
    const app = buildApp({
      logger: false,
      prisma: {
        event: { findMany: async () => [] },
        rsvp: {
          groupBy: async () => {
            groupByCalled = true;
            return [];
          }
        }
      }
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/events' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
      expect(groupByCalled).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('worker queue API', () => {
  it('returns queue counts, worker presence, and safe recent-job details', async () => {
    const queue = {
      name: 'webhook-delivery',
      getJobCounts: async () => ({
        waiting: 1,
        active: 2,
        delayed: 3,
        failed: 4,
        completed: 5
      }),
      getWorkersCount: async () => 1,
      getJobs: async () => [{
        id: 'outbox-1',
        name: 'RSVP_CREATED',
        attemptsMade: 1,
        opts: { attempts: 3 },
        timestamp: 1791580000000,
        processedOn: 1791580001000,
        finishedOn: null,
        failedReason: 'Webhook returned HTTP 503',
        data: { guest: { email: 'private@example.com' } }
      }],
      getJobState: async () => 'active'
    };
    const app = buildApp({ logger: false, queue });
    try {
      const response = await app.inject({ method: 'GET', url: '/worker/queue' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        queueName: 'webhook-delivery',
        workerCount: 1,
        counts: { waiting: 1, active: 2, delayed: 3, failed: 4, completed: 5 },
        jobs: [{
          id: 'outbox-1',
          name: 'RSVP_CREATED',
          state: 'active',
          attemptsMade: 1,
          attempts: 3,
          failedReason: 'Webhook returned HTTP 503'
        }]
      });
      expect(response.body).not.toContain('private@example.com');
    } finally {
      await app.close();
    }
  });

  it('returns an explicit unavailable response when monitoring is not configured', async () => {
    const app = buildApp({ logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/worker/queue' });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('QUEUE_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });

  it('queues an explicit test webhook when enabled', async () => {
    let addedJob;
    const queue = {
      add: async (...args) => {
        addedJob = args;
        return { id: args[2].jobId, name: args[0] };
      }
    };
    const app = buildApp({ logger: false, queue, allowTestTrigger: true });
    try {
      const response = await app.inject({ method: 'POST', url: '/worker/queue/test-job' });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        name: 'WEBHOOK_TEST',
        status: 'queued'
      });
      expect(addedJob[0]).toBe('WEBHOOK_TEST');
      expect(addedJob[1]).toMatchObject({
        type: 'WEBHOOK_TEST',
        test: true,
        message: 'Test webhook triggered from the API console'
      });
      expect(addedJob[2].jobId).toBe(response.json().jobId);
    } finally {
      await app.close();
    }
  });

  it('does not enqueue test webhooks when the test trigger is disabled', async () => {
    let addCalled = false;
    const app = buildApp({
      logger: false,
      queue: {
        add: async () => {
          addCalled = true;
          return { id: 'unexpected', name: 'WEBHOOK_TEST' };
        }
      },
      allowTestTrigger: false
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/worker/queue/test-job' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('TEST_TRIGGER_DISABLED');
      expect(addCalled).toBe(false);
    } finally {
      await app.close();
    }
  });
});
