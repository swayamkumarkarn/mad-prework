import { randomUUID } from 'node:crypto';
import { errorResponse } from '../utils/errors.js';
import { getWebhookQueueStatus } from './queue-status.js';

export async function queueStatusRoutes(app, { queue, allowTestTrigger }) {
  app.get('/worker/queue', async (_request, reply) => {
    if (!queue) {
      return reply.code(503).send(errorResponse(
        'QUEUE_UNAVAILABLE',
        'Worker queue monitoring is not configured'
      ));
    }
    return getWebhookQueueStatus(queue);
  });

  app.post('/worker/queue/test-job', async (_request, reply) => {
    if (!allowTestTrigger) {
      return reply.code(404).send(errorResponse(
        'TEST_TRIGGER_DISABLED',
        'Test webhook triggering is only available in development mode'
      ));
    }
    if (!queue) {
      return reply.code(503).send(errorResponse(
        'QUEUE_UNAVAILABLE',
        'Worker queue monitoring is not configured'
      ));
    }

    const testId = randomUUID();
    const job = await queue.add('WEBHOOK_TEST', {
      type: 'WEBHOOK_TEST',
      test: true,
      testId,
      message: 'Test webhook triggered from the API console',
      triggeredAt: new Date().toISOString()
    }, { jobId: `webhook-test-${testId}` });
    return reply.code(202).send({
      jobId: job.id,
      name: job.name,
      status: 'queued'
    });
  });
}
