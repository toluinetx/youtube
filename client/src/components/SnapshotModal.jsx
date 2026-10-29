import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { formatTime } from '../util.js';

const FRAME = 1 / 30;

/** Pick a frame of a library video; the server saves it as a full-resolution library image. */
export default function SnapshotModal({ asset, purpose, onCancel, onCapture }) {
  const video = useRef(null);
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const step = (dir) => {
    const v = video.current;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir * FRAME));
  };

  const capture = async () => {
    setBusy(true);
    video.current.pause();
    await onCapture(video.current.currentTime);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="flex w-full max-w-3xl flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="snapshot-title">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="min-w-0">
            <h2 id="snapshot-title" className="text-sm font-semibold text-zinc-100">Take a snapshot</h2>
            <p className="truncate text-xs text-zinc-500">
              {asset.name}
              {purpose ? ` · ${purpose}` : ''}
            </p>
          </div>
          <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">
          <video
            ref={video}
            src={asset.url}
            controls
            preload="auto"
            className="aspect-video w-full rounded-md bg-black"
            onLoadedMetadata={(e) => (e.currentTarget.currentTime = Math.min(0.5, e.currentTarget.duration / 2))}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          />
          <p className="mt-2 text-xs text-zinc-500">Pause on the frame you want (use the arrows to step one frame). The snapshot is saved to the library at full resolution.</p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-1">
            <button className="icon-btn" title="Previous frame" onClick={() => step(-1)} disabled={busy}>
              <ChevronLeft className="size-4" />
            </button>
            <span className="w-16 text-center text-xs text-zinc-300 tabular-nums">{formatTime(time, true)}</span>
            <button className="icon-btn" title="Next frame" onClick={() => step(1)} disabled={busy}>
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={capture} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Use this frame
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
