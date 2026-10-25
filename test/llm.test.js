import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockAxiosPost, httpError, chatPayload, chatResponse, translateAll } from './helpers.js';

// llm.js reads its configuration at import time
process.env.LLM_MODEL = 'main';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_BASE_URL = 'http://llm.test/v1';
process.env.LLM_BATCH_SIZE = '2';
process.env.LLM_CONTEXT_SIZE = '1';
process.env.LLM_CONCURRENCY = '1';
process.env.LLM_MAX_RETRIES = '2';
process.env.LLM_PROMPT_FILE = '/nonexistent/prompt.txt';
const { translateTextsLLM } = await import('../server/services/llm.js');

const TEXTS = ['one', 'two', 'three', 'four', 'five'];

function withFallbacks(models, fn) {
  return async () => {
    process.env.LLM_FALLBACK_MODELS = models;
    try {
      await fn();
    } finally {
      delete process.env.LLM_FALLBACK_MODELS;
    }
  };
}

test('translates in batches and keeps the original order', async () => {
  const mock = mockAxiosPost((url, body) => translateAll(body));
  const progress = [];
  const result = await translateTextsLLM(TEXTS, 'EN', 'ES', {
    title: 'Show',
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });

  assert.deepEqual(result, TEXTS.map(t => `T:${t}`));
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(progress, ['0/3', '1/3', '2/3', '3/3']);

  const second = chatPayload(mock.calls[1].body);
  assert.equal(second.title, 'Show');
  assert.deepEqual(second.context, [{ i: 1, t: 'two' }]);
  assert.deepEqual(second.translate, [{ i: 2, t: 'three' }, { i: 3, t: 'four' }]);
  assert.match(mock.calls[0].body.messages[0].content, /from English to Spanish/);
});

test('retries a malformed response once', async () => {
  const mock = mockAxiosPost((url, body, n) => (n === 1 ? chatResponse('not json') : translateAll(body)));
  const result = await translateTextsLLM(['a', 'b'], 'EN', 'ES');

  assert.deepEqual(result, ['T:a', 'T:b']);
  assert.equal(mock.calls.length, 2);
});

test('splits a batch whose responses keep missing ids', async () => {
  const mock = mockAxiosPost((url, body) => {
    const { translate } = chatPayload(body);
    // Drop the last entry whenever more than one is requested
    const items = translate.slice(0, translate.length > 1 ? -1 : undefined).map(({ i, t }) => ({ i, t: `T:${t}` }));
    return chatResponse(JSON.stringify({ items }));
  });
  const result = await translateTextsLLM(['a', 'b'], 'EN', 'ES');

  assert.deepEqual(result, ['T:a', 'T:b']);
  // 2 failed attempts on the pair, then one request per half
  assert.equal(mock.calls.length, 4);
});

test('treats empty content as a malformed response, not a network failure', async () => {
  const mock = mockAxiosPost(() => chatResponse(null));
  const start = Date.now();

  await assert.rejects(translateTextsLLM(['a'], 'EN', 'ES'), (error) => {
    assert.match(error.message, /has no message content/);
    assert.doesNotMatch(error.message, /unreachable/);
    return true;
  });
  assert.equal(mock.calls.length, 2);
  assert.ok(Date.now() - start < 1000, 'should not wait for network backoff');
});

test('fills partial results and resumes only the missing batches', async () => {
  let failing = true;
  const mock = mockAxiosPost((url, body) => {
    const { translate } = chatPayload(body);
    if (failing && translate[0].i === 2) throw httpError(400, { error: { message: 'bad request' } });
    return translateAll(body);
  });
  const partial = [];

  await assert.rejects(translateTextsLLM(TEXTS, 'EN', 'ES', { partial }), { status: 400 });
  assert.deepEqual(partial.slice(0, 2), ['T:one', 'T:two']);
  assert.equal(partial[2], undefined);

  failing = false;
  mock.calls.length = 0;
  const progress = [];
  const result = await translateTextsLLM(TEXTS, 'EN', 'ES', {
    partial,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });

  assert.deepEqual(result, TEXTS.map(t => `T:${t}`));
  assert.equal(mock.calls.length, 2, 'the finished first batch is not requested again');
  assert.equal(progress[0], '1/3');
});

test('reports a network failure as unreachable without splitting the batch', async () => {
  const mock = mockAxiosPost(() => {
    const error = new Error('connect ECONNREFUSED');
    error.code = 'ECONNREFUSED';
    throw error;
  });

  await assert.rejects(translateTextsLLM(['a', 'b'], 'EN', 'ES'), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /unreachable: ECONNREFUSED/);
    return true;
  });
  assert.equal(mock.calls.length, 2, 'retried, but never split');
});

test('falls back on a 400 for that request only', withFallbacks('fb-400', async () => {
  process.env.LLM_MODEL = 'main-400';
  try {
    const mock = mockAxiosPost((url, body) => {
      if (body.model === 'main-400') throw httpError(400, { error: { message: 'response_format not supported' } });
      return translateAll(body, body.model);
    });
    const result = await translateTextsLLM(['a', 'b', 'c'], 'EN', 'ES');

    assert.deepEqual(result, ['fb-400:a', 'fb-400:b', 'fb-400:c']);
    // The main model is tried again for the second batch: no cooldown
    assert.deepEqual(mock.calls.map(c => c.body.model), ['main-400', 'fb-400', 'main-400', 'fb-400']);
  } finally {
    process.env.LLM_MODEL = 'main';
  }
}));

test('puts a rate-limited model on cooldown', withFallbacks('fb-429', async () => {
  process.env.LLM_MODEL = 'main-429';
  try {
    const mock = mockAxiosPost((url, body) => {
      if (body.model === 'main-429') throw httpError(429, { error: { message: 'rate limited' } }, { 'retry-after': '0' });
      return translateAll(body, body.model);
    });
    const result = await translateTextsLLM(['a', 'b', 'c'], 'EN', 'ES');

    assert.deepEqual(result, ['fb-429:a', 'fb-429:b', 'fb-429:c']);
    // 2 attempts on the main model, then it is skipped for the next batch
    assert.deepEqual(mock.calls.map(c => c.body.model), ['main-429', 'main-429', 'fb-429', 'fb-429']);
  } finally {
    process.env.LLM_MODEL = 'main';
  }
}));

test('does not fall back on authentication errors', withFallbacks('fb-auth', async () => {
  const mock = mockAxiosPost(() => {
    throw httpError(401, { error: { message: 'invalid key' } });
  });

  await assert.rejects(translateTextsLLM(['a'], 'EN', 'ES'), { status: 401 });
  assert.deepEqual(mock.calls.map(c => c.body.model), ['main']);
}));
