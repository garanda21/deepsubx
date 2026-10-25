import { Router } from 'express';
import { resolve, sep } from 'path';
import { existsSync } from 'fs';
import { getConfigError } from '../services/translator.js';
import { createTranslationJob, getJob, listJobs, retryJob } from '../services/jobs.js';
import { extractSubtitles } from '../services/ffmpeg.js';
import { DATA_DIR, MOVIES_DIR } from '../utils/paths.js';
const router = Router();

const LANG_CODE = /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/;

/**
 * Joins path segments under a base directory and rejects anything that
 * resolves outside of it (e.g. "../" in user-provided names).
 * @returns {string|null} The resolved path, or null if it escapes the base
 */
function resolveInside(base, ...segments) {
  const root = resolve(base);
  const target = resolve(root, ...segments.map(String));
  return target.startsWith(root + sep) ? target : null;
}

router.post('/translate_subtitle', (req, res) => {
  const { serie, season, srt_path, source_lang, target_lang, type, update_plex } = req.body;

  if (type === 'series' && (!serie || !season || !srt_path || !source_lang || !target_lang)) {
    return res.status(400).json({ message: 'Missing required parameters' });
  }
  else if (type === 'movies' && (!serie || !srt_path || !source_lang || !target_lang)) {
    return res.status(400).json({ message: 'Missing parameters' });
  }

  else if (type !== 'series' && type !== 'movies') {
    return res.status(400).json({ message: 'Invalid type' });
  }
  // Language codes end up in the output file name, so keep them strict
  if (!LANG_CODE.test(source_lang) || !LANG_CODE.test(target_lang)) {
    return res.status(400).json({ message: 'Invalid language code' });
  }
  if (!String(srt_path).toLowerCase().endsWith('.srt')) {
    return res.status(400).json({ message: 'Only .srt files can be translated' });
  }

  const configError = getConfigError();
  if (configError) {
    return res.status(400).json({ message: configError });
  }

  const subtitlePath = type === 'series'
    ? resolveInside(DATA_DIR, serie, season, srt_path)
    : resolveInside(MOVIES_DIR, serie, srt_path);
  if (!subtitlePath) {
    return res.status(400).json({ message: 'Invalid subtitle path' });
  }
  if (!existsSync(subtitlePath)) {
    return res.status(404).json({ message: `Subtitle file not found: ${srt_path}` });
  }

  // Translation can take minutes with an LLM, so it runs as a background job
  try {
    const job = createTranslationJob({
      subtitlePath,
      sourceLang: source_lang,
      targetLang: target_lang,
      title: serie,
      season: type === 'series' ? season : null,
      updatePlex: update_plex,
    });
    res.status(202).json(job);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

router.get('/jobs', (req, res) => {
  res.json(listJobs());
});

router.post('/jobs/:id/retry', (req, res) => {
  try {
    res.status(202).json(retryJob(req.params.id));
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ message: 'Job not found' });
  }
  res.json(job);
});

router.post('/extract_subtitles', async (req, res) => {
  try {
    const { serie, season, video_file, source_lang, type } = req.body;
    
    if (type === 'series' && (!serie || !season || !video_file)) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    else if (type === 'movies' && (!serie || !video_file)) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    else if (type !== 'series' && type !== 'movies') {
      return res.status(400).json({ message: 'Invalid type' });
    }
    if (!LANG_CODE.test(source_lang)) {
      return res.status(400).json({ message: 'Invalid language code' });
    }

    const videoFileName = video_file.substring(0, video_file.lastIndexOf('.'));
    const outputName = `${videoFileName}.${source_lang.toLowerCase()}.srt`;
    const [videoPath, outputPath] = type === 'series'
      ? [resolveInside(DATA_DIR, serie, season, video_file), resolveInside(DATA_DIR, serie, season, outputName)]
      : [resolveInside(MOVIES_DIR, serie, video_file), resolveInside(MOVIES_DIR, serie, outputName)];
    if (!videoPath || !outputPath) {
      return res.status(400).json({ message: 'Invalid video path' });
    }

    await extractSubtitles(videoPath, outputPath);
    res.json({ path: outputPath });
  } catch (error) {
    console.error('Error extracting subtitles:', error);
    
    // Format a user-friendly error message with technical details
    let userMessage = 'Failed to extract subtitles: ' + (error.message || 'Unknown error');
    let statusCode = 500;
    
    // Handle specific ffmpeg errors
    if (error.message && error.message.includes('No such file')) {
      userMessage = 'Video file not found or inaccessible';
      statusCode = 404;
    } else if (error.message && error.message.includes('No subtitle')) {
      userMessage = 'No subtitles found in this video file';
      statusCode = 422;
    }
    
    res.status(statusCode).json({ 
      message: userMessage,        
      originalError: error.toString()
    });
  }
});

export default router;