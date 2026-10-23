import type { MutationError } from '../types';
import { FileSelect } from './FileSelect';
import { LanguageSelect } from './LanguageSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { normalizeLanguageCode } from '../lib/utils/languages';
import { useState } from 'react';
import { PlexService } from '../lib/services/PlexService';

interface Props {
  type: 'series' | 'movies';
  show: string;
  season: string;
  videoPath: string;
  onVideoPathChange: (path: string) => void;
  sourceLang: string;
  targetLang: string;
  onSourceLangChange: (lang: string) => void;
  onTargetLangChange: (lang: string) => void;
  onTranslationComplete: (path: string) => void;
  onError: (error: Error) => void;
  onClearStatus: () => void;
}

export function VideoExtractor({
  type,
  show,
  season,
  videoPath,
  onVideoPathChange,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  onTranslationComplete,
  onError,
  onClearStatus,
}: Props) {
  const [updatePlex, setUpdatePlex] = useState(true);
  const queryClient = useQueryClient();

  const { data: videos } = useQuery({
    queryKey: ['videos', type, show, season],
    queryFn: () => api.getVideos(show, type === 'series' ? season : null, type),
    enabled: !!show && (type === 'movies' || !!season),
  });

  const { data: isPlexConfigured } = useQuery({
    queryKey: ['plexStatus'],
    queryFn: () => PlexService.isConfigured(),
  });

  const detectLanguageMutation = useMutation({
    mutationFn: async (path: string) => {
      const lang = await api.detectLanguage(show, type === 'series' ? season : null, path, type);
      return normalizeLanguageCode(lang);
    },
    onSuccess: (lang) => {
      if (lang !== 'unknown') {
        onSourceLangChange(lang);
      }
    },
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      onClearStatus();
      
      try {
        // First extract subtitles
        const { path: extractedPath } = await api.extractSubtitles({
          serie: show,
          season: type === 'series' ? season : null,
          video_file: videoPath,
          source_lang: sourceLang,
          type,
        });

        // Get just the filename from the path
        const filename = extractedPath.split('/').pop();

        // Then translate them
        const { path: translatedPath } = await api.translateSubtitle({
          serie: show,
          season: type === 'series' ? season : null,
          srt_path: filename!,
          source_lang: sourceLang,
          target_lang: targetLang,
          type,
        });

        if (updatePlex && await PlexService.isConfigured()) {
          await PlexService.updateLibrary();
        }

        return translatedPath;
      } catch (caught: unknown) {
        const error = caught as MutationError;
        console.log('Extraction error:', error);
        if (error.response) {
          const originalMessage = error.response.data?.message;
          onError(new Error(originalMessage));
        } else if (error instanceof Error) {
          onError(error);
        } else {
          onError(new Error('An unknown error occurred'));
        }
        throw error;
      }
    },
    onSuccess: (path: string) => { // Added type annotation to path
      onTranslationComplete(path);
      // Wait a bit for DeepL API to update usage stats
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['character-count'] });
      }, 2000); // 2-second delay
    },
  });

  const handleVideoChange = (path: string) => {
    onVideoPathChange(path);
    if (path) {
      detectLanguageMutation.mutate(path);
    }
  };

  const videoOptions = videos?.map(video => ({
    name: video.name,
    path: video.path,
  })) ?? [];

  const isLoading = extractMutation.isPending || detectLanguageMutation.isPending;

  return (
    <div className="space-y-6">
      <FileSelect
        id="video"
        label="Select Video File"
        value={videoPath}
        onChange={handleVideoChange}
        options={videoOptions}
      />
      
      <div className="grid gap-4 md:grid-cols-2">
        <LanguageSelect
          id="source-lang"
          label="Source Language"
          value={sourceLang}
          onChange={onSourceLangChange}
        />
        <LanguageSelect
          id="target-lang"
          label="Target Language"
          value={targetLang}
          onChange={onTargetLangChange}
        />
      </div>

      {isPlexConfigured && (
        <div className="flex items-center">
          <input
            type="checkbox"
            id="update-plex"
            checked={updatePlex}
            onChange={(e) => setUpdatePlex(e.target.checked)}
            className="h-4 w-4 rounded-sm border-gray-300"
          />
          <label htmlFor="update-plex" className="ml-2 text-sm text-gray-600">
            Update Plex library after translation
          </label>
        </div>
      )}

      <button
        onClick={() => extractMutation.mutate()}
        disabled={isLoading || !videoPath || !sourceLang || !targetLang}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
      >
        {isLoading ? 'Processing...' : 'Extract & Translate Subtitles'}
      </button>
    </div>
  );
}