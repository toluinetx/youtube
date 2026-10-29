import { useState } from 'react';
import { ChevronDown, Clapperboard, Download, FileText, Loader2, Redo2, Sparkles, TriangleAlert, Undo2, X } from 'lucide-react';
import { UsageButton } from './Usage.jsx';

export default function TopBar({
  title, status, job, missing, videos, exportUrl, onImport, onGenerateMissing, onExport, onDismissJob, history, undoShortcut, redoShortcut, onUndo, onRedo,
  onOpenProjects,
}) {
  const running = job?.status === 'running';
  const [showWarnings, setShowWarnings] = useState(false);

  return (
    <header className="relative shrink-0 border-b border-zinc-800 bg-zinc-900/80">
      <div className="flex h-12 items-center gap-4 px-4">
        <button
          className="-mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-800"
          onClick={onOpenProjects}
          title="Switch project or start a new one"
        >
          <Clapperboard className="size-5 shrink-0 text-rose-500" />
          <h1 className="truncate text-sm font-semibold text-zinc-100">{title || 'Untitled video'}</h1>
          <ChevronDown className="size-4 shrink-0 text-zinc-500" />
        </button>

        {status && (
          <div className="hidden items-center gap-3 text-[11px] text-zinc-500 md:flex">
            <KeyStatus ok={status.replicate} label="Replicate" />
            <KeyStatus ok={status.elevenlabs} label="ElevenLabs" />
            <KeyStatus ok={status.gemini} label="Gemini" />
            <KeyStatus ok={status.ffmpeg} label="FFmpeg" />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center">
            <button
              className="icon-btn"
              onClick={onUndo}
              disabled={!history.undo}
              title={history.undo ? `Undo ${history.undo} (${undoShortcut})` : 'Nothing to undo'}
              aria-label="Undo"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              className="icon-btn"
              onClick={onRedo}
              disabled={!history.redo}
              title={history.redo ? `Redo ${history.redo} (${redoShortcut})` : 'Nothing to redo'}
              aria-label="Redo"
            >
              <Redo2 className="size-4" />
            </button>
          </div>
          <button className="btn-ghost" onClick={onImport} disabled={running}>
            <FileText className="size-4" /> Import script
          </button>
          <button
            className="btn-secondary"
            onClick={onGenerateMissing}
            disabled={running || (missing === 0 && !videos)}
            title={
              missing || videos
                ? `Review and generate the ${missing} asset(s) that have a prompt but no file yet${videos ? `, plus ${videos} suggested video clip(s)` : ''}`
                : 'Every prompt already has generated media'
            }
          >
            <Sparkles className="size-4" /> Generate missing{missing ? ` (${missing})` : ''}
          </button>
          {exportUrl && (
            <a className="btn-secondary" href={exportUrl} download="final_output.mp4" title="Download final_output.mp4">
              <Download className="size-4" />
            </a>
          )}
          <button className="btn-primary" onClick={onExport} disabled={running}>
            {running && job.kind === 'export' ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
            Export video
          </button>
          <UsageButton />
        </div>
      </div>

      {job && job.status !== 'idle' && (
        <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-1.5 text-xs">
          <span className={job.status === 'error' ? 'text-red-400' : job.status === 'done' ? 'text-emerald-400' : 'text-zinc-300'}>
            {job.kind === 'export' ? 'Export' : 'Generate'}:{' '}
            {job.status === 'error' ? job.error : job.status === 'done' ? 'finished' : job.message}
          </span>
          {running && (
            <div className="h-1.5 max-w-sm flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-300" style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          )}
          {running && <span className="text-zinc-500 tabular-nums">{Math.round(job.progress * 100)}%</span>}
          {job.warnings?.length > 0 && (
            <button className="flex items-center gap-1 text-amber-400 hover:underline" onClick={() => setShowWarnings(!showWarnings)}>
              <TriangleAlert className="size-3.5" /> {job.warnings.length} warning{job.warnings.length > 1 ? 's' : ''}
            </button>
          )}
          {!running && (
            <button className="icon-btn ml-auto size-6" title="Dismiss" onClick={onDismissJob}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {showWarnings && job?.warnings?.length > 0 && (
        <ul className="absolute top-full right-4 z-40 mt-1 max-w-md space-y-1 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-xs text-amber-300 shadow-2xl">
          {job.warnings.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}
    </header>
  );
}

function KeyStatus({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5" title={ok ? `${label} is configured` : `${label} is not configured. See .env.example`}>
      <span className={`size-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {label}
    </span>
  );
}
