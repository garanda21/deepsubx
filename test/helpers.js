import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';

/**
 * Replaces axios.post with a handler. Services call `axios.post` on the shared
 * default export, so this intercepts their requests.
 * @returns {{ calls: Array<{ url: string, body: any }> }}
 */
export function mockAxiosPost(handler) {
  const state = { calls: [] };
  axios.post = async (url, body) => {
    state.calls.push({ url, body });
    return handler(url, body, state.calls.length);
  };
  return state;
}

/** Builds an axios-like HTTP error. */
export function httpError(status, data = {}, headers = {}) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data, headers };
  return error;
}

/** Parses the user message of an OpenAI-style chat request. */
export function chatPayload(body) {
  return JSON.parse(body.messages[1].content);
}

/** OpenAI-style response carrying the given text as message content. */
export function chatResponse(content) {
  return { data: { choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
}

/** Successful translation of every requested entry, tagged with a prefix. */
export function translateAll(body, prefix = 'T') {
  const { translate } = chatPayload(body);
  return chatResponse(JSON.stringify({ items: translate.map(({ i, t }) => ({ i, t: `${prefix}:${t}` })) }));
}

/** DeepL Text API response translating every text with a prefix. */
export function deeplResponse(body, prefix = 'D') {
  return { data: { translations: body.text.map(text => ({ text: `${prefix}:${text}` })) } };
}

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deepsubx-test-'));
}

/** Writes an SRT file with one block per text. */
export function writeSRT(filePath, texts) {
  const content = texts
    .map((text, i) => `${i + 1}\n00:00:${String(i % 60).padStart(2, '0')},000 --> 00:00:${String(i % 60).padStart(2, '0')},500\n${text}\n`)
    .join('\n');
  fs.writeFileSync(filePath, content);
}

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Polls until the predicate returns a truthy value, or fails after a timeout. */
export async function waitFor(predicate, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await sleep(10);
  }
}
