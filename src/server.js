import 'dotenv/config';
import IORedis from 'ioredis';
import { buildApp } from './app.js';
import { prisma } from './plugins/prisma.js';
import { createWebhookQueue } from './queue/webhook.queue.js';
import { writeServerLog } from './utils/server-logs.js';

const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true
});
const queue = createWebhookQueue(redis);
const app = buildApp({ queue });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  await writeServerLog(prisma, {
    level: 'INFO',
    source: 'API',
    message: 'API server started',
    context: { host, port }
  });
} catch (error) {
  app.log.error(error, 'Could not start API server');
  await writeServerLog(prisma, {
    level: 'ERROR',
    source: 'API',
    message: 'Could not start API server',
    context: { error: error instanceof Error ? error.message : 'Unknown startup error' }
  });
  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
  process.exitCode = 1;
}

async function shutdown(signal) {
  app.log.info({ signal }, 'Shutting down API');
  await writeServerLog(prisma, {
    level: 'INFO',
    source: 'API',
    message: 'Shutting down API server',
    context: { signal }
  });
  await app.close();
  await queue.close();
  redis.disconnect();
  await prisma.$disconnect();
}

process.once('SIGINT', () => shutdown('SIGINT').catch((error) => {
  app.log.error(error, 'API shutdown failed');
  void writeServerLog(prisma, {
    level: 'ERROR',
    source: 'API',
    message: 'API shutdown failed',
    context: { error: error instanceof Error ? error.message : 'Unknown shutdown error' }
  });
  process.exitCode = 1;
}));
process.once('SIGTERM', () => shutdown('SIGTERM').catch((error) => {
  app.log.error(error, 'API shutdown failed');
  void writeServerLog(prisma, {
    level: 'ERROR',
    source: 'API',
    message: 'API shutdown failed',
    context: { error: error instanceof Error ? error.message : 'Unknown shutdown error' }
  });
  process.exitCode = 1;
}));
