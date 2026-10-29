import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Film, Image, Loader2, Mic, Sparkles, X } from 'lucide-react';
import { api } from '../api.js';
import { ImageModelControl, SfxModelControl, VideoModelControl, VoiceControl, VoiceModelControl } from './ModelControls.jsx';

const KINDS = [
  { kind: 'image', label: 'Images', icon: Image, color: 'text-sky-400' },
  { kind: 'voiceover', label: 'Voice', icon: Mic, color: 'text-emerald-400' },
  { kind: 'sfx', label: 'Sound', icon: AudioLines, color: 'text-amber-400' },
  { kind: 'video', label: 'Video clips', icon: Film, color: 'text-fuchsia-400' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

const usd = (n) => (n < 0.995 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const modelName = (id) => id?.replace(/^gemini:/, '').split('/').pop();

/**
 * Asks before "Generate missing": lists everything it would make, with each item's model and estimated
 * cost, to tick or untick (video clips start unticked), and the models and voice to make them with.
 * Model changes are project settings, saved as usual; nothing is generated until Generate.
 */
export default function GenerateDialog({ settings, onChangeSettings, status, onCancel, onGenerate }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set());

  // Re-price whenever a setting changes (debounced while typing the style).
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .generationPlan(settings)
        .then((p) => {
          setPlan(p);
          setError(null);
          // New items start ticked unless optional; choices already made are kept.
          setPicked((prev) => {
            const next = new Set([...prev].filter((id) => p.items.some((i) => i.id === id)));
            for (const i of p.items) {
              if (!seen.current.has(i.id) && !i.optional) next.add(i.id);
              seen.current.add(i.id);
            }
            return next;
          });
        })
        .catch((err) => setError(err.message));
    }, 300);
    return () => clearTimeout(t);
  }, [settings]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const items = plan?.items || [];
  const scenes = useMemo(() => {
    const byScene = new Map();
    for (const i of items) byScene.set(i.scene, [...(byScene.get(i.scene) || []), i]);
    return [...byScene.entries()];
  }, [items]);

  const chosen = items.filter((i) => picked.has(i.id));
  const total = chosen.reduce((t, i) => t + (i.usd || 0), 0);
  const credits = chosen.reduce((t, i) => t + (i.credits || 0), 0);
  const unpriced = [...new Set(chosen.filter((i) => i.usd == null).map((i) => i.model))];

  const toggle = (ids, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });

  const generate = async () => {
    setBusy(true);
    try {
      await onGenerate(chosen.map((i) => i.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="flex max-h-full w-full max-w-6xl flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div>
            <h2 id="generate-title" className="text-sm font-semibold text-zinc-100">Generate missing</h2>
            <p className="text-xs text-zinc-500">Choose what to make and which models to use. Nothing is generated until you click Generate.</p>
          </div>
          <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-r border-zinc-800 p-4">
            <Section title="Images">
              <ImageModelControl settings={settings} onChange={onChangeSettings} label="Model (no references)" />
              <ImageModelControl settings={settings} onChange={onChangeSettings} refs label="Model (with references)" />
              <div>
                <span className="label">Style (appended to every image prompt)</span>
                <textarea
                  rows={3}
                  className="field resize-y"
                  value={settings.style_prompt}
                  onChange={(e) => onChangeSettings({ style_prompt: e.target.value })}
                />
              </div>
            </Section>
            <Section title="Voice">
              <VoiceModelControl settings={settings} onChange={onChangeSettings} />
              <VoiceControl settings={settings} onChange={onChangeSettings} />
            </Section>
            <Section title="Sound effects">
              <SfxModelControl settings={settings} onChange={onChangeSettings} label="Model" />
            </Section>
            <Section title="Video clips">
              <VideoModelControl settings={settings} onChange={onChangeSettings} label="Model" />
              {status && !status.gemini && <p className="text-[11px] text-amber-400">Add GEMINI_API_KEY to .env to make video clips.</p>}
            </Section>
            <p className="text-[11px] text-zinc-600">These are the project's settings: changes here are saved and apply to every scene.</p>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap gap-2 border-b border-zinc-800 px-4 py-3">
              {KINDS.map(({ kind, label, icon: Icon, color }) => {
                const ofKind = items.filter((i) => i.kind === kind);
                if (!ofKind.length) return null;
                const on = ofKind.filter((i) => picked.has(i.id));
                return (
                  <label key={kind} className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={on.length === ofKind.length}
                      ref={(el) => el && (el.indeterminate = on.length > 0 && on.length < ofKind.length)}
                      onChange={(e) => toggle(ofKind.map((i) => i.id), e.target.checked)}
                    />
                    <Icon className={`size-3.5 ${color}`} />
                    {label}
                    <span className="text-zinc-500 tabular-nums" title="Ticked / all, and what all of them would cost">
                      {on.length}/{ofKind.length} · {usd(ofKind.reduce((t, i) => t + (i.usd || 0), 0))}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
              {error && <p className="py-6 text-center text-sm text-red-400">Couldn't load the plan: {error}</p>}
              {!plan && !error && (
                <p className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" /> Working out what's missing…
                </p>
              )}
              {plan && !items.length && <p className="py-6 text-center text-sm text-zinc-500">Everything with a prompt already has generated media.</p>}
              {scenes.map(([n, sceneItems]) => {
                const on = sceneItems.filter((i) => picked.has(i.id));
                return (
                  <section key={n} className="border-b border-zinc-800/60 py-2 last:border-0">
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-xs font-semibold text-zinc-300">
                      <input
                        type="checkbox"
                        className="accent-indigo-500"
                        checked={on.length === sceneItems.length}
                        ref={(el) => el && (el.indeterminate = on.length > 0 && on.length < sceneItems.length)}
                        onChange={(e) => toggle(sceneItems.map((i) => i.id), e.target.checked)}
                      />
                      Scene {n}
                    </label>
                    <ul>
                      {sceneItems.map((i) => {
                        const { icon: Icon, color } = KIND[i.kind];
                        return (
                          <li key={i.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 pl-5 text-xs hover:bg-zinc-800/60">
                              <input type="checkbox" className="accent-indigo-500" checked={picked.has(i.id)} onChange={(e) => toggle([i.id], e.target.checked)} />
                              <Icon className={`size-3.5 shrink-0 ${color}`} />
                              <span className="w-32 shrink-0 text-zinc-300">
                                {i.label}
                                {i.optional && <span className="ml-1 text-[10px] text-fuchsia-400">suggested</span>}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-zinc-500" title={i.prompt}>{i.prompt}</span>
                              <span className="w-36 shrink-0 truncate text-right text-[11px] text-zinc-600" title={i.model}>
                                {modelName(i.model)}
                                {i.kind === 'video' && ` · ~${i.sec}s`}
                              </span>
                              <span className="w-14 shrink-0 text-right text-zinc-400 tabular-nums">{i.usd == null ? 'no price' : usd(i.usd)}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-zinc-800 px-5 py-3">
          <p className="text-xs text-zinc-400">
            <span className="font-semibold text-zinc-200">{chosen.length}</span> of {items.length} item{items.length === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-zinc-200">
              {usd(total)}
              {unpriced.length ? '+' : ''}
            </span>{' '}
            estimated{credits > 0 && ` · ${Math.round(credits).toLocaleString()} ElevenLabs credits`}
            {unpriced.length > 0 && (
              <span className="block text-amber-400">No price for {unpriced.map(modelName).join(', ')}. Set one in the Usage panel.</span>
            )}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={generate} disabled={busy || !chosen.length}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate {chosen.length || ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">{title}</h3>
      {children}
    </section>
  );
}
