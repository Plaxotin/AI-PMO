import type { ParsedAssignment } from '@/lib/pmi/types';

export type IngestJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export type IngestJob = {
  id: string;
  status: IngestJobStatus;
  stage?: string;
  drafts?: ParsedAssignment[];
  error?: string;
  createdAt: number;
};

const globalStore = globalThis as unknown as {
  __bl6IngestJobs?: Map<string, IngestJob>;
};

function store(): Map<string, IngestJob> {
  if (!globalStore.__bl6IngestJobs) {
    globalStore.__bl6IngestJobs = new Map();
  }
  return globalStore.__bl6IngestJobs;
}

export function createJob(id: string): IngestJob {
  const job: IngestJob = {
    id,
    status: 'pending',
    createdAt: Date.now(),
  };
  store().set(id, job);
  return job;
}

export function getJob(id: string): IngestJob | undefined {
  return store().get(id);
}

export function updateJob(id: string, patch: Partial<IngestJob>): IngestJob | undefined {
  const job = store().get(id);
  if (!job) return undefined;
  const next = { ...job, ...patch };
  store().set(id, next);
  return next;
}

export function pruneOldJobs(): void {
  const cutoff = Date.now() - 3600_000;
  for (const [id, job] of store()) {
    if (job.createdAt < cutoff) store().delete(id);
  }
}
