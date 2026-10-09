import { describe, expect, it, vi } from 'vitest';
import { OutboxDispatcher } from '../src/queue/outbox-dispatcher.js';

describe('OutboxDispatcher', () => {
  it('publishes with the outbox ID and marks the row published after queue success', async () => {
    const event = { id: 'outbox-1', type: 'RSVP_CREATED', payload: { guest: 'guest-1' } };
    const prisma = {
      outboxEvent: {
        findMany: vi.fn().mockResolvedValue([event]),
        update: vi.fn().mockResolvedValue({})
      }
    };
    const queue = { add: vi.fn().mockResolvedValue({ id: event.id }) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const dispatcher = new OutboxDispatcher({ prisma, queue, logger });

    await dispatcher.dispatchOnce();

    expect(queue.add).toHaveBeenCalledWith(event.type, event.payload, { jobId: event.id });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { publishedAt: expect.any(Date), attempts: { increment: 1 }, lastError: null }
    });
    expect(logger.info).toHaveBeenCalledWith(
      { outboxId: event.id, type: event.type },
      'Outbox event published'
    );
  });

  it('keeps failed publications unpublished and records the attempt error', async () => {
    const event = { id: 'outbox-2', type: 'RSVP_CANCELLED', payload: {} };
    const prisma = {
      outboxEvent: {
        findMany: vi.fn().mockResolvedValue([event]),
        update: vi.fn().mockResolvedValue({})
      }
    };
    const queue = { add: vi.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const logger = { error: vi.fn() };
    const dispatcher = new OutboxDispatcher({ prisma, queue, logger });

    await dispatcher.dispatchOnce();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: { attempts: { increment: 1 }, lastError: 'Redis unavailable' }
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
