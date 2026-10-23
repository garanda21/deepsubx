import { RotateCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';

export function ApiUsage() {
  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['character-count'],
    queryFn: api.getCharacterCount,
    refetchInterval: false, // Disable auto-refetch
    staleTime: 0, // Prevent automatic background updates
  });

  if (!data) return null;

  const isLLM = data.provider === 'llm';

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-2">
      <div>
        <div className="text-sm font-medium text-slate-400">
          {isLLM ? `LLM · ${data.model ?? 'unknown model'}` : 'API Usage'}
        </div>
        <div className="text-lg font-semibold text-white">
          {isLLM
            ? `${((data.prompt_tokens ?? 0) + (data.completion_tokens ?? 0)).toLocaleString()} tokens`
            : `${data.character_count}/${data.character_limit}`}
        </div>
      </div>
      <button
        onClick={() => refetch()}
        disabled={isRefetching}
        className="rounded-full p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
        title={isLLM ? 'Tokens used since server start' : 'Refresh usage'}
      >
        <RotateCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}