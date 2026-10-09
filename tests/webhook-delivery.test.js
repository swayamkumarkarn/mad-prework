import { describe, expect, it, vi } from 'vitest';
import { deliverWebhook } from '../src/workers/webhook-delivery.js';

describe('deliverWebhook', () => {
  it('throws for non-success HTTP responses so BullMQ can retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    await expect(deliverWebhook({ type: 'RSVP_CREATED' }, 'https://example.test/hook', 1000, fetchImpl))
      .rejects.toThrow('Webhook returned HTTP 503');
  });

  it('sends the payload as JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const payload = { type: 'RSVP_CREATED' };

    await expect(deliverWebhook(payload, 'https://example.test/hook', 1000, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/hook', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload)
    }));
  });
});
