import { useState } from 'react';
import { Header } from './components/Header';
import { MediaTypeSelector } from './components/MediaTypeSelector';
import { ModeSelector } from './components/ModeSelector';
import { ShowSelector } from './components/ShowSelector';
import { SubtitleTranslator } from './components/SubtitleTranslator';
import { VideoExtractor } from './components/VideoExtractor';
import { TranslationStatus } from './components/TranslationStatus';
import { TranslationJobs } from './components/TranslationJobs';

export function App() {
  const [mediaType, setMediaType] = useState<'series' | 'movies'>('series');
  const [show, setShow] = useState('');
  const [season, setSeason] = useState('');
  const [mode, setMode] = useState<'subtitle' | 'extract'>('subtitle');
  const [sourceLang, setSourceLang] = useState('');
  const [targetLang, setTargetLang] = useState('');
  const [subtitlePath, setSubtitlePath] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [error, setError] = useState<Error | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <Header />
          
          <div className="space-y-8 rounded-xl bg-white p-8 shadow-xl">
            <MediaTypeSelector type={mediaType} onTypeChange={(type) => {
                setMediaType(type);
                // Reset all states to initial values
                setShow('');
                setSeason('');
                setSourceLang('');
                setTargetLang('');
                setSubtitlePath('');
                setVideoPath('');
                setError(null);
              }}  />
            <ModeSelector mode={mode} onModeChange={setMode} />
            
            <ShowSelector
              type={mediaType}
              show={show}
              season={season}
              onShowChange={(value) => {
                setShow(value);
                setSeason('');
              }}
              onSeasonChange={setSeason}
            />

            {mode === 'subtitle' ? (
              <SubtitleTranslator
                type={mediaType}
                show={show}
                season={season}
                subtitlePath={subtitlePath}
                onSubtitlePathChange={setSubtitlePath}
                sourceLang={sourceLang}
                targetLang={targetLang}
                onSourceLangChange={setSourceLang}
                onTargetLangChange={setTargetLang}
                onError={setError}
                onClearStatus={() => {
                  setError(null);
                  }}
              />
            ) : (
              <VideoExtractor
                type={mediaType}
                show={show}
                season={season}
                videoPath={videoPath}
                onVideoPathChange={setVideoPath}
                sourceLang={sourceLang}
                targetLang={targetLang}
                onSourceLangChange={setSourceLang}
                onTargetLangChange={setTargetLang}
                onError={setError}
                onClearStatus={() => {
                  setError(null);
                  }}
              />
            )}

            <TranslationStatus
              isSuccess={false}
              isError={!!error}
              error={error}
            />

            <TranslationJobs />
          </div>
        </div>
      </div>
    </div>
  );
}