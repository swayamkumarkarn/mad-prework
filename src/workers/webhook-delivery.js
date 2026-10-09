export async function deliverWebhook(payload, url, timeoutMs = 10_000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch {
      if (controller.signal.aborted) throw new Error('Webhook request timed out');
      throw new Error('Webhook request failed');
    }
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}
