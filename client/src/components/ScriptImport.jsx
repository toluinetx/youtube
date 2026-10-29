import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const PLACEHOLDER = `Below two hundred meters, sunlight disappears. Welcome to the twilight zone.
[image: a submarine descending into dark blue water]
[sfx: deep underwater ambience, muffled bubbles]

Here, nearly ninety percent of creatures make their own light.
[image: glowing jellyfish in pitch black water]`;

export default function ScriptImport({ hasScenes, onClose, onImport }) {
  const [script, setScript] = useState('');
  const [mode, setMode] = useState(hasScenes ? 'append' : 'replace');
  const paragraphs = script.split(/\n\s*\n/).filter((p) => p.trim()).length;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 id="import-title" className="text-sm font-semibold text-zinc-100">Import a script</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-sm text-zinc-400">
            Each paragraph (separated by a blank line) becomes one scene and its text becomes the voiceover. Optionally add{' '}
            <code className="text-image">[image: …]</code> and <code className="text-sfx">[sfx: …]</code> lines. Without an image tag, the narration
            itself is used as the image prompt.
          </p>
          <textarea
            autoFocus
            rows={14}
            className="field font-mono text-xs leading-relaxed"
            placeholder={PLACEHOLDER}
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
          {hasScenes && (
            <div className="flex gap-4 text-sm text-zinc-300">
              {[
                ['append', 'Add after existing scenes'],
                ['replace', 'Replace all scenes (deletes their media)'],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="accent-indigo-500" />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!paragraphs} onClick={() => onImport(script, mode)}>
            Create {paragraphs || ''} scene{paragraphs === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
