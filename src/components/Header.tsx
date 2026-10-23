import { ApiUsage } from './ApiUsage';

const REPO_URL = 'https://github.com/garanda21/deepsubx';
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'local';
const APP_COMMIT = import.meta.env.VITE_APP_COMMIT?.slice(0, 7);

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Header() {
  return (
    <div className="mb-12 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold text-white">DeepSubX</h1>
        <p className="mt-2 text-slate-400">Translate subtitles with ease</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
          <span title={APP_COMMIT ? `Commit ${APP_COMMIT}` : undefined}>
            {APP_VERSION}
            {APP_COMMIT && <span className="font-mono"> · {APP_COMMIT}</span>}
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 transition-colors hover:text-slate-300"
          >
            <GitHubIcon className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </div>
      <ApiUsage />
    </div>
  );
}
