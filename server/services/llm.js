import fs from 'fs';
import axios from 'axios';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_PATH = join(__dirname, '..', 'prompts', 'llm-system-prompt.txt');
const CUSTOM_PROMPT_PATH = process.env.LLM_PROMPT_FILE || '/config/llm-system-prompt.txt';

const BASE_URL = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const BATCH_SIZE = parseInt(process.env.LLM_BATCH_SIZE || '25', 10);
const CONTEXT_SIZE = parseInt(process.env.LLM_CONTEXT_SIZE || '5', 10);
const CONCURRENCY = parseInt(process.env.LLM_CONCURRENCY || '3', 10);
const TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || '0.2');
const JSON_MODE = process.env.LLM_JSON_MODE !== 'false';
const REQUEST_TIMEOUT = 180000; // 3 minutes per request
const MAX_HTTP_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '5', 10);

// Tokens consumed since the server started (shown in the UI)
const usage = { prompt_tokens: 0, completion_tokens: 0 };

export function getLLMConfigError() {
  if (!process.env.LLM_API_KEY && !process.env.LLM_BASE_URL) {
    return 'LLM provider not configured: set LLM_API_KEY (and LLM_BASE_URL for non-OpenAI endpoints)';
  }
  if (!process.env.LLM_MODEL) {
    return 'LLM provider not configured: set LLM_MODEL';
  }
  return null;
}

export function getLLMUsage() {
  return {
    provider: 'llm',
    model: process.env.LLM_MODEL || null,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
  };
}

function languageName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

/**
 * Loads the system prompt. A mounted custom prompt file takes precedence over
 * the bundled default. Read on every translation so edits apply without restart.
 */
function loadSystemPrompt(sourceLang, targetLang) {
  let template;
  if (fs.existsSync(CUSTOM_PROMPT_PATH)) {
    console.log(`Using custom LLM system prompt: ${CUSTOM_PROMPT_PATH}`);
    template = fs.readFileSync(CUSTOM_PROMPT_PATH, 'utf-8');
  } else {
    template = fs.readFileSync(DEFAULT_PROMPT_PATH, 'utf-8');
  }
  return template
    .replaceAll('{{SOURCE_LANG}}', languageName(sourceLang))
    .replaceAll('{{TARGET_LANG}}', languageName(targetLang));
}

async function chatCompletion(systemPrompt, userContent) {
  const body = {
    model: process.env.LLM_MODEL,
    temperature: TEMPERATURE,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };
  if (JSON_MODE) {
    body.response_format = { type: 'json_object' };
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await axios.post(`${BASE_URL}/chat/completions`, body, {
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.LLM_API_KEY && { Authorization: `Bearer ${process.env.LLM_API_KEY}` }),
        },
        timeout: REQUEST_TIMEOUT,
      });
      usage.prompt_tokens += response.data.usage?.prompt_tokens || 0;
      usage.completion_tokens += response.data.usage?.completion_tokens || 0;
      const content = response.data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('LLM response has no message content');
      }
      return content;
    } catch (error) {
      const status = error.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_HTTP_RETRIES) {
        if (error.response) {
          const apiMessage = error.response.data?.error?.message || `API Error (${status})`;
          const enhanced = new Error(`LLM API error: ${apiMessage}`);
          enhanced.status = status;
          enhanced.apiDetails = error.response.data;
          throw enhanced;
        }
        // Network failure: flag it as an HTTP-level error so batches are not split
        const enhanced = new Error(`LLM API unreachable: ${error.code || error.message}`);
        enhanced.status = 503;
        throw enhanced;
      }
      // Honor Retry-After when present, otherwise exponential backoff capped at 30s
      const retryAfter = parseInt(error.response?.headers?.['retry-after'], 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** (attempt - 1), 30000);
      console.warn(`LLM request failed (${status || error.code}), retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function parseItems(content) {
  // Tolerate models that wrap the JSON in code fences or add stray text
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const snippet = content.slice(0, 200).replace(/\s+/g, ' ');
  if (start === -1 || end === -1) {
    throw new Error(`LLM response is not JSON: "${snippet}"`);
  }
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch (error) {
    throw new Error(`${error.message}: "${snippet}"`);
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error('LLM response has no "items" array');
  }
  return parsed.items;
}

/**
 * Translates one batch, validating a strict 1:1 id mapping. On a malformed
 * response it retries once, then splits the batch in half.
 */
async function translateBatch(systemPrompt, entries, context, title) {
  const payload = {
    ...(title && { title }),
    context: context.map(({ i, t }) => ({ i, t })),
    translate: entries.map(({ i, t }) => ({ i, t })),
  };

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const items = parseItems(await chatCompletion(systemPrompt, JSON.stringify(payload)));
      const byId = new Map(items.map((item) => [Number(item.i), item.t]));
      const missing = entries.filter(({ i }) => typeof byId.get(i) !== 'string');
      if (missing.length > 0) {
        throw new Error(`LLM response is missing ${missing.length} of ${entries.length} entries`);
      }
      return entries.map(({ i }) => byId.get(i));
    } catch (error) {
      if (error.status) throw error; // HTTP errors were already retried
      lastError = error;
      console.warn(`Invalid LLM batch response (attempt ${attempt}): ${error.message}`);
    }
  }

  if (entries.length === 1) {
    throw new Error(`LLM translation failed: ${lastError.message}`);
  }
  const mid = Math.ceil(entries.length / 2);
  console.warn(`Splitting batch of ${entries.length} entries in two`);
  const first = await translateBatch(systemPrompt, entries.slice(0, mid), context, title);
  const second = await translateBatch(systemPrompt, entries.slice(mid), entries.slice(Math.max(0, mid - CONTEXT_SIZE), mid), title);
  return [...first, ...second];
}

/**
 * Translates an array of subtitle texts with an OpenAI-compatible chat API.
 * @param {string[]} texts Texts to translate
 * @param {string} sourceLang Source language code
 * @param {string} targetLang Target language code
 * @param {{title?: string, onProgress?: (done: number, total: number) => void}} options
 *   Extra context for the model and a batch progress callback
 * @returns {Promise<string[]>} Translations in the same order
 */
export async function translateTextsLLM(texts, sourceLang, targetLang, { title, onProgress } = {}) {
  const systemPrompt = loadSystemPrompt(sourceLang, targetLang);
  const entries = texts.map((t, i) => ({ i, t }));

  const batches = [];
  for (let start = 0; start < entries.length; start += BATCH_SIZE) {
    batches.push({
      entries: entries.slice(start, start + BATCH_SIZE),
      // Source lines before the batch, so batches can run concurrently
      context: entries.slice(Math.max(0, start - CONTEXT_SIZE), start),
    });
  }
  console.log(`Translating ${texts.length} texts with ${process.env.LLM_MODEL} in ${batches.length} batch(es)`);

  const results = new Array(batches.length);
  let next = 0;
  let done = 0;
  onProgress?.(0, batches.length);
  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      results[index] = await translateBatch(systemPrompt, batches[index].entries, batches[index].context, title);
      console.log(`LLM batch ${++done}/${batches.length} done`);
      onProgress?.(done, batches.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  return results.flat();
}
