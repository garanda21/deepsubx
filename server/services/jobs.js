import { randomUUID } from 'crypto';
import { basename } from 'path';
import { translateSRT } from './translator.js';
import { isConfigured as isPlexConfigured, updateLibrary } from './plexService.js';

const MAX_FINISHED_JOBS = 20;
const MAX_FAILED_JOBS = 50; // failed jobs keep resume progress, so they are pruned last
const DONE_JOB_TTL_MS = 24 * 60 * 60 * 1000; // completed jobs disappear after a day

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

function pruneOldest(list, keep) {
  for (const job of list.slice(0, Math.max(0, list.length - keep))) {
    jobs.delete(job.id);
  }
}

/**
 * Drops completed jobs older than DONE_JOB_TTL_MS. Failed jobs are kept until
 * they are retried or dismissed, since they hold resumable progress.
 */
function dropExpired(now = Date.now()) {
  for (const job of jobs.values()) {
    if (job.status === 'done' && now - Date.parse(job.finishedAt) > DONE_JOB_TTL_MS) {
      jobs.delete(job.id);
    }
  }
}

/**
 * Drops the oldest finished jobs. Completed jobs go first; failed jobs hold
 * resumable progress and get a separate, larger limit.
 */
function pruneFinished() {
  dropExpired();
  const all = [...jobs.values()];
  const done = all.filter(job => job.status === 'done');
  const failed = all.filter(job => job.status === 'error');
  pruneOldest(done, Math.max(0, MAX_FINISHED_JOBS - failed.length));
  pruneOldest(failed, MAX_FAILED_JOBS);
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
  try {
    while (queue.length > 0) {
      await runJob(queue.shift());
      pruneFinished();
    }
  } catch (error) {
    // processQueue is not awaited, so log instead of leaving an unhandled rejection
    console.error('Translation queue stopped unexpectedly:', error);
  } finally {
    // Never leave the queue stuck if something unexpected throws
    running = false;
  }
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
  // Clear state from the previous attempt; progress is kept in job.partial
  delete job.error;
  delete job.startedAt;
  delete job.finishedAt;
  delete job.path;
  delete job.plex;
  delete job.plexError;
  // Move it to the end so it shows up as the most recent job
  jobs.delete(job.id);
  jobs.set(job.id, job);
  queue.push(job);
  processQueue();
  return toPublic(job);
}

export function getJob(id) {
  dropExpired();
  const job = jobs.get(id);
  return job ? toPublic(job) : null;
}

/** Most recent first. */
export function listJobs() {
  dropExpired();
  return [...jobs.values()].reverse().map(toPublic);
}

/**
 * Removes a finished (done or failed) job. Dismissing a failed job discards
 * its resume progress.
 */
export function dismissJob(id) {
  const job = jobs.get(id);
  if (!job) {
    const error = new Error('Job not found');
    error.status = 404;
    throw error;
  }
  if (isActive(job)) {
    const error = new Error('Active jobs cannot be dismissed');
    error.status = 409;
    throw error;
  }
  jobs.delete(id);
}

/**
 * Removes every finished (done or failed) job; queued and running ones stay.
 * @returns {number} How many jobs were removed
 */
export function clearFinishedJobs() {
  let removed = 0;
  for (const job of jobs.values()) {
    if (!isActive(job)) {
      jobs.delete(job.id);
      removed++;
    }
  }
  return removed;
}
