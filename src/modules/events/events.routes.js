import { createEvent, getEvent, listEvents, listRsvps } from './events.service.js';
import { createEventSchema, eventIdSchema, listRsvpsSchema } from './events.schemas.js';
import { createRsvpSchema } from '../rsvps/rsvps.schemas.js';
import { createRsvp } from '../rsvps/rsvps.service.js';

export async function eventRoutes(app) {
  app.get('/events', async () => listEvents(app.prisma));

  app.post('/events', { schema: createEventSchema }, async (request, reply) => {
    const event = await createEvent(app.prisma, request.body);
    return reply.code(201).send(event);
  });

  app.get('/events/:eventId', { schema: eventIdSchema }, async (request) => {
    return getEvent(app.prisma, request.params.eventId);
  });

  app.get('/events/:eventId/rsvps', { schema: listRsvpsSchema }, async (request) => {
    return listRsvps(app.prisma, request.params.eventId, request.query);
  });

  app.post('/events/:eventId/rsvps', {
    schema: createRsvpSchema,
    preValidation: async (request) => {
      if (typeof request.body?.name === 'string') request.body.name = request.body.name.trim();
      if (typeof request.body?.email === 'string') request.body.email = request.body.email.trim();
    }
  }, async (request, reply) => {
    const result = await createRsvp(app.prisma, {
      eventId: request.params.eventId,
      idempotencyKey: request.headers['idempotency-key'],
      input: request.body
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
