import { useEffect, useState } from 'react';
import {
  ArrowLeft, AudioLines, Bell, Check, ChevronLeft, ChevronRight, ClipboardCopy, ImageIcon, MessageSquare, Pencil, Play, RefreshCw, SkipForward, Sparkles, Square, Trash2, X,
} from 'lucide-react';
import { requestId, scenePictures, sceneSounds, spoken } from '../review.js';

/** The count of pictures waiting for a choice; a click goes straight to the first. */
export function ReviewBell({ count, onClick }) {
  const waiting = `${count} image${count === 1 ? '' : 's'} waiting`;
  return (
    <button
      className="icon-btn relative"
      onClick={onClick}
      title={count ? `${waiting} for you to choose` : 'No images waiting'}
      aria-label={count ? `${waiting} for review` : 'No images waiting for review'}
    >
      <Bell className={`size-4 ${count ? 'text-amber-400' : ''}`} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

/** While open, keys belong to this view, not the editor's shortcuts behind it. */
function useOwnKeys(onKey, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const listener = (e) => {
      e.stopPropagation();
      onKey(e);
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [onKey, active]);
}

function Dialog({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-full w-full flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Asks why something should be regenerated. */
function WhyDialog({ title, hint, initial = '', onCancel, onSave }) {
  const [why, setWhy] = useState(initial);
  useOwnKeys((e) => e.key === 'Escape' && onCancel());
  return (
    <Dialog title={title} onClose={onCancel}>
      <div className="p-5">
        <label className="label" htmlFor="review-why">Why?</label>
        <textarea id="review-why" className="field" rows={4} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
        <p className="mt-2 text-xs text-zinc-500">{hint}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave(why.trim())} disabled={!why.trim()}>Add to prompt</button>
      </div>
    </Dialog>
  );
}

/** Everything asked for so far, as one prompt to paste into Claude Code. */
function PromptDialog({ review, onClose }) {
  const [copied, setCopied] = useState(false);
  const { prompt, requests, removeRequest, clear } = review;
  useOwnKeys((e) => e.key === 'Escape' && onClose());

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog title="Prompt for Claude Code" onClose={onClose} wide>
      <div className="min-h-0 overflow-y-auto p-5">
        {!prompt && <p className="text-sm text-zinc-500">Nothing yet. Press Regenerate on a picture, voiceover or sound, or choose a picture from the bell.</p>}
        {requests.length > 0 && (
          <ul className="mb-3 space-y-1">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md bg-zinc-800/60 px-2.5 py-1 text-xs">
                <span className="shrink-0 font-medium text-zinc-200">{r.label}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-400">{r.why}</span>
                <button className="icon-btn size-6" onClick={() => removeRequest(r.id)} aria-label={`Remove ${r.label}`}>
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {prompt && (
          <>
            <label className="label" htmlFor="review-prompt">Paste this into Claude Code</label>
            <textarea id="review-prompt" className="field font-mono" rows={Math.min(14, prompt.split('\n').length + 1)} value={prompt} readOnly onFocus={(e) => e.target.select()} />
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-5 py-3">
        <button className="btn-ghost" onClick={clear} disabled={!prompt} title="Do this once you've pasted it">Clear the list</button>
        <button className="btn-primary" onClick={copy} disabled={!prompt}>
          {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </Dialog>
  );
}

/** One picture full size, with accept and a way back to the grid. */
function Expanded({ tiles, index, onMove, onBack, onAccept }) {
  const tile = tiles[index];
  useOwnKeys((e) => {
    if (e.key === 'Escape') onBack();
    if (e.key === 'ArrowLeft' && index > 0) onMove(index - 1);
    if (e.key === 'ArrowRight' && index < tiles.length - 1) onMove(index + 1);
  });

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-zinc-950" role="dialog" aria-modal="true" aria-label={tile.label}>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <button className="btn-secondary" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back to grid
        </button>
        <span className="text-sm font-medium text-zinc-300 tabular-nums">{tile.label}</span>
        <button className="btn-primary" onClick={() => onAccept(tile)} autoFocus>
          <Check className="size-4" />
          Accept
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-3 p-4">
        <button className="icon-btn shrink-0" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label="Previous picture">
          <ChevronLeft className="size-5" />
        </button>
        <img src={tile.url} alt={tile.label} className="mx-auto max-h-full min-w-0 max-w-full rounded-md object-contain" />
        <button className="icon-btn shrink-0" onClick={() => onMove(index + 1)} disabled={index === tiles.length - 1} aria-label="Next picture">
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}

/** The options for a picture waiting for a choice. */
export function PickOverlay({ item, position, count, narration, decision, onDecide, onClose }) {
  const [open, setOpen] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  useOwnKeys((e) => e.key === 'Escape' && onClose(), open === null && !discarding);

  const tiles = [
    ...(item.current ? [{ id: 'current', url: item.current, label: 'In the film now' }] : []),
    ...item.options.map((url, i) => ({ id: i + 1, url, label: `#${i + 1} of ${item.options.length}` })),
  ];
  const isChosen = (tile) => (tile.id === 'current' ? decision?.type === 'keep' : decision?.type === 'accept' && decision.number === tile.id);
  const accept = (tile) => {
    setOpen(null);
    onDecide(tile.id === 'current' ? { type: 'keep' } : { type: 'accept', number: tile.id });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/95 px-5 py-3 backdrop-blur">
        <button className="btn-secondary" onClick={onClose}>
          <ArrowLeft className="size-4" />
          Back to the scene
        </button>
        <span className="text-xs text-zinc-500 tabular-nums">{position} of {count} waiting</span>
      </header>
      <main className="mx-auto max-w-6xl p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-zinc-100">Picture {item.key}</h2>
          {narration && <p className="mt-1 text-sm text-zinc-300">“{narration}”</p>}
          {item.note && <p className="mt-1 text-sm text-zinc-500">{item.note}</p>}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {tiles.map((tile, i) => (
            <button
              key={tile.id}
              onClick={() => setOpen(i)}
              aria-label={`Expand ${tile.label}`}
              className={`group relative aspect-video overflow-hidden rounded-md bg-zinc-900 outline-none ring-offset-2 ring-offset-zinc-950 focus-visible:ring-2 focus-visible:ring-indigo-400 ${isChosen(tile) ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <img src={tile.url} alt="" loading="lazy" className="size-full object-cover transition-opacity group-hover:opacity-85" />
              <span className="absolute top-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-zinc-100 tabular-nums">
                {tile.id === 'current' ? 'In the film now' : tile.id}
              </span>
              {isChosen(tile) && (
                <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-indigo-500 text-white">
                  <Check className="size-4" />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <button className="btn-secondary" onClick={() => setDiscarding(true)}>
            <RefreshCw className="size-4" />
            Discard all and regenerate
          </button>
        </div>
      </main>
      {open !== null && <Expanded tiles={tiles} index={open} onMove={setOpen} onBack={() => setOpen(null)} onAccept={accept} />}
      {discarding && (
        <WhyDialog
          title={`Discard every option for ${item.key}`}
          hint="Makes 20 new variants, which come back to this bell."
          initial={decision?.type === 'regenerate' ? decision.why : ''}
          onCancel={() => setDiscarding(false)}
          onSave={(why) => {
            setDiscarding(false);
            onDecide({ type: 'regenerate', why });
          }}
        />
      )}
    </div>
  );
}

/** A Regenerate button, or the reason already given. */
function Regenerate({ request, label, onAsk, onRemove }) {
  if (!request) {
    return (
      <button className="btn-secondary px-2 py-1 text-xs" onClick={onAsk} aria-label={`Regenerate ${label}`}>
        <RefreshCw className="size-3" /> Regenerate
      </button>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1 rounded-md bg-indigo-500/10 px-2 py-1 text-xs text-indigo-200">
      <span className="min-w-0 flex-1 break-words">{request.why}</span>
      <button className="icon-btn size-5 shrink-0" onClick={onAsk} aria-label={`Edit the reason for ${label}`}>
        <Pencil className="size-3" />
      </button>
      <button className="icon-btn size-5 shrink-0" onClick={onRemove} aria-label={`Remove ${label} from the prompt`}>
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function Section({ icon: Icon, color, title, children }) {
  return (
    <section className="border-b border-zinc-800 px-4 py-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
        <Icon className={`size-3.5 ${color}`} /> {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** The right sidebar while reviewing: one scene at a time, its open items, and what to regenerate. */
export default function ReviewPanel({ scene, index, count, openSceneIds, playing, review, onGo, onNextOpen, onPlay, onStop, onPick, onBell, onClose }) {
  const [asking, setAsking] = useState(null); // { id, kind, label, why?, part, hint, title }
  const [showPrompt, setShowPrompt] = useState(false);
  if (!scene) return null;

  const number = index + 1;
  const comments = review.review.comments.filter((c) => c.scene_id === scene.scene_id);
  const waiting = review.pending.filter((item) => item.scene_id === scene.scene_id);
  const held = (kind, part) => review.requests.find((r) => r.id === requestId(kind, scene.scene_id, part));
  const items = review.requests.length + Object.keys(review.decisions).length;

  const row = (kind, part, label, title, hint) => ({
    request: held(kind, part),
    label,
    onAsk: () => setAsking({ id: requestId(kind, scene.scene_id, part), kind, label, title, hint }),
    onRemove: () => review.removeRequest(requestId(kind, scene.scene_id, part)),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-3 py-2">
        <h2 className="mr-auto text-sm font-semibold text-zinc-100">Review Wizard</h2>
        <ReviewBell count={review.pending.length} onClick={onBell} />
        <button className="icon-btn" onClick={onClose} aria-label="Close the Review Wizard">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        <button className="icon-btn" onClick={() => onGo(index - 1)} disabled={index === 0} aria-label="Previous scene">
          <ChevronLeft className="size-4" />
        </button>
        <label className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs font-medium text-zinc-300 tabular-nums">
          Scene
          <input
            key={number}
            type="number"
            min={1}
            max={count}
            defaultValue={number}
            aria-label="Go to scene"
            className="field w-16 px-1.5 py-0.5 text-center text-xs"
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            onBlur={(e) => {
              const to = Math.round(Number(e.target.value));
              if (to >= 1 && to <= count && to !== number) onGo(to - 1);
              else e.target.value = number;
            }}
          />
          of {count}
        </label>
        <button className="icon-btn" onClick={() => onGo(index + 1)} disabled={index === count - 1} aria-label="Next scene">
          <ChevronRight className="size-4" />
        </button>
        <button className="btn-primary px-2 py-1 text-xs" onClick={playing ? onStop : onPlay}>
          {playing ? <Square className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}
          {playing ? 'Stop' : 'Play scene'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {comments.length > 0 && (
          <Section icon={MessageSquare} color="text-amber-400" title="Claude's comments">
            {comments.map((c) => (
              <p key={c.text} className="rounded-md bg-amber-400/10 px-2.5 py-1.5 text-xs leading-relaxed text-amber-100">{c.text}</p>
            ))}
          </Section>
        )}

        <Section icon={ImageIcon} color="text-image" title="Images">
          {scenePictures(scene, number).map((p) => {
            const item = waiting.find((x) => x.key === p.key);
            return (
              <div key={p.key} className="flex items-center gap-2">
                <div className="aspect-video w-20 shrink-0 overflow-hidden rounded bg-zinc-800">
                  {p.url && <img src={p.url} alt={`Picture ${p.key}`} className="size-full object-cover" />}
                </div>
                <span className="w-10 shrink-0 text-xs font-medium text-zinc-300 tabular-nums">{p.key}</span>
                {item ? (
                  <button className="btn-primary px-2 py-1 text-xs" onClick={() => onPick(item.key)}>Choose</button>
                ) : (
                  <Regenerate {...row('image', p.shot_id, `Image ${p.key}`, `Regenerate image ${p.key}`, 'Makes 20 variants. The bell tells you when they are ready to choose from.')} />
                )}
              </div>
            );
          })}
        </Section>

        <Section icon={AudioLines} color="text-voice" title="Voiceover">
          {scene.voiceover_text?.trim() ? (
            <>
              <p className="text-xs leading-relaxed text-zinc-300">{spoken(scene.voiceover_text)}</p>
              {scene.voiceover_url && <audio controls src={scene.voiceover_url} className="h-8 w-full" aria-label="Voiceover" />}
              <div className="flex">
                <Regenerate {...row('voiceover', null, `Voiceover, scene ${number}`, `Regenerate the voiceover of scene ${number}`, 'Regenerates once. Say what should sound different, or give new words.')} />
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-500">No voiceover in this scene.</p>
          )}
        </Section>

        <Section icon={Sparkles} color="text-sfx" title="Sound effects">
          {sceneSounds(scene).map((s, i) => (
            <div key={s.layer_id ?? 'main'} className="space-y-1">
              <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{s.prompt}</p>
              {s.url && <audio controls src={s.url} className="h-8 w-full" aria-label={`Sound ${i + 1}`} />}
              <div className="flex">
                <Regenerate {...row('sfx', s.layer_id ?? 'main', `Sound ${i + 1}, scene ${number}`, `Regenerate sound ${i + 1} of scene ${number}`, 'Regenerates once. Say what should sound different.')} />
              </div>
            </div>
          ))}
          {sceneSounds(scene).length === 0 && <p className="text-xs text-zinc-500">No sound effects in this scene.</p>}
        </Section>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 p-2">
        <button className="btn-secondary flex-1 px-2 text-xs" onClick={onNextOpen} disabled={!openSceneIds.length}>
          <SkipForward className="size-3.5" /> Next open item ({openSceneIds.length})
        </button>
        <button className="btn-primary flex-1 px-2 text-xs" onClick={() => setShowPrompt(true)}>
          <ClipboardCopy className="size-3.5" /> Prompt ({items})
        </button>
      </div>

      {asking && (
        <WhyDialog
          title={asking.title}
          hint={asking.hint}
          initial={review.requests.find((r) => r.id === asking.id)?.why}
          onCancel={() => setAsking(null)}
          onSave={(why) => {
            review.addRequest({ id: asking.id, kind: asking.kind, scene_id: scene.scene_id, label: asking.label, why });
            setAsking(null);
          }}
        />
      )}
      {showPrompt && <PromptDialog review={review} onClose={() => setShowPrompt(false)} />}
    </div>
  );
}
