import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import * as api from '../lib/api';
import type { TranslationJob } from '../types';

const POLL_INTERVAL_MS = 2000;

const isActive = (job: TranslationJob) => job.status === 'queued' || job.status === 'running';

function JobProgress({ job }: { job: TranslationJob }) {
  const { done, total } = job.progress;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-blue-700">
        {job.status === 'queued'
          ? 'Waiting in queue...'
          : total > 0
            ? `Batch ${done} of ${total} (${percent}%)`
            : 'Starting...'}
      </div>
    </div>
  );
}

function JobItem({ job }: { job: TranslationJob }) {
  const label = `${job.title} · ${job.file} (${job.sourceLang} → ${job.targetLang})`;

  if (isActive(job)) {
    const Icon = job.status === 'queued' ? Clock : Loader2;
    return (
      <div className="rounded-lg bg-blue-50 p-4 flex items-start gap-3">
        <Icon className={`h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5 ${job.status === 'running' ? 'animate-spin' : ''}`} />
        <div className="w-full min-w-0">
          <div className="font-medium text-blue-800">Translating</div>
          <div className="mt-1 truncate text-sm text-blue-700" title={label}>{label}</div>
          <JobProgress job={job} />
        </div>
      </div>
    );
  }

  if (job.status === 'done') {
    return (
      <div className="rounded-lg bg-green-50 p-4 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium text-green-800">Translation Complete!</div>
          <div className="mt-1 break-all text-sm text-green-600">File saved at: {job.path}</div>
          {job.plex === 'updated' && <div className="mt-1 text-xs text-green-700">Plex library updated</div>}
          {job.plex === 'failed' && <div className="mt-1 text-xs text-amber-700">{job.plexError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-red-50 p-4 flex items-start gap-3">
      <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="w-full min-w-0">
        <div className="font-medium text-red-800">Translation Failed</div>
        <div className="mt-1 truncate text-sm text-red-700" title={label}>{label}</div>
        <div className="mt-1 text-sm text-red-600">{job.error?.message}</div>
        {!!job.error?.apiDetails && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-red-700">Technical details</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-sm bg-red-100 p-2 text-xs text-red-800">
              {JSON.stringify(job.error.apiDetails, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * Lists translation jobs kept by the server, so progress survives page reloads.
 * Polls only while a job is queued or running.
 */
export function TranslationJobs() {
  const queryClient = useQueryClient();
  const { data: jobs } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.getJobs,
    refetchInterval: (query) => (query.state.data?.some(isActive) ? POLL_INTERVAL_MS : false),
  });

  // Refresh API usage whenever a job finishes
  const activeCount = jobs?.filter(isActive).length ?? 0;
  const previousActive = useRef(activeCount);
  useEffect(() => {
    if (activeCount < previousActive.current) {
      queryClient.invalidateQueries({ queryKey: ['character-count'] });
    }
    previousActive.current = activeCount;
  }, [activeCount, queryClient]);

  if (!jobs?.length) return null;

  return (
    <div className="space-y-3">
      {jobs.slice(0, 5).map(job => <JobItem key={job.id} job={job} />)}
    </div>
  );
}
