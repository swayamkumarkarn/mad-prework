import { AppError } from '../../utils/errors.js';

export async function createEvent(prisma, input) {
  return prisma.event.create({
    data: {
      title: input.title.trim(),
      date: new Date(input.date),
      location: input.location.trim(),
      capacity: input.capacity
    }
  });
}

function addRsvpCounts(events, grouped) {
  const countsByEvent = new Map();
  for (const entry of grouped) {
    const counts = countsByEvent.get(entry.eventId) ?? {};
    counts[entry.status] = entry._count._all;
    countsByEvent.set(entry.eventId, counts);
  }

  return events.map((event) => {
    const counts = countsByEvent.get(event.id) ?? {};
    return {
      ...event,
      counts: {
        confirmed: counts.CONFIRMED ?? 0,
        waitlisted: counts.WAITLISTED ?? 0,
        cancelled: counts.CANCELLED ?? 0
      }
    };
  });
}

export async function listEvents(prisma) {
  const events = await prisma.event.findMany({
    orderBy: [{ date: 'asc' }, { id: 'asc' }]
  });
  if (events.length === 0) return [];

  const grouped = await prisma.rsvp.groupBy({
    by: ['eventId', 'status'],
    where: { eventId: { in: events.map((event) => event.id) } },
    _count: { _all: true }
  });
  return addRsvpCounts(events, grouped);
}

export async function getEvent(prisma, eventId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');

  const grouped = await prisma.rsvp.groupBy({
    by: ['status'],
    where: { eventId },
    _count: { _all: true }
  });
  return addRsvpCounts([event], grouped.map((entry) => ({ ...entry, eventId })))[0];
}

export async function listRsvps(prisma, eventId, query) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found');

  const where = {
    eventId,
    ...(query.status ? { status: query.status } : {})
  };
  const [data, total] = await Promise.all([
    prisma.rsvp.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit
    }),
    prisma.rsvp.count({ where })
  ]);

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit)
    }
  };
}
