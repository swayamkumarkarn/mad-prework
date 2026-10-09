export const createRsvpSchema = {
  params: {
    type: 'object',
    required: ['eventId'],
    properties: { eventId: { type: 'string', format: 'uuid' } }
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', minLength: 1, maxLength: 200 }
    }
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'email'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
      email: { type: 'string', format: 'email', maxLength: 320 }
    }
  }
};

export const cancelRsvpSchema = {
  params: {
    type: 'object',
    required: ['rsvpId'],
    properties: { rsvpId: { type: 'string', format: 'uuid' } }
  },
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': { type: 'string', minLength: 1, maxLength: 200 }
    }
  }
};
