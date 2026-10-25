import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockAxiosPost, chatPayload, translateAll } from './helpers.js';

// Invalid values must fall back to the defaults (25 per batch, 3 workers)
process.env.LLM_MODEL = 'main';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_BASE_URL = 'http://llm.test/v1';
process.env.LLM_BATCH_SIZE = '0';
process.env.LLM_CONCURRENCY = 'abc';
process.env.LLM_MAX_RETRIES = '-1';
process.env.LLM_PROMPT_FILE = '/nonexistent/prompt.txt';
const { translateTextsLLM } = await import('../server/services/llm.js');

test('invalid numeric env vars fall back to their defaults', async () => {
  const mock = mockAxiosPost((url, body) => translateAll(body));
  const texts = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const result = await translateTextsLLM(texts, 'EN', 'ES');

  assert.equal(result.length, 60);
  assert.ok(result.every((text, i) => text === `T:line ${i}`));
  assert.deepEqual(mock.calls.map(c => chatPayload(c.body).translate.length), [25, 25, 10]);
});
