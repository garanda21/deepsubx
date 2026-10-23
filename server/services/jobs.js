import { randomUUID } from 'crypto';
import { basename } from 'path';
import { translateSRT } from './translator.js';
import { isConfigured as isPlexConfigured, updateLibrary } from './plexService.js';

const MAX_FINISHED_JOBS = 20;

// In-memory job store: survives page reloads, not server restarts
const jobs = new Map();
const queue = [];
let running = false;

function toPublic(job) {
  const { subtitlePath: _subtitlePath, partial: _partial, ...rest } = job;
  return rest;
}

function isActive(job) {
  return job.status === 'queued' || job.status === 'running';
}

function assertNotDuplicate(subtitlePath, targetLang, exceptId) {
  const duplicate = [...jobs.values()].some(job =>
    job.id !== exceptId
    && isActive(job)
    && job.subtitlePath === subtitlePath
    && job.targetLang === targetLang
  );
  if (duplicate) {
    const error = new Error(`${basename(subtitlePath)} is already being translated to ${targetLang}`);
    error.status = 409;
    throw error;
  }
}

function pruneFinished() {
  const finished = [...jobs.values()].filter(job => !isActive(job));
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED_JOBS))) {
    jobs.delete(job.id);
  }
}

async function runJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  try {
    job.path = await translateSRT(job.subtitlePath, job.sourceLang, job.targetLang, {
      title: job.title,
      partial: job.partial,
      onProgress: (done, total) => {
        job.progress = { done, total };
      },
    });

    if (job.updatePlex && isPlexConfigured()) {
      try {
        await updateLibrary();
        job.plex = 'updated';
      } catch (error) {
        job.plex = 'failed';
        job.plexError = error.message;
      }
    } else {
      job.plex = 'skipped';
    }
    job.status = 'done';
    job.partial = [];
  } catch (error) {
    console.error(`Translation job ${job.id} failed:`, error.message);
    job.status = 'error';
    job.error = {
      message: error.message || 'Unknown error',
      status: error.status || 500,
      apiDetails: error.apiDetails || null,
    };
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

async function processQueue() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    await runJob(queue.shift());
    pruneFinished();
  }
  running = false;
}

/**
 * Queues a subtitle translation. Jobs run one at a time.
 * Throws a 409 error if the same file and target language is already queued or running.
 */
export function createTranslationJob({ subtitlePath, sourceLang, targetLang, title, season, updatePlex }) {
  assertNotDuplicate(subtitlePath, targetLang);

  const job = {
    id: randomUUID(),
    status: 'queued',
    file: basename(subtitlePath),
    title,
    season: season || null,
    sourceLang,
    targetLang,
    updatePlex: !!updatePlex,
    progress: { done: 0, total: 0 },
    attempts: 1,
    createdAt: new Date().toISOString(),
    subtitlePath,
    // Translations finished so far, kept so a retry resumes instead of restarting
    partial: [],
  };
  jobs.set(job.id, job);
  queue.push(job);
  processQueue();
  return toPublic(job);
}

/**
 * Requeues a failed job. Batches translated before the failure are kept.
 */
export function retryJob(id) {
  const job = jobs.get(id);
  if (!job) {
    const error = new Error('Job not found');
    error.status = 404;
    throw error;
  }
  if (job.status !== 'error') {
    const error = new Error('Only failed jobs can be retried');
    error.status = 409;
    throw error;
  }
  assertNotDuplicate(job.subtitlePath, job.targetLang, job.id);

  job.status = 'queued';
  job.attempts += 1;
  delete job.error;
  delete job.finishedAt;
  // Move it to the end so it shows up as the most recent job
  jobs.delete(job.id);
  jobs.set(job.id, job);
  queue.push(job);
  processQueue();
  return toPublic(job);
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? toPublic(job) : null;
}

/** Most recent first. */
export function listJobs() {
  return [...jobs.values()].reverse().map(toPublic);
}
