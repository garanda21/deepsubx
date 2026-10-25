import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mockAxiosPost, httpError, deeplResponse, makeTempDir, writeSRT, waitFor } from './helpers.js';

delete process.env.TRANSLATION_PROVIDER;
process.env.DEEPL_API_KEY = 'test-key';
const { createTranslationJob, retryJob, getJob, listJobs } = await import('../server/services/jobs.js');

const dir = makeTempDir();

function newFile(name, count = 3) {
  const file = path.join(dir, `${name}.en.srt`);
  writeSRT(file, Array.from({ length: count }, (_, i) => `${name} ${i}`));
  return file;
}

function startJob(subtitlePath, targetLang = 'ES') {
  return createTranslationJob({ subtitlePath, sourceLang: 'EN', targetLang, title: 'Show', season: 's1' });
}

const isFinished = (id) => ['done', 'error'].includes(getJob(id)?.status) && getJob(id);

test('runs a job to completion with progress', async () => {
  mockAxiosPost((url, body) => deeplResponse(body));
  const job = startJob(newFile('complete'));
  // The queue starts the job right away when it is idle
  assert.ok(['queued', 'running'].includes(job.status));
  assert.equal(job.partial, undefined, 'internal state is not exposed');

  const finished = await waitFor(() => isFinished(job.id));
  assert.equal(finished.status, 'done');
  assert.equal(finished.path, path.join(dir, 'complete.es.srt'));
  assert.deepEqual(finished.progress, { done: 1, total: 1 });
  assert.equal(finished.plex, 'skipped');
});

test('rejects a duplicate while the same file and language is active', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  mockAxiosPost(async (url, body) => {
    await blocked;
    return deeplResponse(body);
  });
  const file = newFile('duplicate');
  const job = startJob(file);

  assert.throws(() => startJob(file), { status: 409 });
  const other = startJob(file, 'FR'); // another language is fine

  release();
  await waitFor(() => isFinished(job.id) && isFinished(other.id));
});

test('retry clears the previous attempt and resumes from saved progress', async () => {
  let failing = true;
  const mock = mockAxiosPost((url, body, n) => {
    if (failing && n === 2) throw httpError(456, { message: 'Quota exceeded' });
    return deeplResponse(body);
  });
  const job = startJob(newFile('retry', 120));

  const failed = await waitFor(() => isFinished(job.id));
  assert.equal(failed.status, 'error');
  assert.equal(failed.error.message, 'Quota exceeded');
  assert.deepEqual(failed.progress, { done: 1, total: 3 });
  assert.throws(() => retryJob('missing'), { status: 404 });

  failing = false;
  mock.calls.length = 0;
  const retried = retryJob(job.id);
  assert.equal(retried.attempts, 2);
  for (const field of ['error', 'finishedAt', 'path', 'plex']) {
    assert.equal(retried[field], undefined, `${field} is cleared`);
  }
  assert.notEqual(retried.startedAt, failed.startedAt, 'startedAt belongs to the new attempt');
  assert.throws(() => retryJob(job.id), { status: 409 }, 'an active job cannot be retried');

  const done = await waitFor(() => isFinished(job.id));
  assert.equal(done.status, 'done');
  assert.equal(mock.calls.length, 2, 'the finished batch is not translated again');
});

test('prunes completed jobs before failed ones', async () => {
  let failing = true;
  mockAxiosPost((url, body) => {
    if (failing) throw httpError(456, { message: 'Quota exceeded' });
    return deeplResponse(body);
  });
  const failed = startJob(newFile('keep-me'));
  await waitFor(() => isFinished(failed.id));

  failing = false;
  const jobs = Array.from({ length: 25 }, (_, i) => startJob(newFile(`bulk-${i}`)));
  await waitFor(() => jobs.every(job => !getJob(job.id) || isFinished(job.id)));

  const list = listJobs();
  assert.ok(list.length <= 20, `kept ${list.length} jobs`);
  assert.ok(list.some(job => job.id === failed.id), 'the failed job survives pruning');
  assert.equal(list[0].file, 'bulk-24.en.srt', 'most recent first');
});
