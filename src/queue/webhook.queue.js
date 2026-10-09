import { Queue } from 'bullmq';

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';

export function createWebhookQueue(connection) {
  const queue = new Queue(WEBHOOK_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  });
  return queue;
}
