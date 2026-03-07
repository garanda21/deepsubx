import { Router } from 'express';
import { join } from 'path';
import { translateSRT } from '../services/deepl.js';
import { extractSubtitles } from '../services/ffmpeg.js';
import { DATA_DIR, MOVIES_DIR } from '../utils/paths.js';
const router = Router();

router.post('/translate_subtitle', async (req, res) => {
  try {
    const { serie, season, srt_path, source_lang, target_lang, type } = req.body;
    
    if (type === 'series' && (!serie || !season || !srt_path || !source_lang || !target_lang)) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    else if (type === 'movies' && (!serie || !srt_path || !source_lang || !target_lang)) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    if (!process.env.DEEPL_API_KEY) {
      return res.status(400).json({ message: 'DeepL API key not configured' });     
    }
    
    let subtitlePath;
    if (type === 'series') {
      subtitlePath = join(DATA_DIR, serie, season, srt_path);
    } else {
      subtitlePath = join(MOVIES_DIR, serie, srt_path);
    }
      
    const translatedPath = await translateSRT(subtitlePath, source_lang, target_lang);

    res.json({ path: translatedPath });
  } catch (error) {
    console.error('Error in subtitle translation:', error);
    
    // Format status code based on the error
    let statusCode = 500;
    if (error.status) {
      statusCode = error.status;
    }
    
    // Specific handling for size errors
    if (error.message && error.message.includes('exceeds the size limit')) {
      return res.status(statusCode).json({
        message: 'The SRT file is too large to translate in a single operation. Please try again so it can be processed in smaller parts.',
        originalError: error.toString(),
        isLargeFile: true
      });
    }
    
    // Authentication errors
    if (error.response && error.response.status === 403) {
      return res.status(403).json({
        message: 'Authentication failed with DeepL API. Please check your API key.',
        originalError: error.toString()
      });
    }
    
    // API limit errors 
    if (error.message && (error.message.includes('quota') || error.message.includes('limit'))) {
      return res.status(statusCode).json({
        message: 'DeepL API quota exceeded. Please try again later or upgrade your DeepL subscription.',
        originalError: error.toString()
      });
    }
    
    // Handle DeepL-specific errors with more details
    if (error.deeplRequest) {
      // This is a enhanced error from our DeepL service
      return res.status(statusCode).json({
        message: `DeepL translation failed: ${error.message}`,
        originalError: error.toString(),
        apiDetails: error.apiDetails || null,
        deeplRequest: error.deeplRequest,
        status: error.status || 500,
        stack: error.stack
      });
    }
    
    // Format a user-friendly error message with technical details
    const userMessage = 'Translation failed: ' + (error.message || 'Unknown error');
    
    res.status(statusCode).json({ 
      message: userMessage,        
      originalError: error.toString(),
      apiDetails: error.apiDetails || null,
      status: error.status || 500,
      stack: error.stack
    });
  }
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