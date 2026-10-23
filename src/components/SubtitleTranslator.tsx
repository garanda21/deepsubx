import type { MutationError } from '../types';
import { FileSelect } from './FileSelect';
import { LanguageSelect } from './LanguageSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { detectLanguageFromFilename } from '../lib/utils/subtitleLanguage';
import { useState } from 'react';
import { PlexService } from '../lib/services/PlexService';

interface Props {
  type: 'series' | 'movies';
  show: string;
  season: string;
  subtitlePath: string;
  onSubtitlePathChange: (path: string) => void;
  sourceLang: string;
  targetLang: string;
  onSourceLangChange: (lang: string) => void;
  onTargetLangChange: (lang: string) => void;
  onError: (error: Error) => void;
  onClearStatus: () => void;
}

export function SubtitleTranslator({
  type,
  show,
  season,
  subtitlePath,
  onSubtitlePathChange,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  onError,
  onClearStatus,
}: Props) {
  const [updatePlex, setUpdatePlex] = useState(true);
  const queryClient = useQueryClient();

  const { data: subtitles } = useQuery({
    queryKey: ['subtitles', type, show, season],
    queryFn: () => api.getSubtitles(show, type === 'series' ? season : null, type),
    enabled: !!show && (type === 'movies' || !!season),
  });

  const { data: isPlexConfigured } = useQuery({
    queryKey: ['plexStatus'],
    queryFn: () => PlexService.isConfigured(),
  });
  const translateMutation = useMutation({
    mutationFn: async () => {
      onClearStatus();
      
      try {
        // The server queues the job; TranslationJobs follows its progress
        return await api.translateSubtitle({
          serie: show,
          season: type === 'series' ? season : null,
          srt_path: subtitlePath,
          source_lang: sourceLang,
          target_lang: targetLang,
          type,
          update_plex: updatePlex && !!isPlexConfigured,
        });
      } catch (caught: unknown) {
        const error = caught as MutationError;
        console.log('Translation error:', error);
        
        // Handle API error responses with enhanced details
        if (error.apiDetails) {
          // This is our enhanced API error format from the interceptor
          const detailedMessage = `Translation failed: ${error.message}` + 
            (error.deeplRequest ? `\nDetails: ${JSON.stringify(error.deeplRequest, null, 2)}` : '');
          
          onError(new Error(detailedMessage));
        } else if (error.response) {
          // Standard axios error
          const originalMessage = error.response.data?.message;
          onError(new Error(originalMessage));
        } else if (error instanceof Error) {
          // Standard JS error
          onError(error);
        } else {
          // Unknown error type
          if (error && error.message) {
            onError(new Error(error.message));
          } else {
            onError(new Error('An unknown error occurred'));
          }
        }
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const handleSubtitleChange = (path: string) => {
    onSubtitlePathChange(path);
    if (path) {
      const detectedLang = detectLanguageFromFilename(path);
      if (detectedLang !== 'unknown') {
        onSourceLangChange(detectedLang);
      }
    }
  };

  const subtitleOptions = subtitles?.map(sub => ({
    name: sub.name,
    path: sub.path,
  })) ?? [];

  const isLoading = translateMutation.isPending;

  return (
    <div className="space-y-6">
      <FileSelect
        id="subtitle"
        label="Select Subtitle File"
        value={subtitlePath}
        onChange={handleSubtitleChange}
        options={subtitleOptions}
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
        onClick={() => translateMutation.mutate()}
        disabled={isLoading || !subtitlePath || !sourceLang || !targetLang}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-blue-300"
      >
        {isLoading ? 'Starting translation...' : 'Translate Subtitle'}
      </button>
    </div>
  );
}