import { Router } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { getConfigError } from '../services/translator.js';
import { createTranslationJob, getJob, listJobs, retryJob } from '../services/jobs.js';
import { extractSubtitles } from '../services/ffmpeg.js';
import { DATA_DIR, MOVIES_DIR } from '../utils/paths.js';
const router = Router();

router.post('/translate_subtitle', (req, res) => {
  const { serie, season, srt_path, source_lang, target_lang, type, update_plex } = req.body;

  if (type === 'series' && (!serie || !season || !srt_path || !source_lang || !target_lang)) {
    return res.status(400).json({ message: 'Missing required parameters' });
  }
  else if (type === 'movies' && (!serie || !srt_path || !source_lang || !target_lang)) {
    return res.status(400).json({ message: 'Missing parameters' });
  }

  const configError = getConfigError();
  if (configError) {
    return res.status(400).json({ message: configError });
  }

  const subtitlePath = type === 'series'
    ? join(DATA_DIR, serie, season, srt_path)
    : join(MOVIES_DIR, serie, srt_path);
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

    let videoPath, outputPath;
    if (type === 'series') {
      videoPath = join(DATA_DIR, serie, season, video_file);
      const videoFileName = video_file.substring(0, video_file.lastIndexOf('.'));
      outputPath = join(DATA_DIR, serie, season, `${videoFileName}.${source_lang.toLowerCase()}.srt`);
    } else {
      videoPath = join(MOVIES_DIR, serie, video_file);
      const videoFileName = video_file.substring(0, video_file.lastIndexOf('.'));
      outputPath = join(MOVIES_DIR, serie, `${videoFileName}.${source_lang.toLowerCase()}.srt`);
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
      originalError: error.toString(),
      stack: error.stack
    });
  }
});

export default router;