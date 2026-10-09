import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { prisma as defaultPrisma } from './plugins/prisma.js';
import { eventRoutes } from './modules/events/events.routes.js';
import { rsvpRoutes } from './modules/rsvps/rsvps.routes.js';
import { queueStatusRoutes } from './queue/queue-status.routes.js';
import { serverLogsRoutes } from './server-logs.routes.js';
import { AppError, errorResponse } from './utils/errors.js';
import { writeServerLog } from './utils/server-logs.js';

const frontendPath = new URL('../public/index.html', import.meta.url);

export function buildApp({
  prisma = defaultPrisma,
  queue = null,
  allowTestTrigger = process.env.NODE_ENV === 'development',
  logger = true
} = {}) {
  const app = Fastify({ logger });
  app.decorate('prisma', prisma);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorResponse(error.code, error.message));
    }
    if (error.validation) {
      return reply.code(400).send(errorResponse('VALIDATION_ERROR', error.message));
    }
    request.log.error({ err: error }, 'Request failed');
    void writeServerLog(app.prisma, {
      level: 'ERROR',
      source: 'API',
      message: 'Request failed',
      context: {
        requestId: request.id,
        method: request.method,
        path: request.url.split('?')[0],
        error: error.message
      }
    });
    return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'An unexpected error occurred'));
  });

  app.addHook('onResponse', (request, reply, done) => {
    const statusCode = reply.statusCode;
    const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    const path = request.url.split('?')[0];
    void writeServerLog(app.prisma, {
      level,
      source: 'API',
      message: `${request.method} ${path}`,
      context: {
        requestId: request.id,
        method: request.method,
        path,
        statusCode,
        responseTimeMs: Number(reply.elapsedTime.toFixed(2))
      }
    });
    done();
  });

  app.get('/health', async () => ({ status: 'ok' }));
  const serveTestConsole = async (_request, reply) => {
    const html = await readFile(frontendPath, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  };
  app.get('/', serveTestConsole);
  app.get('/test', serveTestConsole);
  app.register(eventRoutes);
  app.register(rsvpRoutes);
  app.register(queueStatusRoutes, { queue, allowTestTrigger });
  app.register(serverLogsRoutes);

  return app;
}
