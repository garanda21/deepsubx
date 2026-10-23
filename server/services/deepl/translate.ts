import { uploadDocument, checkStatus, downloadDocument } from './api';
import type { TranslationParams } from './types';

const POLLING_INTERVAL = 5000; // 5 seconds

export async function translateDocument({
  filePath,
  sourceLang,
  targetLang,
}: TranslationParams): Promise<string> {
  try {    
    // 1. Upload document
    const file = new File([filePath], 'subtitle.srt', { type: 'text/plain' });
    const { document_id, document_key } = await uploadDocument(
      file,
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

    // 3. Download translated document
    await downloadDocument(document_id, document_key);
    
    // Return the path where the file was saved
    return `${filePath}.${targetLang.toLowerCase()}.srt`;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Translation failed', { cause: error });
  }
}