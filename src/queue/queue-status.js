const JOB_STATES = ['active', 'waiting', 'delayed', 'failed', 'completed'];

export async function getWebhookQueueStatus(queue) {
  const [counts, workers, groupedJobs] = await Promise.all([
    queue.getJobCounts(...JOB_STATES),
    queue.getWorkersCount(),
    queue.getJobs(JOB_STATES, 0, 19, false)
  ]);
  const jobs = await Promise.all(groupedJobs.map(async (job) => ({
    id: job.id,
    name: job.name,
    state: await queue.getJobState(job.id),
    attemptsMade: job.attemptsMade,
    attempts: job.opts.attempts ?? 1,
    timestamp: job.timestamp,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    failedReason: job.failedReason || null
  })));

  jobs.sort((left, right) => right.timestamp - left.timestamp);
  return {
    queueName: queue.name,
    workerCount: workers,
    counts: Object.fromEntries(JOB_STATES.map((state) => [state, counts[state] ?? 0])),
    jobs: jobs.slice(0, 25)
  };
}
