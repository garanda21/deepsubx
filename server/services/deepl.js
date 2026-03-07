import FormData from 'form-data';
import fs from 'fs';
import axios from 'axios';
import path from 'path';
import { finished } from 'stream/promises';
import { join, parse } from 'path';
import { parseSRT, stringifySRT } from '../utils/srt.js';

const DEEPL_API_URL = 'https://api-free.deepl.com/v2';
const POLLING_INTERVAL = 5000; // 5 seconds
const CHUNK_CHAR_LIMIT = 400000; // 400k characters per chunk (safety margin below the 500k limit)
const CHUNK_FILE_SIZE_LIMIT = 130 * 1024; // 130KB per file (safety margin below the 150KB limit)

async function uploadDocument(filePath, sourceLang, targetLang) {
  try {
    const formData = new FormData();
   
    const filePathNorm = path.normalize(filePath);
    formData.append('file', fs.createReadStream(filePathNorm));
    formData.append('source_lang', sourceLang);
    formData.append('target_lang', targetLang);

    const response = await axios.post(
      `${DEEPL_API_URL}/document`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error uploading document to DeepL:', error.message);
    if (error.response) {
      console.error('DeepL API Error Status:', error.response.status);
      console.error('DeepL API Error Response:', error.response.data);
    }
    throw error; // Rethrow to be handled by the calling function
  }
}

async function checkStatus(documentId, documentKey) {
  try {
    const response = await axios.post(
      `${DEEPL_API_URL}/document/${documentId}`,
      {
        document_key: documentKey,
      },
      {
        headers: {
          'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error(`Error checking status for document ${documentId}:`, error.message);
    if (error.response) {
      console.error('DeepL API Error Status:', error.response.status);
      console.error('DeepL API Error Response:', error.response.data);
    }
    throw error; // Rethrow to be handled by the calling function
  }
}

async function downloadDocument(documentId, documentKey, outputPath) {
  try {
    const response = await axios.post(
      `${DEEPL_API_URL}/document/${documentId}/result`,
      {
        document_key: documentKey,
      },
      {
        headers: {
          'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        },
        responseType: 'stream',
      }
    );

    // Create a write stream
    const writer = fs.createWriteStream(outputPath);
    
    // Pipe the response data to the file
    response.data.pipe(writer);
    
    // Wait for the stream to finish
    await finished(writer);
    return outputPath;
  } catch (error) {
    console.error(`Error downloading document ${documentId}:`, error.message);
    if (error.response) {
      console.error('DeepL API Error Status:', error.response.status);
      console.error('DeepL API Error Response:', typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data);
    }
    throw error; // Rethrow to be handled by the calling function
  }
}
function getTranslatedFilePath(originalPath, sourceLang, targetLang) {
  const { dir, name, ext } = parse(originalPath);
  
  // Remove source language code if present (e.g., "myfile.en.srt" -> "myfile")
  const baseName = name.replace(new RegExp(`\\.${sourceLang.toLowerCase()}$`), '');
  
  // Create new filename with target language (e.g., "myfile.es.srt")
  const newName = `${baseName}.${targetLang.toLowerCase()}${ext}`;
  
  return join(dir, newName);
}
export async function translateDocument(filePath, sourceLang, targetLang) {
  try {
    // 1. Upload document
    const { document_id, document_key } = await uploadDocument(
      filePath,
      sourceLang,
      targetLang
    );

    // 2. Poll for status
    while (true) {
      const status = await checkStatus(document_id, document_key);

      if (status.status === 'done') {
        break;
      }

      if (status.status === 'error') {
        throw new Error(status.error_message || 'Translation failed');
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
    }

    // 3. Download translated document with correct naming
    const outputPath = getTranslatedFilePath(filePath, sourceLang, targetLang);
    await downloadDocument(document_id, document_key, outputPath);
    
    return outputPath;
  } catch (error) {    
      console.error('DeepL translation error details:', error);
      
      // Enhanced error handling for axios errors with response
      if (error.response) {
          // Access the original error message from the response data
          console.error('DeepL API Error Status:', error.response.status);
          console.error('DeepL API Error Response:', error.response.data);
          
          // Extract the most meaningful error message
          const originalMessage = 
              error.response.data.message || 
              (error.response.data.error ? error.response.data.error.message : null) || 
              `API Error (${error.response.status})`;
          
          // Improve the error message for size problems
          if (originalMessage && originalMessage.includes('size limit')) {
            throw new Error(`Document exceeds the size limit of 150 KB (500,000 characters) for DeepL Free API. The system will attempt to process it in smaller parts.`);
          }
          
          // Create a more detailed error
          const enhancedError = new Error(originalMessage);
          enhancedError.status = error.response.status;
          enhancedError.apiDetails = error.response.data;
          enhancedError.deeplRequest = {
            documentId: error.config?.url?.match(/\/document\/([^\/]+)/)?.[1] || null,
            sourceLang,
            targetLang,
            endpoint: error.config?.url || null
          };
          throw enhancedError;
      } else if (error instanceof Error) {
          // For non-axios errors, preserve the stack trace but add context
          const enhancedError = new Error(`DeepL API Error: ${error.message}`);
          enhancedError.originalError = error;
          enhancedError.stack = error.stack;
          throw enhancedError;
      } else {
        throw new Error('An unknown error occurred during translation');
      }
  }
}
export async function getUsageStats() {
  try {
    const response = await axios.get(`${DEEPL_API_URL}/usage`, {
      headers: {
        'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      },
    });

    return {
      character_count: response.data.character_count || 0,
      character_limit: response.data.character_limit || 500000,
    };
  } catch (error) {
    console.error('Error fetching DeepL usage stats:', error);
    return {
      character_count: 0,
      character_limit: 500000,
    };
  }
}

/**
 * Translates a large SRT file by dividing it into smaller parts.
 * @param {string} filePath Path to the SRT file
 * @param {string} sourceLang Source language
 * @param {string} targetLang Target language
 * @returns {Promise<string>} Path to the translated file
 */
export async function translateLargeDocument(filePath, sourceLang, targetLang) {
  try {
    // Read the SRT file
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    console.log(`Processing SRT file of ${Math.round(Buffer.byteLength(fileContent, 'utf-8') / 1024)}KB`);
    
    // Parse the SRT into subtitles
    const subtitles = parseSRT(fileContent);
    console.log(`The file contains ${subtitles.length} subtitles`);
    
    // Split into chunks that respect the character limit
    const chunks = splitSubtitlesIntoChunks(subtitles, CHUNK_CHAR_LIMIT);
    console.log(`Splitting large SRT file into ${chunks.length} initial parts based on character limit`);
    
    // Create temporary files for each chunk and verify their size
    const tempFiles = [];
    const tempDir = path.dirname(filePath);
    const finalChunks = [];
    let createdFiles = []; // Tracking for cleanup in case of error
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkSubtitles = chunks[i];
      // Estimate chunk size
      const chunkEstimatedSize = Buffer.byteLength(stringifySRT(chunkSubtitles), 'utf-8');
      console.log(`Chunk ${i+1}: ${chunkSubtitles.length} subtitles, estimated size: ${Math.round(chunkEstimatedSize / 1024)}KB`);
      
      // Further divide if necessary to meet file size limit
      const subChunks = validateFileSize(chunkSubtitles);
      console.log(`Chunk ${i+1} subdivided into ${subChunks.length} parts to meet file size limit`);
      
      for (let j = 0; j < subChunks.length; j++) {
        const chunkContent = stringifySRT(subChunks[j]);
        const chunkSize = Buffer.byteLength(chunkContent, 'utf-8');
        const tempFilePath = join(tempDir, `temp_chunk_${i}_${j}_${Date.now()}.srt`);
        fs.writeFileSync(tempFilePath, chunkContent);
        createdFiles.push(tempFilePath);
        
        // Final verification of file size
        const stats = fs.statSync(tempFilePath);
        console.log(`Chunk ${i+1}-${j+1}: ${subChunks[j].length} subtitles, actual size: ${Math.round(stats.size / 1024)}KB`);
        
        if (stats.size > CHUNK_FILE_SIZE_LIMIT) {
          console.warn(`⚠️ Warning: Chunk ${i+1}-${j+1} exceeds size limit: ${Math.round(stats.size / 1024)}KB > ${Math.round(CHUNK_FILE_SIZE_LIMIT / 1024)}KB`);
          
          if (subChunks[j].length > 1) {
            // If the chunk has more than one subtitle, we can try to divide it further
            console.log(`Attempting to divide chunk ${i+1}-${j+1} further...`);
            // Delete this file
            fs.unlinkSync(tempFilePath);
            createdFiles = createdFiles.filter(f => f !== tempFilePath);
            
            // Manually divide into individual subtitles as a last resort
            for (let k = 0; k < subChunks[j].length; k++) {
              const singleSubContent = stringifySRT([subChunks[j][k]]);
              const singleFilePath = join(tempDir, `temp_chunk_${i}_${j}_${k}_${Date.now()}.srt`);
              fs.writeFileSync(singleFilePath, singleSubContent);
              const singleStats = fs.statSync(singleFilePath);
              console.log(`  Individual subtitle ${k+1}: size ${Math.round(singleStats.size / 1024)}KB`);
              
              if (singleStats.size > CHUNK_FILE_SIZE_LIMIT) {
                console.error(`❌ Error: Even an individual subtitle exceeds the limit: ${Math.round(singleStats.size / 1024)}KB`);
                // In this extreme case, we could truncate the subtitle or handle it differently
              }
              
              tempFiles.push(singleFilePath);
              createdFiles.push(singleFilePath);
            }
          } else {
            // If it only has one subtitle and is still too large, we let it through and hope for the best
            tempFiles.push(tempFilePath);
          }
        } else {
          tempFiles.push(tempFilePath);
          finalChunks.push(subChunks[j]);
        }
      }
    }
    
    console.log(`Final split into ${tempFiles.length} files for translation (after size validation)`);
    
    
    // Translate each chunk separately
    const translatedChunks = [];
    for (let i = 0; i < tempFiles.length; i++) {
      console.log(`Translating part ${i + 1} of ${tempFiles.length}...`);
      try {
        // Use the regular translation method for each chunk
        await translateDocument(tempFiles[i], sourceLang, targetLang);
        
        // Read the translated file
        const translatedFilePath = getTranslatedFilePath(tempFiles[i], sourceLang, targetLang);
        const translatedContent = fs.readFileSync(translatedFilePath, 'utf-8');
        const translatedSubtitles = parseSRT(translatedContent);
        
        // Add to the collection of translated chunks
        translatedChunks.push(...translatedSubtitles);
        
        // Clean up temporary files
        fs.unlinkSync(tempFiles[i]);
        fs.unlinkSync(translatedFilePath);
      } catch (error) {
        console.error(`Error translating part ${i + 1}:`, error);
        throw new Error(`Error translating part ${i + 1}: ${error.message}`);
      }
    }
    
    // Rebuild subtitle indices
    const fixedSubtitles = translatedChunks.map((sub, index) => ({
      ...sub,
      id: index + 1
    }));
    
    // Create the final translated file
    const outputPath = getTranslatedFilePath(filePath, sourceLang, targetLang);
    fs.writeFileSync(outputPath, stringifySRT(fixedSubtitles));
    
    return outputPath;
  } catch (error) {
    console.error('Error in translateLargeDocument:', error);
    
    // Try to clean up temporary files if they exist
    try {
      if (Array.isArray(tempFiles)) {
        console.log(`Cleaning up ${tempFiles.length} temporary files due to error...`);
        for (const tempFile of tempFiles) {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
            
            // Also try to remove possible translated files
            const translatedPath = getTranslatedFilePath(tempFile, sourceLang, targetLang);
            if (fs.existsSync(translatedPath)) {
              fs.unlinkSync(translatedPath);
            }
          }
        }
      }
      
      // Clean up created files that might not be in tempFiles
      if (Array.isArray(createdFiles)) {
        for (const file of createdFiles) {
          if (fs.existsSync(file) && !tempFiles.includes(file)) {
            fs.unlinkSync(file);
          }
        }
      }
    } catch (cleanupError) {
      console.error('Error during temporary file cleanup:', cleanupError);
    }
    
    // Propagate the original error with enhanced details
    if (error.response) {
      console.error('DeepL API Error Response:', error.response.data);
      console.error('DeepL API Error Status:', error.response.status);
      
      const originalMessage = error.response.data.message || 
                            (error.response.data.error ? error.response.data.error.message : null) || 
                            `API Error (${error.response.status})`;
                            
      const enhancedError = new Error(originalMessage);
      enhancedError.status = error.response.status;
      enhancedError.apiDetails = error.response.data;
      throw enhancedError;
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error('An unknown error occurred');
    }
  }
}

/**
 * Translates an array of text strings using the DeepL Text API.
 * @param {string[]} texts Array of strings to translate
 * @param {string} sourceLang Source language
 * @param {string} targetLang Target language
 * @returns {Promise<string[]>} Array of translated strings in the same order
 */
async function translateTexts(texts, sourceLang, targetLang) {
  const response = await axios.post(
    `${DEEPL_API_URL}/translate`,
    { text: texts, source_lang: sourceLang, target_lang: targetLang },
    {
      headers: {
        'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data.translations.map(t => t.text);
}

const TEXT_API_MAX_TEXTS = 50;
const TEXT_API_MAX_BYTES = 100 * 1024; // 100KB safety margin under the 128KB limit

/**
 * Splits an array of text strings into batches that respect both the
 * max-texts-per-request and max-bytes-per-request limits of the DeepL Text API.
 * @param {string[]} texts Array of text strings
 * @returns {string[][]} Array of batches
 */
function buildTextBatches(texts) {
  const batches = [];
  let currentBatch = [];
  let currentBytes = 0;

  for (const text of texts) {
    const textBytes = Buffer.byteLength(text, 'utf-8');

    const wouldExceedCount = currentBatch.length >= TEXT_API_MAX_TEXTS;
    const wouldExceedBytes = currentBytes + textBytes > TEXT_API_MAX_BYTES;

    if (currentBatch.length > 0 && (wouldExceedCount || wouldExceedBytes)) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(text);
    currentBytes += textBytes;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Translates an SRT file using the DeepL Text API, guaranteeing 1:1 mapping
 * between original and translated subtitle blocks.
 * @param {string} filePath Path to the SRT file
 * @param {string} sourceLang Source language
 * @param {string} targetLang Target language
 * @returns {Promise<string>} Path to the translated file
 */
export async function translateSRT(filePath, sourceLang, targetLang) {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const subtitles = parseSRT(fileContent);
  console.log(`Translating ${subtitles.length} subtitle blocks via Text API`);

  // Separate non-empty subtitles (to be translated) from empty ones (kept as-is).
  // We track the original index so we can map translations back correctly.
  const toTranslate = []; // { originalIndex, text }
  for (let i = 0; i < subtitles.length; i++) {
    if (subtitles[i].text.trim() !== '') {
      toTranslate.push({ originalIndex: i, text: subtitles[i].text });
    }
  }

  // Replace newlines with space so DeepL receives each subtitle as a single
  // sentence with full context, instead of treating each line independently.
  const multilineCount = toTranslate.filter(item => item.text.includes('\n')).length;
  if (multilineCount > 0) {
    console.log(`Normalizing ${multilineCount} multi-line subtitles: removing line breaks so DeepL retains context between lines`);
  }
  const texts = toTranslate.map(item => item.text.replace(/\n/g, ' '));
  const batches = buildTextBatches(texts);
  console.log(`Sending ${texts.length} non-empty texts in ${batches.length} batch(es)`);

  // Translate batches sequentially and collect results in order
  const translatedTexts = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`Translating batch ${i + 1}/${batches.length} (${batches[i].length} texts)...`);
    try {
      const results = await translateTexts(batches[i], sourceLang, targetLang);
      translatedTexts.push(...results);
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

  // Map translations back to the original subtitle array
  for (let i = 0; i < toTranslate.length; i++) {
    subtitles[toTranslate[i].originalIndex].text = translatedTexts[i];
  }

  const outputPath = getTranslatedFilePath(filePath, sourceLang, targetLang);
  fs.writeFileSync(outputPath, stringifySRT(subtitles));
  console.log(`Translation complete: ${outputPath}`);
  return outputPath;
}

/**
 * Splits an array of subtitles into smaller chunks that don't exceed the character limit
 * @param {Array} subtitles Array of subtitle objects
 * @param {number} charLimit Character limit per chunk
 * @returns {Array} Array of arrays of subtitles divided into chunks
 */
function splitSubtitlesIntoChunks(subtitles, charLimit) {
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  
  for (const subtitle of subtitles) {
    // Calculate the approximate size of this subtitle
    const subtitleContent = `${subtitle.id}\n${subtitle.startTime} --> ${subtitle.endTime}\n${subtitle.text}\n\n`;
    const subtitleSize = Buffer.byteLength(subtitleContent, 'utf-8');
    
    // If adding this subtitle would exceed the limit, start a new chunk
    if (currentSize + subtitleSize > charLimit && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }
    
    // Add the subtitle to the current chunk
    currentChunk.push(subtitle);
    currentSize += subtitleSize;
  }
  
  // Add the last chunk if it has content
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Validates and subdivides subtitle chunks if they exceed the file size limit
 * @param {Array} subtitles Array of subtitle objects
 * @returns {Array} Array of arrays of subdivided subtitles if necessary
 */
function validateFileSize(subtitles) {
  // If the subtitle set is small, no need to divide it further
  if (subtitles.length <= 5) {
    return [subtitles];
  }
  
  // First we check if the estimated size is acceptable
  const content = stringifySRT(subtitles);
  const contentSize = Buffer.byteLength(content, 'utf-8');
  
  if (contentSize <= CHUNK_FILE_SIZE_LIMIT) {
    return [subtitles];
  }
  
  console.log(`Subdividing chunk with ${subtitles.length} subtitles (${Math.round(contentSize/1024)}KB)`);
  
  // If it's too large, divide it into smaller parts
  const midPoint = Math.floor(subtitles.length / 2);
  const firstHalf = subtitles.slice(0, midPoint);
  const secondHalf = subtitles.slice(midPoint);
  
  // Recursively validate and subdivide each half if necessary
  return [
    ...validateFileSize(firstHalf),
    ...validateFileSize(secondHalf)
  ];
}