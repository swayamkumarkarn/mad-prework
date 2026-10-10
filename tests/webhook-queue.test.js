import { describe, expect, it } from 'vitest';
import { getWebhookMaxRetries } from '../src/queue/webhook.queue.js';

describe('getWebhookMaxRetries', () => {
  it('defaults to two retries after the initial attempt', () => {
    expect(getWebhookMaxRetries(undefined)).toBe(2);
  });

  it('allows zero retries', () => {
    expect(getWebhookMaxRetries('0')).toBe(0);
  });

  it('parses a configured retry count', () => {
    expect(getWebhookMaxRetries('5')).toBe(5);
  });

  it.each(['', '-1', '1.5', 'abc', '9007199254740991'])('rejects invalid retry count %j', (value) => {
    expect(() => getWebhookMaxRetries(value)).toThrow(
      'WEBHOOK_MAX_RETRIES must be a non-negative integer'
    );
  });
});
