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
  const { subtitlePath: _subtitlePath, ...rest } = job;
  return rest;
}

function pruneFinished() {
  const finished = [...jobs.values()].filter(job => job.status === 'done' || job.status === 'error');
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
 */
export function createTranslationJob({ subtitlePath, sourceLang, targetLang, title, updatePlex }) {
  const job = {
    id: randomUUID(),
    status: 'queued',
    file: basename(subtitlePath),
    title,
    sourceLang,
    targetLang,
    updatePlex: !!updatePlex,
    progress: { done: 0, total: 0 },
    createdAt: new Date().toISOString(),
    subtitlePath,
  };
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
