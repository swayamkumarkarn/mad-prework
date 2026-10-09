import { cancelRsvp } from './rsvps.service.js';
import { cancelRsvpSchema } from './rsvps.schemas.js';

export async function rsvpRoutes(app) {
  app.post('/rsvps/:rsvpId/cancel', { schema: cancelRsvpSchema }, async (request, reply) => {
    const result = await cancelRsvp(app.prisma, {
      rsvpId: request.params.rsvpId,
      idempotencyKey: request.headers['idempotency-key']
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
