import fs from 'fs';
import { createHash } from 'crypto';
import { parseSRT, stringifySRT } from '../utils/srt.js';
import { buildTextBatches, getTranslatedFilePath, getUsageStats, translateTexts } from './deepl.js';
import { getLLMConfigError, getLLMUsage, translateTextsLLM } from './llm.js';

// Hash of the source texts each saved `partial` array was built from
const partialSources = new WeakMap();

function hashTexts(texts) {
  return createHash('sha256').update(JSON.stringify(texts)).digest('hex');
}

export function getProvider() {
  return (process.env.TRANSLATION_PROVIDER || 'deepl').toLowerCase() === 'llm' ? 'llm' : 'deepl';
}

/**
 * @returns {string|null} A configuration error for the active provider, or null
 */
export function getConfigError() {
  if (getProvider() === 'llm') {
    return getLLMConfigError();
  }
  return process.env.DEEPL_API_KEY ? null : 'DeepL API key not configured';
}

export async function getUsage() {
  if (getProvider() === 'llm') {
    return getLLMUsage();
  }
  return { provider: 'deepl', ...(await getUsageStats()) };
}

async function translateWithDeepL(texts, sourceLang, targetLang, { onProgress, partial = [] } = {}) {
  // Replace newlines with space so DeepL receives each subtitle as a single
  // sentence with full context, instead of treating each line independently.
  const normalized = texts.map(text => text.replace(/\n/g, ' '));
  const batches = buildTextBatches(normalized);
  console.log(`Sending ${normalized.length} non-empty texts to DeepL in ${batches.length} batch(es)`);

  onProgress?.(0, batches.length);
  let offset = 0;
  for (let i = 0; i < batches.length; i++) {
    const start = offset;
    offset += batches[i].length;
    // Skip batches already translated by a previous failed run
    if (batches[i].every((_, k) => partial[start + k] !== undefined)) {
      onProgress?.(i + 1, batches.length);
      continue;
    }
    console.log(`Translating batch ${i + 1}/${batches.length} (${batches[i].length} texts)...`);
    try {
      const results = await translateTexts(batches[i], sourceLang, targetLang);
      results.forEach((text, k) => { partial[start + k] = text; });
      onProgress?.(i + 1, batches.length);
    } catch (error) {
      console.error(`Error translating batch ${i + 1}:`, error.message);
      if (error.response) {
        console.error('DeepL API Error Status:', error.response.status);
        console.error('DeepL API Error Response:', error.response.data);
        const msg = error.response.data?.message || `API Error (${error.response.status})`;
        const enhanced = new Error(msg);
        enhanced.status = error.response.status;
        enhanced.apiDetails = error.response.data;
        throw enhanced;
      }
      throw error;
    }
  }
  return texts.map((_, i) => partial[i]);
}

/**
 * Translates an SRT file with the configured provider, guaranteeing 1:1 mapping
 * between original and translated subtitle blocks. Timestamps never leave the server.
 * @param {string} filePath Path to the SRT file
 * @param {string} sourceLang Source language
 * @param {string} targetLang Target language
 * @param {object} options
 * @param {string} [options.title] Title of the work, as context for the LLM provider
 * @param {(done: number, total: number) => void} [options.onProgress] Batch progress callback
 * @param {Array<string|undefined>} [options.partial] Translations kept between runs
 *   so a retry resumes where the previous run failed
 * @returns {Promise<string>} Path to the translated file
 */
export async function translateSRT(filePath, sourceLang, targetLang, options = {}) {
  const subtitles = parseSRT(fs.readFileSync(filePath, 'utf-8'));
  const provider = getProvider();
  console.log(`Translating ${subtitles.length} subtitle blocks with provider: ${provider}`);

  // Only non-empty subtitles are translated; track the original index to map back.
  const toTranslate = [];
  for (let i = 0; i < subtitles.length; i++) {
    if (subtitles[i].text.trim() !== '') {
      toTranslate.push({ originalIndex: i, text: subtitles[i].text });
    }
  }
  const texts = toTranslate.map(item => item.text);

  // Discard saved progress if the file changed since the failed run
  if (options.partial) {
    const sourceHash = hashTexts(texts);
    if (partialSources.get(options.partial) !== sourceHash) {
      if (options.partial.some(text => text !== undefined)) {
        console.log('Subtitle file changed since the last attempt, starting over');
      }
      options.partial.length = 0;
      options.partial.length = texts.length;
      partialSources.set(options.partial, sourceHash);
    }
  }

  const translatedTexts = provider === 'llm'
    ? await translateTextsLLM(texts, sourceLang, targetLang, options)
    : await translateWithDeepL(texts, sourceLang, targetLang, options);

  for (let i = 0; i < toTranslate.length; i++) {
    subtitles[toTranslate[i].originalIndex].text = translatedTexts[i];
  }

  const outputPath = getTranslatedFilePath(filePath, sourceLang, targetLang);
  fs.writeFileSync(outputPath, stringifySRT(subtitles));
  console.log(`Translation complete: ${outputPath}`);
  return outputPath;
}
