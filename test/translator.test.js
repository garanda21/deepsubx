import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { mockAxiosPost, httpError, deeplResponse, makeTempDir, writeSRT } from './helpers.js';

// DeepL is the default provider
delete process.env.TRANSLATION_PROVIDER;
process.env.DEEPL_API_KEY = 'test-key';
const { translateSRT, getConfigError } = await import('../server/services/translator.js');
const { parseSRT } = await import('../server/utils/srt.js');

const dir = makeTempDir();

test('translates with DeepL, keeping timestamps and empty blocks', async () => {
  const file = path.join(dir, 'basic.en.srt');
  writeSRT(file, ['Hello', 'two\nlines', '', 'Bye']);
  const mock = mockAxiosPost((url, body) => deeplResponse(body));

  const output = await translateSRT(file, 'EN', 'ES');

  assert.equal(output, path.join(dir, 'basic.es.srt'));
  assert.equal(mock.calls.length, 1);
  assert.match(mock.calls[0].url, /\/translate$/);
  // Line breaks are joined so DeepL keeps the context between lines
  assert.deepEqual(mock.calls[0].body.text, ['Hello', 'two lines', 'Bye']);

  const original = parseSRT(fs.readFileSync(file, 'utf-8'));
  const translated = parseSRT(fs.readFileSync(output, 'utf-8'));
  assert.deepEqual(translated.map(s => s.text), ['D:Hello', 'D:two lines', '', 'D:Bye']);
  assert.deepEqual(translated.map(s => s.startTime), original.map(s => s.startTime));
});

test('sends at most 50 texts per DeepL request', async () => {
  const file = path.join(dir, 'batches.en.srt');
  writeSRT(file, Array.from({ length: 120 }, (_, i) => `Line ${i}`));
  const mock = mockAxiosPost((url, body) => deeplResponse(body));

  await translateSRT(file, 'EN', 'ES');

  assert.deepEqual(mock.calls.map(c => c.body.text.length), [50, 50, 20]);
});

test('resumes a failed DeepL run without repeating finished batches', async () => {
  const file = path.join(dir, 'resume.en.srt');
  writeSRT(file, Array.from({ length: 120 }, (_, i) => `Line ${i}`));
  let failing = true;
  const mock = mockAxiosPost((url, body, n) => {
    if (failing && n === 2) throw httpError(456, { message: 'Quota exceeded' });
    return deeplResponse(body);
  });
  const partial = [];

  await assert.rejects(translateSRT(file, 'EN', 'ES', { partial }), { status: 456, message: 'Quota exceeded' });
  assert.equal(partial.filter(text => text !== undefined).length, 50);
  assert.equal(fs.existsSync(path.join(dir, 'resume.es.srt')), false, 'no partial file is written');

  failing = false;
  mock.calls.length = 0;
  await translateSRT(file, 'EN', 'ES', { partial });

  assert.equal(mock.calls.length, 2);
  const translated = parseSRT(fs.readFileSync(path.join(dir, 'resume.es.srt'), 'utf-8'));
  assert.ok(translated.every((s, i) => s.text === `D:Line ${i}`));
});

test('discards saved progress when the source text changed', async () => {
  const file = path.join(dir, 'changed.en.srt');
  writeSRT(file, Array.from({ length: 60 }, (_, i) => `Original ${i}`));
  let failing = true;
  const mock = mockAxiosPost((url, body, n) => {
    if (failing && n === 2) throw httpError(456, { message: 'Quota exceeded' });
    return deeplResponse(body);
  });
  const partial = [];
  await assert.rejects(translateSRT(file, 'EN', 'ES', { partial }));

  // Same number of blocks, different text
  writeSRT(file, Array.from({ length: 60 }, (_, i) => `Edited ${i}`));
  failing = false;
  mock.calls.length = 0;
  await translateSRT(file, 'EN', 'ES', { partial });

  assert.equal(mock.calls.length, 2, 'everything is translated again');
  const output = fs.readFileSync(path.join(dir, 'changed.es.srt'), 'utf-8');
  assert.doesNotMatch(output, /Original/);
});

test('reports a missing DeepL key as a configuration error', () => {
  delete process.env.DEEPL_API_KEY;
  try {
    assert.match(getConfigError(), /DeepL API key not configured/);
  } finally {
    process.env.DEEPL_API_KEY = 'test-key';
  }
  assert.equal(getConfigError(), null);
});
