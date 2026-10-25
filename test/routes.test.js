import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { mockAxiosPost, deeplResponse, makeTempDir, writeSRT } from './helpers.js';

// paths.js reads the media directories at import time
const dataDir = makeTempDir();
const moviesDir = makeTempDir();
process.env.DATA_DIR = dataDir;
process.env.MOVIES_DIR = moviesDir;
delete process.env.TRANSLATION_PROVIDER;
process.env.DEEPL_API_KEY = 'test-key';
const { default: subtitleRouter } = await import('../server/routes/subtitle.js');

fs.mkdirSync(path.join(dataDir, 'Show', 'Season 1'), { recursive: true });
writeSRT(path.join(dataDir, 'Show', 'Season 1', 'ep1.en.srt'), ['Hello']);

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', subtitleRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  baseUrl = `http://localhost:${server.address().port}/api`;
});

after(() => server.close());

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const valid = { serie: 'Show', season: 'Season 1', srt_path: 'ep1.en.srt', source_lang: 'EN', target_lang: 'ES', type: 'series' };

test('rejects invalid translate_subtitle requests', async (t) => {
  const cases = [
    ['missing parameters', { ...valid, srt_path: undefined }, /Missing/],
    ['unknown type', { ...valid, type: 'bogus' }, /Invalid type/],
    ['path traversal in the show name', { ...valid, serie: '../..', season: 'etc' }, /Invalid subtitle path/],
    ['path traversal in the file name', { ...valid, srt_path: '../../../x.srt' }, /Invalid subtitle path/],
    ['language code with a path', { ...valid, target_lang: '../../x' }, /Invalid language code/],
    ['non-SRT file', { ...valid, srt_path: 'ep1.en.mkv' }, /Only \.srt files/],
  ];
  for (const [name, body, message] of cases) {
    await t.test(name, async () => {
      const response = await post('/translate_subtitle', body);
      assert.equal(response.status, 400);
      assert.match(response.body.message, message);
    });
  }
});

test('returns 404 for a subtitle file that does not exist', async () => {
  const response = await post('/translate_subtitle', { ...valid, srt_path: 'missing.srt' });

  assert.equal(response.status, 404);
});

test('queues a valid translation and exposes it as a job', async () => {
  mockAxiosPost((url, body) => deeplResponse(body));
  const response = await post('/translate_subtitle', { ...valid, target_lang: 'PT-BR' });

  assert.equal(response.status, 202);
  assert.equal(response.body.file, 'ep1.en.srt');
  assert.equal(response.body.season, 'Season 1');

  const job = await (await fetch(`${baseUrl}/jobs/${response.body.id}`)).json();
  assert.equal(job.id, response.body.id);
  assert.equal((await fetch(`${baseUrl}/jobs/unknown`)).status, 404);
});

test('rejects path traversal in extract_subtitles', async () => {
  const response = await post('/extract_subtitles', {
    serie: '../..', season: 'etc', video_file: 'a.mkv', source_lang: 'EN', type: 'series',
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /Invalid video path/);
});
