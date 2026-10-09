export class OutboxDispatcher {
  constructor({ prisma, queue, logger, intervalMs = 1000, batchSize = 50 }) {
    this.prisma = prisma;
    this.queue = queue;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  async dispatchOnce() {
    if (this.running || this.stopped) return;
    this.running = true;

    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: this.batchSize
      });

      for (const event of events) {
        try {
          await this.queue.add(event.type, event.payload, { jobId: event.id });
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null }
          });
          this.logger.info(
            { outboxId: event.id, type: event.type },
            'Outbox event published'
          );
        } catch (error) {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown dispatch error'
            }
          });
          this.logger.error({ outboxId: event.id, type: event.type, err: error }, 'Outbox dispatch failed');
        }
      }
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.dispatchOnce().catch((error) => {
      this.logger.error({ err: error }, 'Outbox poll failed');
    });
    this.timer = setInterval(() => {
      void this.dispatchOnce().catch((error) => {
        this.logger.error({ err: error }, 'Outbox poll failed');
      });
    }, this.intervalMs);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
