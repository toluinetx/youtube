import { useMemo, useState } from 'react';
import { Box, ChevronDown, ChevronRight, Loader2, MapPin, Plus, RefreshCw, Trash2, User, X } from 'lucide-react';
import { KIND_LABELS, pictureCount } from '../continuity.js';

const KIND_ICONS = { character: User, prop: Box, place: MapPin };
const rid = (prefix) => `${prefix}_${Math.random().toString(16).slice(2, 10)}`;

/** Starting views for a new entry, by kind: what makes a good set of reference images. */
const STARTER_VIEWS = {
  character: [
    { label: 'Turnaround', prompt: 'Character turnaround sheet of NAME: …; the same person four times side by side: front, three-quarter, side profile and back view, full body, standing, neutral pose, plain light grey background, even soft light' },
    { label: 'Face close-up', prompt: 'Close-up portrait of NAME: …; head and shoulders, three-quarter view, neutral expression, plain light grey background, even soft light' },
  ],
  prop: [
    { label: 'Prop sheet', prompt: 'Prop reference sheet of NAME: …; the same object shown four times on a plain light grey background: front view, side view, top view and a close-up of its key detail, even soft light, no hands, no people' },
    { label: 'In use', prompt: 'NAME in use: …; close-up showing how it is held or worn and its size against a hand, plain light grey background, even soft light' },
  ],
  place: [
    { label: 'Main view', prompt: 'Empty establishing shot of NAME: …; wide angle, eye level, no people' },
    { label: 'Reverse view', prompt: 'The same empty place as the reference, now seen from the opposite direction: …; wide angle, eye level, no people' },
    { label: 'Top-down layout', prompt: 'Top-down cutaway view of NAME, roof removed, seen from directly above: …; clean and readable, every seat and fixed object in its place, no people' },
  ],
};

/**
 * The continuity bible: characters, props and places, each with how it looks and where it sits (the
 * same in every picture), its state as the story goes on, and its reference images. Pictures whose
 * prompt names an entry get its facts added (and, if attached, its first reference image).
 */
export default function ContinuityPanel({ continuity = [], scenes, library, busyViews, onChange, onGenerateView }) {
  const [open, setOpen] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const byAsset = useMemo(() => new Map(library.map((a) => [a.asset_id, a])), [library]);
  const sceneOptions = useMemo(
    () => scenes.map((s, i) => ({ id: s.scene_id, label: `${i + 1}${s.title_text ? ` · ${s.title_text}` : ''}` })),
    [scenes],
  );

  const update = (entryId, patch) => onChange(continuity.map((e) => (e.entry_id === entryId ? { ...e, ...patch } : e)));
  const add = (kind) => {
    const entry_id = rid('c');
    const name = `New ${KIND_LABELS[kind].toLowerCase()}`;
    onChange([
      ...continuity,
      {
        entry_id, name, kind, aliases: [], description: '', states: [], attach: kind === 'prop',
        views: STARTER_VIEWS[kind].map((v) => ({ view_id: rid('v'), label: v.label, prompt: v.prompt, asset_id: null, based_on: [] })),
      },
    ]);
    setOpen((o) => new Set(o).add(entry_id));
  };
  const toggle = (id) => setOpen((o) => {
    const next = new Set(o);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const shown = continuity.filter((e) => !filter.trim() || `${e.name} ${(e.aliases || []).join(' ')}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-3 px-3 py-3 text-xs">
      <p className="text-[11px] text-zinc-500">
        How every character, prop and place looks and where it sits. Pictures whose prompt names one get its facts added to the
        prompt and to the image check; props also send their first reference image.
      </p>
      <div className="flex gap-1.5">
        {['character', 'prop', 'place'].map((kind) => {
          const Icon = KIND_ICONS[kind];
          return (
            <button key={kind} className="btn-secondary flex-1 !px-1.5 text-xs" onClick={() => add(kind)}>
              <Plus className="size-3" /> <Icon className="size-3.5" /> {KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>
      {continuity.length > 4 && (
        <input className="field" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
      )}
      {!continuity.length && <p className="py-6 text-center text-zinc-500">Nothing yet. Add the characters, props and places that must stay the same.</p>}

      {shown.map((entry) => {
        const Icon = KIND_ICONS[entry.kind] || Box;
        const isOpen = open.has(entry.entry_id);
        const firstView = entry.views.find((v) => v.asset_id && byAsset.get(v.asset_id));
        return (
          <div key={entry.entry_id} className="rounded-md border border-zinc-800">
            <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => toggle(entry.entry_id)}>
              {isOpen ? <ChevronDown className="size-3.5 text-zinc-500" /> : <ChevronRight className="size-3.5 text-zinc-500" />}
              {firstView ? (
                <img src={byAsset.get(firstView.asset_id).thumb_url || byAsset.get(firstView.asset_id).url} alt="" className="size-7 rounded object-cover ring-1 ring-zinc-700" />
              ) : (
                <Icon className="size-4 text-zinc-400" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-200">{entry.name}</span>
              <span className="text-[10px] text-zinc-500 tabular-nums" title="Pictures whose prompt names it (or that include it)">
                {pictureCount(entry, scenes)} pictures
              </span>
            </button>
            {isOpen && (
              <div className="space-y-2.5 border-t border-zinc-800 px-2.5 py-2.5">
                <div className="flex gap-1.5">
                  <input className="field flex-1" value={entry.name} aria-label="Name" onChange={(e) => update(entry.entry_id, { name: e.target.value })} />
                  <select className="field !w-auto" value={entry.kind} aria-label="Kind" onChange={(e) => update(entry.entry_id, { kind: e.target.value })}>
                    {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <label className="block">
                  <span className="label">Words that mean it in a prompt (comma separated)</span>
                  <input
                    className="field"
                    value={(entry.aliases || []).join(', ')}
                    placeholder="e.g. handcuff, cuffs"
                    onChange={(e) => update(entry.entry_id, { aliases: e.target.value.split(',').map((a) => a.trimStart()) })}
                  />
                </label>
                <label className="block">
                  <span className="label">How it looks and where it is (the same in every picture)</span>
                  <textarea
                    rows={3}
                    className="field resize-y"
                    value={entry.description}
                    placeholder="e.g. Steel police handcuffs with a short chain of three links."
                    onChange={(e) => update(entry.entry_id, { description: e.target.value })}
                  />
                </label>

                <div>
                  <span className="label">As the story goes on (from a scene until the next change)</span>
                  {entry.states.map((st) => (
                    <div key={st.state_id} className="mt-1 flex items-start gap-1.5">
                      <select
                        className="field !w-24 shrink-0"
                        value={st.from_scene_id ?? ''}
                        aria-label="From scene"
                        onChange={(e) => update(entry.entry_id, {
                          states: entry.states.map((x) => (x.state_id === st.state_id ? { ...x, from_scene_id: e.target.value === '' ? null : sceneOptions.find((o) => String(o.id) === e.target.value)?.id ?? null } : x)),
                        })}
                      >
                        <option value="">Start</option>
                        {sceneOptions.map((o) => <option key={o.id} value={o.id}>From {o.label}</option>)}
                      </select>
                      <textarea
                        rows={2}
                        className="field flex-1 resize-y"
                        value={st.text}
                        placeholder="e.g. Locked on her left wrist and the top of the steering wheel rim."
                        onChange={(e) => update(entry.entry_id, { states: entry.states.map((x) => (x.state_id === st.state_id ? { ...x, text: e.target.value } : x)) })}
                      />
                      <button className="icon-btn size-6" title="Remove this state" onClick={() => update(entry.entry_id, { states: entry.states.filter((x) => x.state_id !== st.state_id) })}>
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn-ghost mt-1 w-full text-xs"
                    onClick={() => update(entry.entry_id, { states: [...entry.states, { state_id: rid('t'), from_scene_id: null, text: '' }] })}
                  >
                    <Plus className="size-3" /> Add a change
                  </button>
                </div>

                <div>
                  <span className="label">Reference images</span>
                  {entry.views.map((view) => {
                    const asset = view.asset_id ? byAsset.get(view.asset_id) : null;
                    const busy = busyViews.has(view.view_id);
                    const others = entry.views.filter((v) => v.view_id !== view.view_id);
                    return (
                      <div key={view.view_id} className="mt-1.5 rounded border border-zinc-800 p-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            className="field flex-1 !py-0.5"
                            value={view.label}
                            aria-label="View name"
                            onChange={(e) => update(entry.entry_id, { views: entry.views.map((v) => (v.view_id === view.view_id ? { ...v, label: e.target.value } : v)) })}
                          />
                          <button className="icon-btn size-6" title="Remove this view" onClick={() => update(entry.entry_id, { views: entry.views.filter((v) => v.view_id !== view.view_id) })}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        {asset && (
                          <a href={asset.url} target="_blank" rel="noreferrer" className="mt-1.5 block overflow-hidden rounded ring-1 ring-zinc-800">
                            <img src={asset.thumb_url || asset.url} alt={view.label} className="max-h-36 w-full object-contain" />
                          </a>
                        )}
                        {asset?.image_check?.score != null && (
                          <p className={`mt-1 text-[11px] ${asset.image_check.ok ? 'text-emerald-400' : 'text-amber-300'}`}>
                            Claude scored it {asset.image_check.score}%{asset.image_check.issues?.length ? `: ${asset.image_check.issues.join(' ')}` : ''}
                          </p>
                        )}
                        <textarea
                          rows={3}
                          className="field mt-1.5 resize-y"
                          value={view.prompt}
                          aria-label="View prompt"
                          onChange={(e) => update(entry.entry_id, { views: entry.views.map((v) => (v.view_id === view.view_id ? { ...v, prompt: e.target.value } : v)) })}
                        />
                        {others.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                            Drawn from:
                            {others.map((o) => (
                              <label key={o.view_id} className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  className="accent-amber-400"
                                  checked={view.based_on.includes(o.view_id)}
                                  onChange={(e) => update(entry.entry_id, {
                                    views: entry.views.map((v) => (v.view_id === view.view_id
                                      ? { ...v, based_on: e.target.checked ? [...v.based_on, o.view_id] : v.based_on.filter((x) => x !== o.view_id) }
                                      : v)),
                                  })}
                                />
                                {o.label}
                              </label>
                            ))}
                          </div>
                        )}
                        <button
                          className={`${asset ? 'btn-secondary' : 'btn-primary'} mt-1.5 w-full text-xs`}
                          disabled={busy || !view.prompt.trim()}
                          onClick={() => onGenerateView(entry.entry_id, view.view_id)}
                        >
                          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                          {busy ? 'Generating…' : asset ? 'Regenerate' : 'Generate'}
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="btn-ghost mt-1 w-full text-xs"
                    onClick={() => update(entry.entry_id, { views: [...entry.views, { view_id: rid('v'), label: 'View', prompt: '', asset_id: null, based_on: [] }] })}
                  >
                    <Plus className="size-3" /> Add a view
                  </button>
                </div>

                <label className="flex items-start gap-2 text-zinc-300">
                  <input type="checkbox" className="mt-0.5 accent-amber-400" checked={Boolean(entry.attach)} onChange={(e) => update(entry.entry_id, { attach: e.target.checked })} />
                  <span>
                    Send its first reference image with every picture it's in
                    <span className="block text-[11px] text-zinc-600">
                      Best for props. Characters and places are usually already a scene's references; sending them twice wastes a slot.
                    </span>
                  </span>
                </label>
                <button
                  className="btn-ghost w-full text-xs hover:!text-red-400"
                  onClick={() => window.confirm(`Remove "${entry.name}" from the continuity bible? Its reference images stay in the library.`) &&
                    onChange(continuity.filter((e) => e.entry_id !== entry.entry_id))}
                >
                  <Trash2 className="size-3.5" /> Remove {entry.name}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
