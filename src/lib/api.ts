import axios, { AxiosResponse, AxiosError } from 'axios';
import type { CharacterCount, Show, Movie, SubtitleFile, VideoFile, ApiErrorResponse, TranslationJob } from '../types';

const api = axios.create({
  baseURL: '/api',
});

// Add response interceptor to standardize error handling
api.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => response,
  (error: AxiosError<Partial<ApiErrorResponse>>): Promise<never> => {
    // Create a standardized error object
    const enhancedError: ApiErrorResponse = {
      message: error.response?.data?.message || error.message || 'Unknown error occurred',
      status: error.response?.status || 500,
      originalError: error.response?.data?.originalError || error.toString(),
      apiDetails: error.response?.data?.apiDetails || null,
      deeplRequest: error.response?.data?.deeplRequest || null,
      isLargeFile: error.response?.data?.isLargeFile || false,
      // Include the original axios error object for access to all details
      axiosError: error
    };
    
    // Add more descriptive messages for common status codes
    if (error.response?.status === 500 && !error.response.data?.message) {
      enhancedError.message = 'Internal server error. The server encountered an error processing your request.';
    } else if (error.response?.status === 429) {
      enhancedError.message = 'Too many requests. Please try again later.';
    } else if (error.response?.status === 403) {
      enhancedError.message = 'Authentication failed. Please check your API keys.';
    }
    
    // Reject with the enhanced error
    return Promise.reject(enhancedError);
  }
);

export const getShows = async (): Promise<Show[]> => {
  const { data } = await api.get<string[]>('/list_shows');
  return data.map(name => ({ name, seasons: [] }));
};

export const getSeasons = async (show: string): Promise<string[]> => {
  const { data } = await api.get<string[]>(`/list_seasons?show=${encodeURIComponent(show)}`);
  return data;
};

export const getMovies = async (): Promise<Movie[]> => {
  const { data } = await api.get<string[]>('/list_movies');
  return data.map(name => ({ name }));
};

export const getSubtitles = async (show: string, season: string | null, type: 'series' | 'movies'): Promise<SubtitleFile[]> => {
  const params = new URLSearchParams({ show, type });
  if (season) params.append('season', season);
  
  const { data } = await api.get<string[]>(`/list_subtitles?${params}`);
  return data.map(name => ({ name, path: name }));
};

export const getVideos = async (show: string, season: string | null, type: 'series' | 'movies'): Promise<VideoFile[]> => {
  const params = new URLSearchParams({ show, type });
  if (season) params.append('season', season);
  
  const { data } = await api.get<string[]>(`/list_video_files?${params}`);
  return data.map(name => ({ name, path: name }));
};

export const getCharacterCount = async (): Promise<CharacterCount> => {
  const { data } = await api.get<CharacterCount>('/get_character_count');
  return data;
};

export const detectLanguage = async (show: string, season: string | null, file: string, type: 'series' | 'movies'): Promise<string> => {
  const params = new URLSearchParams({ show, file, type });
  if (season) params.append('season', season);
  
  const { data } = await api.get<{ language: string }>(`/detect-language?${params}`);
  return data.language;
};

export const extractSubtitles = async (params: {
  serie: string;
  season?: string | null;
  video_file: string;
  source_lang: string;
  type: 'series' | 'movies';
}): Promise<{ path: string }> => {
  try {
    const { data } = await api.post('/extract_subtitles', params);
    return data;
  } catch (error) {
    console.error('Subtitle extraction error:', error);
    // Re-throw the error for handling in the UI components
    throw error;
  }
};

/**
 * Queues a translation on the server and returns the job right away.
 * Progress is followed with getJobs().
 */
export const translateSubtitle = async (params: {
  serie: string;
  season?: string | null;
  srt_path: string;
  source_lang: string;
  target_lang: string;
  type: 'series' | 'movies';
  update_plex: boolean;
}): Promise<TranslationJob> => {
  const { data } = await api.post<TranslationJob>('/translate_subtitle', params);
  return data;
};

/** Requeues a failed job; batches finished before the failure are kept. */
export const retryJob = async (id: string): Promise<TranslationJob> => {
  const { data } = await api.post<TranslationJob>(`/jobs/${id}/retry`);
  return data;
};

export const getJobs = async (): Promise<TranslationJob[]> => {
  const { data } = await api.get<TranslationJob[]>('/jobs');
  return data;
};

export async function isPlexConfigured(): Promise<boolean> {
  const response = await fetch('/api/plex/status');
  const data = await response.json();
  return data.configured;
}

export async function updatePlexLibrary(): Promise<void> {
  const response = await fetch('/api/plex/update-library', {
    method: 'POST',
  });
  
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to update Plex library');
  }
}