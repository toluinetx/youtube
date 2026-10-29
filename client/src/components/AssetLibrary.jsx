import { useEffect, useRef, useState } from 'react';
import {
  Camera, ChevronDown, ChevronRight, Film, ImageIcon, Library, Loader2, Music, PanelLeftClose, Pause, Pencil, Play, Plus, Search, Trash2, Upload,
  Volume2,
} from 'lucide-react';
import { ACCEPT, ASSET_MIME, formatTime } from '../util.js';

const GROUPS = [
  { type: 'video', label: 'Videos', icon: Film },
  { type: 'image', label: 'Images', icon: ImageIcon },
  { type: 'audio', label: 'Sounds', icon: Volume2 },
];

const hasFiles = (e) => [...e.dataTransfer.types].includes('Files');

/**
 * Left sidebar holding every uploaded file, grouped by type. Uploading only adds to the library;
 * assets reach the reel when dragged onto the timeline (or via the explicit + / music buttons).
 */
export default function AssetLibrary({
  library, usage, uploading, collapsed, onToggle, onUploadFiles, onDelete, onRename, onSnapshot, onAddAsScene, onSetMusic, onDragAsset, onAssetMenu,
}) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState({});
  const [dropping, setDropping] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const audio = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => () => audio.current?.pause(), []);

  const togglePlay = (asset) => {
    audio.current?.pause();
    if (playingId === asset.asset_id) return setPlayingId(null);
    audio.current = new Audio(asset.url);
    audio.current.onended = () => setPlayingId(null);
    audio.current.play().catch(() => setPlayingId(null));
    setPlayingId(asset.asset_id);
  };

  const dropHandlers = {
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropping(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(false);
      onUploadFiles([...e.dataTransfer.files]);
    },
  };

  const pickFiles = (
    <input
      ref={fileInput}
      type="file"
      multiple
      accept={ACCEPT.all}
      className="hidden"
      onChange={(e) => {
        if (e.target.files.length) onUploadFiles([...e.target.files]);
        e.target.value = '';
      }}
    />
  );

  if (collapsed) {
    return (
      <aside className="relative flex w-11 shrink-0 flex-col items-center gap-2 border-r border-zinc-800 bg-zinc-900/40 py-2" {...dropHandlers}>
        <button className="icon-btn" title="Show library" onClick={onToggle}>
          <Library className="size-4" />
        </button>
        <span className="text-[10px] text-zinc-500 tabular-nums">{library.length}</span>
        {uploading.length > 0 && <Loader2 className="size-4 animate-spin text-zinc-400" />}
        {dropping && <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-indigo-400 bg-indigo-500/15" />}
        {pickFiles}
      </aside>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = [...library].reverse().filter((a) => !q || a.name.toLowerCase().includes(q));

  return (
    <aside className="relative flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40" {...dropHandlers}>
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-zinc-800 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
          <Library className="size-4 text-zinc-400" /> Library
          <span className="text-xs font-normal text-zinc-500">{library.length}</span>
        </h2>
        <div className="flex items-center">
          <button className="btn-secondary px-2 py-1 text-xs" onClick={() => fileInput.current.click()} title="Add files to the library">
            <Upload className="size-3.5" /> Upload
          </button>
          <button className="icon-btn" title="Hide library" onClick={onToggle}>
            <PanelLeftClose className="size-4" />
          </button>
        </div>
      </div>

      {library.length > 6 && (
        <div className="shrink-0 border-b border-zinc-800 px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-zinc-600" />
            <input className="field py-1 pl-7 text-xs" placeholder="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {uploading.length > 0 && (
          <ul className="space-y-1 border-b border-zinc-800 px-3 py-2">
            {uploading.map((u) => (
              <li key={u.id} className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span className="truncate">{u.name}</span>
              </li>
            ))}
          </ul>
        )}

        {library.length === 0 && uploading.length === 0 ? (
          <div className="m-3 rounded-lg border border-dashed border-zinc-700 p-4 text-center text-xs leading-relaxed text-zinc-500">
            <Upload className="mx-auto mb-2 size-5 text-zinc-600" />
            Drop videos, images and sounds here, or click <strong className="text-zinc-300">Upload</strong>.
            <br />
            They stay in the library until you drag them onto the timeline.
          </div>
        ) : (
          GROUPS.map(({ type, label, icon: Icon }) => {
            const items = visible.filter((a) => a.type === type);
            const open = !closed[type];
            return (
              <section key={type} className="border-b border-zinc-800/70">
                <button
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-300 uppercase hover:bg-zinc-800/40"
                  onClick={() => setClosed((c) => ({ ...c, [type]: open }))}
                  aria-expanded={open}
                >
                  {open ? <ChevronDown className="size-3.5 text-zinc-500" /> : <ChevronRight className="size-3.5 text-zinc-500" />}
                  <Icon className="size-3.5 text-zinc-500" /> {label}
                  <span className="ml-auto font-normal text-zinc-500">{items.length}</span>
                </button>
                {open &&
                  (items.length === 0 ? (
                    <p className="px-3 pb-3 text-[11px] text-zinc-600">{q ? 'No matches' : `No ${label.toLowerCase()} yet`}</p>
                  ) : type === 'audio' ? (
                    <ul className="px-1.5 pb-2">
                      {items.map((a) => (
                        <SoundRow
                          key={a.asset_id}
                          asset={a}
                          uses={usage[a.url] || 0}
                          playing={playingId === a.asset_id}
                          onTogglePlay={() => togglePlay(a)}
                          onSetMusic={() => onSetMusic(a)}
                          onRename={() => onRename(a)}
                          onDelete={() => onDelete(a)}
                          onDragAsset={onDragAsset}
                          onMenu={(e) => onAssetMenu(e, a)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                      {items.map((a) => (
                        <Tile
                          key={a.asset_id}
                          asset={a}
                          uses={usage[a.url] || 0}
                          onAdd={() => onAddAsScene(a)}
                          onRename={() => onRename(a)}
                          onSnapshot={() => onSnapshot(a)}
                          onDelete={() => onDelete(a)}
                          onDragAsset={onDragAsset}
                          onMenu={(e) => onAssetMenu(e, a)}
                        />
                      ))}
                    </div>
                  ))}
              </section>
            );
          })
        )}
        {library.length > 0 && (
          <p className="px-3 pt-3 text-[11px] leading-relaxed text-zinc-600">
            Drag items onto the timeline to use them, or onto References to guide image generation.
          </p>
        )}
      </div>

      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-indigo-400 bg-indigo-950/80 text-sm font-medium text-indigo-100">
          <Upload className="size-5" /> Drop to add to the library
        </div>
      )}
      {pickFiles}
    </aside>
  );
}

function dragProps(asset, onDragAsset) {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(ASSET_MIME, asset.asset_id);
      e.dataTransfer.effectAllowed = 'copy';
      onDragAsset(asset);
    },
    onDragEnd: () => onDragAsset(null),
  };
}

function UsageBadge({ uses }) {
  if (!uses) return null;
  return (
    <span className="rounded bg-indigo-500/90 px-1 text-[9px] leading-4 font-semibold text-white" title={`Used in ${uses} place${uses > 1 ? 's' : ''}`}>
      {uses > 1 ? `×${uses}` : 'in use'}
    </span>
  );
}

function Tile({ asset, uses, onAdd, onRename, onSnapshot, onDelete, onDragAsset, onMenu }) {
  return (
    <div className="group cursor-grab active:cursor-grabbing" title={`${asset.name}\nDrag onto the timeline · right-click for more`} onContextMenu={onMenu} {...dragProps(asset, onDragAsset)}>
      <div className="relative aspect-video overflow-hidden rounded-md bg-zinc-800 ring-1 ring-white/5 group-hover:ring-white/25">
        {asset.thumb_url ? (
          <img src={asset.thumb_url} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Film className="size-5 text-zinc-600" />
          </div>
        )}
        <div className="absolute top-1 left-1 flex gap-1">
          <UsageBadge uses={uses} />
        </div>
        {asset.type === 'video' && (
          <span className="absolute right-1 bottom-1 flex items-center gap-0.5 rounded bg-black/70 px-1 text-[9px] leading-4 text-white tabular-nums">
            {asset.has_audio && <Volume2 className="size-2.5" />}
            {formatTime(asset.duration_sec)}
          </span>
        )}
        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <TileButton title="Add to the end of the reel as a new scene" onClick={onAdd}>
            <Plus className="size-3" />
          </TileButton>
          {asset.type === 'video' && (
            <TileButton title="Take a snapshot (save a frame as an image, e.g. for a reference)" onClick={onSnapshot}>
              <Camera className="size-3" />
            </TileButton>
          )}
          <TileButton title="Rename" onClick={onRename}>
            <Pencil className="size-3" />
          </TileButton>
          <TileButton title="Delete from library" onClick={onDelete} danger>
            <Trash2 className="size-3" />
          </TileButton>
        </div>
      </div>
      <p className="mt-1 truncate text-[11px] text-zinc-400">{asset.name}</p>
    </div>
  );
}

function TileButton({ title, onClick, danger, children }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      draggable={false}
      className={`flex size-5 items-center justify-center rounded bg-black/75 text-white ${danger ? 'hover:bg-red-600' : 'hover:bg-indigo-500'}`}
    >
      {children}
    </button>
  );
}

function SoundRow({ asset, uses, playing, onTogglePlay, onSetMusic, onRename, onDelete, onDragAsset, onMenu }) {
  return (
    <li
      className="group flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-zinc-800/60 active:cursor-grabbing"
      title={`${asset.name}\nDrag onto a Voice, SFX or Music track · right-click for more`}
      onContextMenu={onMenu}
      {...dragProps(asset, onDragAsset)}
    >
      <button
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause preview' : 'Play preview'}
        draggable={false}
      >
        {playing ? <Pause className="size-3 fill-current" /> : <Play className="ml-px size-3 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-zinc-200">{asset.name}</p>
        <p className="flex items-center gap-1.5 text-[10px] text-zinc-500 tabular-nums">
          {formatTime(asset.duration_sec)} <UsageBadge uses={uses} />
        </p>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button className="icon-btn size-6" title="Use as background music" onClick={onSetMusic} draggable={false}>
          <Music className="size-3.5" />
        </button>
        <button className="icon-btn size-6" title="Rename" onClick={onRename} draggable={false}>
          <Pencil className="size-3.5" />
        </button>
        <button className="icon-btn size-6 hover:!text-red-400" title="Delete from library" onClick={onDelete} draggable={false}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </li>
  );
}
