import 'dotenv/config';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { prisma } from '../plugins/prisma.js';
import { createWebhookQueue, WEBHOOK_QUEUE_NAME } from '../queue/webhook.queue.js';
import { OutboxDispatcher } from '../queue/outbox-dispatcher.js';
import { deliverWebhook } from './webhook-delivery.js';
import { createPersistentLogger, writeServerLog } from '../utils/server-logs.js';

const webhookUrl = process.env.WEBHOOK_URL;
if (!webhookUrl) throw new Error('WEBHOOK_URL must be configured to run the webhook worker');
new URL(webhookUrl);

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});
const queue = createWebhookQueue(connection);
const logger = createPersistentLogger(prisma, 'WORKER');

const worker = new Worker(
  WEBHOOK_QUEUE_NAME,
  async (job) => {
    try {
      await deliverWebhook(job.data, webhookUrl);
      logger.info({
        jobId: job.id,
        type: job.name,
        attempt: job.attemptsMade + 1,
        result: 'delivered'
      }, 'Webhook delivered');
    } catch (error) {
      logger.error({
        jobId: job.id,
        type: job.name,
        attempt: job.attemptsMade + 1,
        error: error instanceof Error ? error.message : 'Unknown webhook error'
      }, 'Webhook delivery failed');
      throw error;
    }
  },
  { connection }
);

worker.on('error', (error) => {
  logger.error({ error: error.message }, 'Webhook worker error');
});
const dispatcher = new OutboxDispatcher({
  prisma,
  queue,
  logger: createPersistentLogger(prisma, 'OUTBOX')
});
dispatcher.start();
logger.info({ queueName: WEBHOOK_QUEUE_NAME }, 'Webhook worker started');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down webhook worker');
  await dispatcher.stop();
  await worker.close();
  await queue.close();
  await connection.quit();
  await writeServerLog(prisma, {
    level: 'INFO',
    source: 'WORKER',
    message: 'Webhook worker stopped',
    context: { signal }
  });
  await prisma.$disconnect();
}

process.once('SIGINT', () => shutdown('SIGINT').catch((error) => {
  console.error('Webhook worker shutdown failed', error);
  void writeServerLog(prisma, {
    level: 'ERROR',
    source: 'WORKER',
    message: 'Webhook worker shutdown failed',
    context: { error: error instanceof Error ? error.message : 'Unknown shutdown error' }
  });
  process.exitCode = 1;
}));
process.once('SIGTERM', () => shutdown('SIGTERM').catch((error) => {
  console.error('Webhook worker shutdown failed', error);
  void writeServerLog(prisma, {
    level: 'ERROR',
    source: 'WORKER',
    message: 'Webhook worker shutdown failed',
    context: { error: error instanceof Error ? error.message : 'Unknown shutdown error' }
  });
  process.exitCode = 1;
}));
