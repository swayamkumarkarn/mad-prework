import { errorResponse } from './utils/errors.js';

const LEVELS = ['INFO', 'WARN', 'ERROR'];
const SOURCES = ['API', 'WORKER', 'OUTBOX'];

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function serverLogsRoutes(app) {
  app.get('/server-logs', async (request, reply) => {
    const page = parsePositiveInteger(request.query.page, 1);
    const limit = parsePositiveInteger(request.query.limit, 25);
    if (page === null || limit === null || limit > 100) {
      return reply.code(400).send(errorResponse(
        'VALIDATION_ERROR',
        'page must be positive and limit must be between 1 and 100'
      ));
    }

    const level = request.query.level;
    const source = request.query.source;
    if ((level && !LEVELS.includes(level)) || (source && !SOURCES.includes(source))) {
      return reply.code(400).send(errorResponse('VALIDATION_ERROR', 'Invalid log level or source'));
    }

    const where = {
      ...(level ? { level } : {}),
      ...(source ? { source } : {})
    };
    const [data, total] = await Promise.all([
      app.prisma.serverLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit
      }),
      app.prisma.serverLog.count({ where })
    ]);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit)
      }
    };
  });
}
