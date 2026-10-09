const eventIdParams = {
  type: 'object',
  required: ['eventId'],
  properties: { eventId: { type: 'string', format: 'uuid' } }
};

export const createEventSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'date', 'location', 'capacity'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
      date: { type: 'string', format: 'date-time' },
      location: { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' },
      capacity: { type: 'integer', minimum: 1 }
    }
  }
};

export const eventIdSchema = { params: eventIdParams };

export const listRsvpsSchema = {
  params: eventIdParams,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      status: { type: 'string', enum: ['CONFIRMED', 'WAITLISTED', 'CANCELLED'] }
    }
  }
};
