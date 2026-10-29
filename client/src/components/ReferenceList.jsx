import { useRef, useState } from 'react';
import { Film, Library, Search, X } from 'lucide-react';
import { ASSET_MIME } from '../util.js';

const hasType = (e, type) => [...e.dataTransfer.types].includes(type);

/**
 * Reference images for image generation: thumbnails in the order they're sent, a drop zone for
 * library items or files, and a searchable library picker. Videos become a snapshot (the user picks the frame).
 * With `captions` ({ asset_id: text }) and `onCaptionChange(id, text)`, each image gets a caption field;
 * `max` limits how many can be added.
 */
export default function ReferenceList({ ids, library, onChange, onRequestSnapshot, onUploadFiles, emptyHint, captions, onCaptionChange, captionPlaceholder, max }) {
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState(null);
  // Snapshots and uploads finish later; always add to the latest list, not the one from when they started.
  const latest = useRef(ids);
  latest.current = ids;

  const byId = new Map(library.map((a) => [a.asset_id, a]));
  const refs = ids.map((id) => byId.get(id)).filter(Boolean);

  const full = max != null && ids.length >= max;
  const append = (asset) => {
    if (!asset || latest.current.includes(asset.asset_id)) return;
    if (max != null && latest.current.length >= max) return setMessage(`Up to ${max} images.`);
    onChange([...latest.current, asset.asset_id]);
  };

  const addAsset = async (asset) => {
    setMessage(null);
    if (asset.type === 'image') append(asset);
    else if (asset.type === 'video') append(await onRequestSnapshot(asset));
    else setMessage("Sounds can't be used as references.");
  };

  const dropHandlers = {
    onDragOver: (e) => {
      if (!hasType(e, ASSET_MIME) && !hasType(e, 'Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
    },
    onDrop: async (e) => {
      setOver(false);
      if (hasType(e, ASSET_MIME)) {
        e.preventDefault();
        e.stopPropagation();
        const asset = byId.get(e.dataTransfer.getData(ASSET_MIME));
        if (asset) addAsset(asset);
      } else if (hasType(e, 'Files')) {
        e.preventDefault();
        e.stopPropagation();
        // New files go into the library first, then get used here.
        for (const asset of await onUploadFiles([...e.dataTransfer.files])) await addAsset(asset);
      }
    },
  };

  const q = query.trim().toLowerCase();
  // Newest first; images (incl. generated ones) before videos, which need a frame picked.
  const candidates = [...library]
    .reverse()
    .filter((a) => (a.type === 'image' || a.type === 'video') && !ids.includes(a.asset_id) && (!q || a.name.toLowerCase().includes(q)))
    .sort((a, b) => (a.type === 'image' ? 0 : 1) - (b.type === 'image' ? 0 : 1));

  return (
    <div {...dropHandlers}>
      <div
        className={`flex flex-wrap gap-2 rounded-md border border-dashed p-2 transition-colors ${
          over ? 'border-indigo-400 bg-indigo-500/10' : 'border-zinc-700/80'
        }`}
      >
        {captions &&
          refs.map((a, i) => (
            <div key={a.asset_id} className="group flex w-full items-start gap-2">
              <div className="relative w-16 shrink-0" title={a.name}>
                <img src={a.thumb_url || a.url} alt="" draggable={false} className="aspect-square w-16 rounded object-cover ring-1 ring-white/10" />
                <span className="absolute top-0.5 left-0.5 rounded bg-black/75 px-1 text-[9px] leading-4 font-semibold text-white">{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">{a.name.replace(/\.[^.]+$/, '')}</p>
                  <button
                    className="flex size-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-red-600 hover:text-white"
                    onClick={() => onChange(ids.filter((id) => id !== a.asset_id))}
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="field mt-0.5 resize-y text-xs"
                  value={captions[a.asset_id] || ''}
                  placeholder={captionPlaceholder}
                  aria-label={`What to take from ${a.name}`}
                  onChange={(e) => onCaptionChange(a.asset_id, e.target.value)}
                />
              </div>
            </div>
          ))}
        {!captions && refs.map((a, i) => (
          <div key={a.asset_id} className="group relative w-16" title={a.name}>
            <img src={a.thumb_url || a.url} alt="" draggable={false} className="aspect-square w-16 rounded object-cover ring-1 ring-white/10" />
            <span className="absolute top-0.5 left-0.5 rounded bg-black/75 px-1 text-[9px] leading-4 font-semibold text-white">{i + 1}</span>
            <button
              className="absolute top-0.5 right-0.5 hidden size-4 items-center justify-center rounded bg-black/80 text-white group-hover:flex hover:bg-red-600"
              onClick={() => onChange(ids.filter((id) => id !== a.asset_id))}
              aria-label={`Remove reference ${a.name}`}
            >
              <X className="size-3" />
            </button>
            <p className="mt-0.5 truncate text-[10px] text-zinc-400">{a.name.replace(/\.[^.]+$/, '')}</p>
          </div>
        ))}
        {!full && (
          <button
            className={`flex aspect-square w-16 flex-col items-center justify-center gap-0.5 rounded border border-zinc-700 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 ${
              picking ? 'border-indigo-400 text-indigo-200' : ''
            }`}
            onClick={() => setPicking(!picking)}
            aria-expanded={picking}
            title="Choose reference images from the library"
          >
            <Library className="size-4" /> Library
          </button>
        )}
        {refs.length === 0 && !picking && <p className="flex-1 self-center text-[11px] leading-snug text-zinc-600">{emptyHint}</p>}
      </div>

      {picking && !full && (
        <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2">
              <Search className="size-3 shrink-0 text-zinc-500" />
              <input
                autoFocus
                className="w-full bg-transparent py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                placeholder="Search the library…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setPicking(false)}
              />
            </div>
            <button className="text-[11px] text-zinc-400 hover:text-zinc-100" onClick={() => setPicking(false)}>Done</button>
          </div>
          {candidates.length ? (
            <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto">
              {candidates.map((a) => (
                <button
                  key={a.asset_id}
                  className="group relative text-left"
                  title={a.type === 'video' ? `${a.name}: pick a frame` : a.name}
                  // Images are added and the picker stays open to add more; videos open the frame picker.
                  onClick={() => {
                    if (a.type === 'video') setPicking(false);
                    addAsset(a);
                  }}
                >
                  <img src={a.thumb_url || a.url} alt="" className="aspect-square w-full rounded object-cover ring-1 ring-white/10 group-hover:ring-indigo-400" />
                  {a.type === 'video' && <Film className="absolute right-1 bottom-1 size-3 text-white drop-shadow" />}
                  <p className="truncate text-[9px] text-zinc-500">{a.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">
              {q ? 'Nothing in the library matches.' : 'The library has no other images or videos yet. Generated and uploaded images land there.'}
            </p>
          )}
        </div>
      )}
      {message && <p className="mt-1 text-[11px] text-amber-400">{message}</p>}
    </div>
  );
}
