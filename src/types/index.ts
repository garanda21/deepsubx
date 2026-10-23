import type { AxiosError } from 'axios';

export interface Show {
  name: string;
  seasons: string[];
}

export interface Movie {
  name: string;
}

export interface SubtitleFile {
  name: string;
  path: string;
  language?: string;
}

export interface VideoFile {
  name: string;
  path: string;
}

export interface CharacterCount {
  provider?: 'deepl' | 'llm';
  character_count?: number;
  character_limit?: number;
  model?: string | null;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface TranslationJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  file: string;
  title: string;
  season: string | null;
  sourceLang: string;
  targetLang: string;
  updatePlex: boolean;
  progress: { done: number; total: number };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  path?: string;
  plex?: 'updated' | 'failed' | 'skipped';
  plexError?: string;
  error?: { message: string; status: number; apiDetails: unknown };
}

export interface Language {
  code: string;
  name: string;
}

/**
 * Standardized API error response interface
 */
export interface ApiErrorResponse {
  message: string; // User-friendly error message
  status: number; // HTTP status code
  originalError: string; // Original error message or toString
  apiDetails?: unknown; // Additional API details if available
  deeplRequest?: unknown; // DeepL specific request details
  isLargeFile?: boolean; // Flag for large file errors
  axiosError?: AxiosError; // Original axios error object
}
/**
 * Shape of errors caught in mutations: either the interceptor's
 * ApiErrorResponse or a raw axios-like error with a response body.
 */
export type MutationError = Partial<ApiErrorResponse> & {
  response?: { data?: { message?: string } };
};
