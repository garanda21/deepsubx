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
  onTranslationComplete: (path: string) => void;
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
  onTranslationComplete,
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
        const { path } = await api.translateSubtitle({
          serie: show,
          season: type === 'series' ? season : null,
          srt_path: subtitlePath,
          source_lang: sourceLang,
          target_lang: targetLang,
          type,
        });

        if (updatePlex && await PlexService.isConfigured()) {
          await PlexService.updateLibrary();
        }

        return path;
      } catch (error) {
        console.log('Translation error:', error);
        if (error.response) {
          const originalMessage = error.response.data.message;
          onError(new Error(originalMessage));
        } else if (error instanceof Error) {
          onError(error);
        } else {
          onError(new Error('An unknown error occurred'));
        }
        throw error;
      }
    },
    onSuccess: (path: string) => {
      onTranslationComplete(path);
      // Wait a bit for DeepL API to update usage stats
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['character-count'] });
      }, 2000); // 2-second delay
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
            className="h-4 w-4 rounded border-gray-300"
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
        {isLoading ? 'Translating...' : 'Translate Subtitle'}
      </button>
    </div>
  );
}