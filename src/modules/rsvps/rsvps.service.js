import { AppError } from '../../utils/errors.js';
import {
  findIdempotentResponse,
  hashRequest,
  requireIdempotencyKey,
  saveIdempotentResponse
} from '../../utils/idempotency.js';

function eventLock(tx, eventId) {
  return tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId}::uuid FOR UPDATE`;
}

function webhookPayload(type, event, rsvp) {
  return {
    type,
    event: { id: event.id, title: event.title, date: event.date, location: event.location },
    guest: { id: rsvp.id, name: rsvp.name, email: rsvp.email },
    status: rsvp.status
  };
}

export async function createRsvp(prisma, { eventId, idempotencyKey, input }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const scope = `create-rsvp:${eventId}`;
  const requestHash = hashRequest({ eventId, name, email });

  return prisma.$transaction(async (tx) => {
    await eventLock(tx, eventId);
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');

    const replay = await findIdempotentResponse(tx, key, scope, requestHash);
    if (replay) return replay;

    const existing = await tx.rsvp.findFirst({
      where: { eventId, email, status: { not: 'CANCELLED' } },
      select: { id: true }
    });
    if (existing) throw new AppError(409, 'RSVP_ALREADY_EXISTS', 'This email already has an active RSVP');

    const confirmedCount = await tx.rsvp.count({ where: { eventId, status: 'CONFIRMED' } });
    const status = confirmedCount < event.capacity ? 'CONFIRMED' : 'WAITLISTED';
    const rsvp = await tx.rsvp.create({
      data: { eventId, name, email, status }
    });
    const body = { ...rsvp };

    await tx.outboxEvent.create({
      data: { type: 'RSVP_CREATED', payload: webhookPayload('RSVP_CREATED', event, rsvp) }
    });
    await saveIdempotentResponse(tx, key, scope, requestHash, 201, body);
    return { statusCode: 201, body };
  });
}

export async function cancelRsvp(prisma, { rsvpId, idempotencyKey }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const scope = `cancel-rsvp:${rsvpId}`;
  const requestHash = hashRequest({ rsvpId });

  return prisma.$transaction(async (tx) => {
    const initial = await tx.rsvp.findUnique({
      where: { id: rsvpId },
      select: { eventId: true }
    });
    if (!initial) throw new AppError(404, 'RSVP_NOT_FOUND', 'RSVP not found');

    await eventLock(tx, initial.eventId);
    const replay = await findIdempotentResponse(tx, key, scope, requestHash);
    if (replay) return replay;

    const rsvp = await tx.rsvp.findUnique({ where: { id: rsvpId } });
    if (!rsvp) throw new AppError(404, 'RSVP_NOT_FOUND', 'RSVP not found');
    const event = await tx.event.findUnique({ where: { id: rsvp.eventId } });
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');

    let cancelled = rsvp;
    let promoted = null;
    if (rsvp.status !== 'CANCELLED') {
      cancelled = await tx.rsvp.update({
        where: { id: rsvpId },
        data: { status: 'CANCELLED', cancelledAt: new Date() }
      });
      await tx.outboxEvent.create({
        data: {
          type: 'RSVP_CANCELLED',
          payload: webhookPayload('RSVP_CANCELLED', event, cancelled)
        }
      });

      if (rsvp.status === 'CONFIRMED') {
        const next = await tx.rsvp.findFirst({
          where: { eventId: rsvp.eventId, status: 'WAITLISTED' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        });
        if (next) {
          promoted = await tx.rsvp.update({
            where: { id: next.id },
            data: { status: 'CONFIRMED' }
          });
          await tx.outboxEvent.create({
            data: {
              type: 'RSVP_PROMOTED',
              payload: webhookPayload('RSVP_PROMOTED', event, promoted)
            }
          });
        }
      }
    }

    const body = { rsvp: cancelled, promoted };
    await saveIdempotentResponse(tx, key, scope, requestHash, 200, body);
    return { statusCode: 200, body };
  });
}
