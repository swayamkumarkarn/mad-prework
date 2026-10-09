import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export function hashRequest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function findIdempotentResponse(tx, key, scope, requestHash) {
  const record = await tx.idempotencyRecord.findUnique({
    where: { key_scope: { key, scope } }
  });

  if (!record) return null;
  if (record.requestHash !== requestHash) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used with a different request');
  }

  return { statusCode: record.responseStatus, body: record.responseBody };
}

export async function saveIdempotentResponse(tx, key, scope, requestHash, statusCode, body) {
  await tx.idempotencyRecord.create({
    data: {
      key,
      scope,
      requestHash,
      responseStatus: statusCode,
      responseBody: body
    }
  });
}

export function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required');
  }
  return value.trim();
}
