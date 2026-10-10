import { Queue } from 'bullmq';

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';

export function getWebhookMaxRetries(value) {
  if (value === undefined) return 2;
  if (!/^\d+$/.test(value)) {
    throw new Error('WEBHOOK_MAX_RETRIES must be a non-negative integer');
  }

  const maxRetries = Number(value);
  if (!Number.isSafeInteger(maxRetries) || maxRetries >= Number.MAX_SAFE_INTEGER) {
    throw new Error('WEBHOOK_MAX_RETRIES must be a non-negative integer');
  }
  return maxRetries;
}

export function createWebhookQueue(connection) {
  const queue = new Queue(WEBHOOK_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: getWebhookMaxRetries(process.env.WEBHOOK_MAX_RETRIES) + 1,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  });
  return queue;
}
