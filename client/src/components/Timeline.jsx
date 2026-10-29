import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Film, ImageIcon, Loader2, Music, Plus, Sparkles, Upload, Volume2, ZoomIn, ZoomOut } from 'lucide-react';
import { ASSET_MIME, assetFits, formatTime } from '../util.js';

const MIN_PPS = 10;
const MAX_PPS = 200;
const LABEL_W = 88;
// How far (px) a clip must be dragged before it starts moving rather than just being selected.
const REORDER_THRESHOLD = 5;
// Auto-scroll while dragging a clip near the timeline's left/right edge.
const EDGE_PX = 48;
const EDGE_SPEED = 14;

const TRACKS = [
  { kind: 'image', label: 'Image', icon: ImageIcon, height: 'h-16', color: 'text-image' },
  { kind: 'voiceover', label: 'Voice', icon: AudioLines, height: 'h-10', color: 'text-voice' },
  { kind: 'sfx', label: 'SFX', icon: Sparkles, height: 'h-10', color: 'text-sfx' },
];
const MUSIC_TRACK = { kind: 'music', label: 'Music', icon: Music, height: 'h-8', color: 'text-fuchsia-400' };

/** Which slot a file is being dragged over: a clip ({ sceneId, track }), the music row, or empty space (null). */
function dropTargetOf(el) {
  const hit = el?.closest?.('[data-drop-track]');
  if (!hit) return null;
  const sceneId = hit.dataset.dropScene;
  return { track: hit.dataset.dropTrack, sceneId: sceneId == null ? null : Number(sceneId) };
}

const sameTarget = (a, b) => a?.track === b?.track && a?.sceneId === b?.sceneId;
const hasFiles = (e) => [...e.dataTransfer.types].includes('Files');
const hasAsset = (e) => [...e.dataTransfer.types].includes(ASSET_MIME);

/**
 * The scene order after moving `ids` (kept in timeline order) to before scene `index` of the current
 * order, or null if nothing would change.
 */
function reorderedIds(scenes, ids, index) {
  const current = scenes.map((s) => s.scene_id);
  const group = current.filter((id) => ids.includes(id));
  const rest = current.filter((id) => !ids.includes(id));
  const at = current.slice(0, index).filter((id) => !ids.includes(id)).length;
  const order = [...rest.slice(0, at), ...group, ...rest.slice(at)];
  return order.every((id, i) => id === current[i]) ? null : order;
}

function tickStep(pps) {
  if (pps >= 80) return 1;
  if (pps >= 35) return 2;
  if (pps >= 15) return 5;
  return 10;
}

export default function Timeline({
  scenes, starts, total, time, playing, seek, selectedIds, onSelect, onResize, onAdd, onDropFiles, onDropAsset, dragAsset, settings,
  onSelectMusic, onClipMenu, onMusicMenu, onReorder, busy,
}) {
  const [pps, setPps] = useState(40);
  // While something is dragged over the timeline: { source: 'files' | 'asset', target, index, valid }.
  // target is the clip / music row under the pointer, or null for empty space (index = where a new scene would go).
  const [drag, setDrag] = useState(null);
  const scrollRef = useRef(null);
  const scrubbing = useRef(false);
  // While clips are dragged to a new position: { ids, index } (index = insert before this scene).
  const [moving, setMoving] = useState(null);
  const selectedSet = new Set(selectedIds);

  /** Where a new scene dropped at time t would be inserted: before the first scene whose middle is after t. */
  const insertIndexAt = (t) => scenes.filter((sc, i) => starts[i] + sc.duration_sec / 2 < t).length;

  // Latest values for the window listeners of a clip drag, which outlive a render.
  const latest = useRef({});
  latest.current = { scenes, insertIndexAt, onReorder, onSelect, pps, selectedIds };

  /** Drag the scenes `ids` to a new position; calls `onClick` instead if the pointer never moved far enough. */
  const grabClip = useCallback((e, ids, onClick) => {
    const el = scrollRef.current;
    const x0 = e.clientX;
    let state = null;
    let lastX = x0;
    const indexAt = (clientX) => {
      const rect = el.getBoundingClientRect();
      return latest.current.insertIndexAt((clientX - rect.left + el.scrollLeft) / latest.current.pps);
    };
    const update = (clientX) => {
      const index = indexAt(clientX);
      if (index !== state.index) setMoving((state = { ...state, index }));
    };
    const onMove = (ev) => {
      lastX = ev.clientX;
      if (!state) {
        if (Math.abs(ev.clientX - x0) < REORDER_THRESHOLD) return;
        if (latest.current.scenes.length < 2) return stop();
        state = { ids, index: null };
        document.body.style.cursor = 'grabbing';
      }
      update(ev.clientX);
    };
    // Keep scrolling while the pointer rests near an edge.
    const tick = setInterval(() => {
      if (!state) return;
      const rect = el.getBoundingClientRect();
      const dx = lastX < rect.left + EDGE_PX ? -EDGE_SPEED : lastX > rect.right - EDGE_PX ? EDGE_SPEED : 0;
      if (dx) {
        el.scrollLeft += dx;
        update(lastX);
      }
    }, 16);
    const stop = () => {
      clearInterval(tick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
      setMoving(null);
    };
    const onUp = () => {
      const done = state;
      stop();
      if (!done) return onClick();
      const order = done.index == null ? null : reorderedIds(latest.current.scenes, done.ids, done.index);
      if (order) latest.current.onReorder(order);
    };
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      stop();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKey, true);
  }, []);

  /**
   * Pointer pressed on a clip. Shift / ⌘ / Ctrl change the selection. Otherwise the scene (or the whole
   * selection, if the clip is part of it) can be dragged to a new position once the pointer moves past
   * the threshold; a press inside a selection that isn't dragged selects just that scene.
   */
  const pressClip = useCallback((e, sceneId) => {
    if (e.button !== 0) return;
    const { onSelect, selectedIds } = latest.current;
    const range = e.shiftKey;
    const toggle = e.ctrlKey || e.metaKey;
    if (range || toggle) return onSelect(sceneId, { range, toggle });
    const group = selectedIds.length > 1 && selectedIds.includes(sceneId) ? selectedIds : [sceneId];
    if (group.length === 1) onSelect(sceneId, {});
    grabClip(e, group, () => group.length > 1 && onSelect(sceneId, {}));
  }, [grabClip]);

  const dragHandlers = {
    onDragOver: (e) => {
      const source = hasAsset(e) ? 'asset' : hasFiles(e) ? 'files' : null;
      if (!source) return;
      const target = dropTargetOf(e.target);
      const index = target ? null : insertIndexAt(timeFromEvent(e));
      const valid = source === 'files' || !dragAsset || assetFits(dragAsset, target ? target.track : 'image');
      e.preventDefault();
      e.dataTransfer.dropEffect = valid ? 'copy' : 'none';
      if (!drag || drag.source !== source || !sameTarget(drag.target, target) || drag.index !== index || drag.valid !== valid) {
        setDrag({ source, target, index, valid });
      }
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDrag(null);
    },
    onDrop: (e) => {
      const target = dropTargetOf(e.target);
      setDrag(null);
      if (hasAsset(e)) {
        e.preventDefault();
        onDropAsset(e.dataTransfer.getData(ASSET_MIME), target, insertIndexAt(timeFromEvent(e)));
      } else if (hasFiles(e)) {
        e.preventDefault();
        onDropFiles([...e.dataTransfer.files], target);
      }
    },
  };
  const dropStateFor = (sceneId, track) => (sameTarget(drag?.target, { sceneId, track }) ? (drag.valid ? 'ok' : 'bad') : null);
  const movable = moving?.index != null && reorderedIds(scenes, moving.ids, moving.index);
  const moveX = movable ? (moving.index < scenes.length ? starts[moving.index] : total) * pps : null;
  const movingLabel =
    moving?.ids.length > 1 ? `Move ${moving.ids.length} scenes here` : `Move scene ${scenes.findIndex((s) => s.scene_id === moving?.ids[0]) + 1} here`;
  const insertX = drag?.source === 'asset' && !drag.target && drag.valid ? (drag.index < scenes.length ? starts[drag.index] : total) * pps : null;

  const width = Math.max(total * pps + 160, 400);
  const step = tickStep(pps);
  const ticks = [];
  for (let t = 0; t <= total + step; t += step) ticks.push(t);

  // Keep the playhead on screen while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!playing || !el) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - el.clientWidth * 0.2;
  }, [time, pps, playing]);

  const timeFromEvent = (e) => {
    const rect = scrollRef.current.getBoundingClientRect();
    return (e.clientX - rect.left + scrollRef.current.scrollLeft) / pps;
  };

  const rulerHandlers = {
    onPointerDown: (e) => {
      scrubbing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seek(timeFromEvent(e));
    },
    onPointerMove: (e) => scrubbing.current && seek(timeFromEvent(e)),
    onPointerUp: () => (scrubbing.current = false),
  };

  const zoom = (factor) => setPps((p) => Math.round(Math.max(MIN_PPS, Math.min(MAX_PPS, p * factor))));
  const fit = () => {
    const w = scrollRef.current?.clientWidth || 800;
    setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, Math.floor((w - 60) / Math.max(total, 1)))));
  };

  return (
    <section className="relative shrink-0 border-t border-zinc-800 bg-zinc-900/70 select-none" {...dragHandlers}>
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="font-medium text-zinc-300">Timeline</span>
          <span>
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {formatTime(total, true)}
          </span>
          <span className="hidden text-zinc-600 xl:inline">· drag a scene to reorder it, its edge to resize</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2 py-1 text-xs" onClick={onAdd}>
            <Plus className="size-3.5" /> Scene
          </button>
          <div className="mx-1 h-4 w-px bg-zinc-800" />
          <button className="icon-btn size-7" title="Zoom out" onClick={() => zoom(1 / 1.4)}>
            <ZoomOut className="size-4" />
          </button>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={fit}>Fit</button>
          <button className="icon-btn size-7" title="Zoom in" onClick={() => zoom(1.4)}>
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex">
        <div className="shrink-0 border-r border-zinc-800" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-zinc-800" />
          {[...TRACKS, MUSIC_TRACK].map((t) => (
            <div key={t.kind} className={`${t.height} flex items-center gap-1.5 border-b border-zinc-800/60 px-3 text-xs text-zinc-400`}>
              <t.icon className={`size-3.5 ${t.color}`} /> {t.label}
            </div>
          ))}
        </div>

        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative min-w-full" style={{ width }}>
            <div className="relative h-6 cursor-col-resize border-b border-zinc-800" {...rulerHandlers}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-zinc-700/70 pl-1 text-[10px] leading-6 text-zinc-500 tabular-nums" style={{ left: t * pps }}>
                  {formatTime(t)}
                </div>
              ))}
            </div>

            {TRACKS.map((track) => (
              <div key={track.kind} className={`relative ${track.height} border-b border-zinc-800/60`} onPointerDown={(e) => e.target === e.currentTarget && seek(timeFromEvent(e))}>
                {scenes.map((scene, i) => (
                  <Clip
                    key={scene.scene_id}
                    track={track.kind}
                    scene={scene}
                    index={i}
                    left={starts[i] * pps}
                    pps={pps}
                    selected={selectedSet.has(scene.scene_id)}
                    busy={Boolean(busy[`${scene.scene_id}:${track.kind}`])}
                    dropping={dropStateFor(scene.scene_id, track.kind)}
                    moving={Boolean(moving?.ids.includes(scene.scene_id))}
                    onPress={pressClip}
                    onResize={onResize}
                    onMenu={onClipMenu}
                  />
                ))}
              </div>
            ))}

            <MusicRow
              settings={settings}
              total={total}
              pps={pps}
              busy={Boolean(busy.music)}
              dropping={dropStateFor(null, 'music')}
              onSelect={onSelectMusic}
              onMenu={onMusicMenu}
            />

            {moveX != null && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-indigo-400" style={{ left: moveX }}>
                {/* At the very end the label goes left of the line so it isn't cut off. */}
                <span
                  className={`absolute top-0.5 ${moving.index < scenes.length ? 'left-1.5' : 'right-1.5'} rounded bg-indigo-500 px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-white`}
                >
                  {movingLabel}
                </span>
              </div>
            )}

            {insertX != null && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-indigo-400" style={{ left: insertX }}>
                <span className="absolute top-0.5 left-1.5 rounded bg-indigo-500 px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-white">
                  New scene
                </span>
              </div>
            )}

            <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-rose-500" style={{ left: time * pps }}>
              <div className="absolute -top-px -left-[5px] size-[11px] rotate-45 rounded-[2px] bg-rose-500" />
            </div>
          </div>
        </div>
      </div>

      {drag?.source === 'files' && !drag.target && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-indigo-400 bg-indigo-950/70 text-sm font-medium text-indigo-100">
          <Upload className="mr-2 size-4" /> Drop to add to the library (drop onto a clip to use it there)
        </div>
      )}
      {drag?.source === 'asset' && !drag.target && !drag.valid && (
        <div className="pointer-events-none absolute right-3 bottom-2 z-20 rounded bg-red-950 px-2 py-1 text-xs text-red-200 ring-1 ring-red-500/40">
          Sounds go on the Voice, SFX or Music track
        </div>
      )}
    </section>
  );
}

function MusicRow({ settings, total, pps, busy, dropping, onSelect, onMenu }) {
  const width = Math.max(total * pps, 160);
  const loopLen = settings.music_duration_sec;
  const loops = [];
  if (settings.music_url && loopLen > 0) for (let t = loopLen; t < total; t += loopLen) loops.push(t);
  const ring = dropping === 'ok' ? 'ring-2 ring-fuchsia-300' : dropping === 'bad' ? 'ring-2 ring-red-500' : 'ring-1 ring-white/5 hover:ring-white/20';

  return (
    <div className="relative h-8 border-b border-zinc-800/60">
      <div
        data-drop-track="music"
        className={`absolute top-1 bottom-1 left-px cursor-pointer overflow-hidden rounded-md ${ring} ${
          settings.music_url ? 'border-l-2 border-fuchsia-400 bg-fuchsia-400/20' : 'border border-dashed border-zinc-700/80'
        }`}
        style={{ width: width - 2 }}
        onPointerDown={onSelect}
        onContextMenu={onMenu}
        title={settings.music_url ? `${settings.music_name}: click for music settings` : 'Drop an audio file here for background music'}
      >
        {loops.map((t) => (
          <div key={t} className="absolute inset-y-0 border-l border-dashed border-fuchsia-300/50" style={{ left: t * pps }} title="Music loops here" />
        ))}
        <div className={`relative truncate px-1.5 text-[10px] leading-6 ${settings.music_url ? 'text-zinc-200' : 'text-zinc-600'}`}>
          {settings.music_url ? `${settings.music_name} · ${Math.round(settings.music_volume * 100)}%` : 'Drop background music here'}
        </div>
        {busy && <BusyOverlay />}
      </div>
    </div>
  );
}

const Clip = memo(function Clip({ track, scene, index, left, pps, selected, busy, dropping, moving, onPress, onResize, onMenu }) {
  const width = scene.duration_sec * pps;
  const ring = dropping
    ? dropping === 'ok'
      ? 'ring-2 ring-white z-[2]'
      : 'ring-2 ring-red-500 z-[2]'
    : selected
      ? 'ring-2 ring-indigo-400 z-[1]'
      : 'ring-1 ring-white/5 hover:ring-white/20';
  const drop = { 'data-drop-track': track, 'data-drop-scene': scene.scene_id };
  const names = scene.source_names || {};
  const base = `absolute top-1 bottom-1 overflow-hidden rounded-md cursor-grab active:cursor-grabbing ${ring} ${moving ? 'opacity-40' : ''}`;
  const style = { left: left + 1, width: Math.max(2, width - 2) };
  const select = (e) => onPress(e, scene.scene_id);
  const menu = (e) => onMenu(e, scene.scene_id, track);

  if (track === 'image') {
    const thumb = scene.video_thumb_url || scene.image_url;
    return (
      <div className={`${base} bg-zinc-800`} style={style} onPointerDown={select} onContextMenu={menu} title={names.image || scene.image_prompt} {...drop}>
        {thumb ? (
          <div className="absolute inset-0 bg-left" style={{ backgroundImage: `url("${thumb}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />
        ) : (
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(255_255_255/0.03)_6px_12px)]" />
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-3 pb-0.5 text-[10px] text-white">
          <span className="flex items-center gap-1 font-semibold">
            #{index + 1}
            {scene.video_url && <Film className="size-3 text-sky-300" aria-label="Video clip" />}
            {scene.video_url && scene.video_has_audio && scene.video_volume > 0 && <Volume2 className="size-3 text-sky-300" aria-label="Clip has sound" />}
          </span>
          {width > 60 && <span className="text-white/70 tabular-nums">{scene.duration_sec.toFixed(1)}s</span>}
        </div>
        {busy && <BusyOverlay />}
        <ResizeHandle scene={scene} pps={pps} onResize={onResize} />
      </div>
    );
  }

  const isVoice = track === 'voiceover';
  const url = isVoice ? scene.voiceover_url : scene.sfx_url;
  const text = isVoice ? scene.voiceover_text : scene.sfx_prompt;
  const sourceName = names[track];
  const audioLen = isVoice ? scene.voiceover_duration_sec : scene.sfx_duration_sec;
  const color = isVoice ? 'bg-voice/25 border-voice' : 'bg-sfx/25 border-sfx';
  const filled = audioLen ? Math.min(1, audioLen / scene.duration_sec) : 1;
  const overflow = isVoice && audioLen > scene.duration_sec;

  return (
    <div className={`${base} ${url ? '' : 'border border-dashed border-zinc-700/80'}`} style={style} onPointerDown={select} onContextMenu={menu} title={sourceName || text} {...drop}>
      {url && (
        <div className={`absolute inset-y-0 left-0 border-l-2 ${color}`} style={{ width: `${filled * 100}%` }}>
          <Wave />
        </div>
      )}
      {overflow && <div className="absolute inset-y-0 right-0 w-1.5 bg-red-500" title="Voiceover is longer than the scene and will be cut off" />}
      <div className={`relative truncate px-1.5 text-[10px] leading-8 ${url ? 'text-zinc-200' : 'text-zinc-600'}`}>
        {url ? sourceName || text : text?.trim() ? 'not generated' : ''}
      </div>
      {busy && <BusyOverlay />}
    </div>
  );
});

function Wave() {
  return (
    <div className="absolute inset-0 opacity-40 bg-[repeating-linear-gradient(90deg,currentColor_0_1px,transparent_1px_4px)] [mask-image:linear-gradient(to_bottom,transparent_20%,black_35%,black_65%,transparent_80%)] text-white" />
  );
}

function BusyOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
      <Loader2 className="size-4 animate-spin text-white" />
    </div>
  );
}

function ResizeHandle({ scene, pps, onResize }) {
  const drag = useRef(null);
  return (
    <div
      className="absolute inset-y-0 right-0 z-[2] w-2 cursor-ew-resize hover:bg-white/40"
      title="Drag to change duration"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, d: scene.duration_sec };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const d = Math.round((drag.current.d + (e.clientX - drag.current.x) / pps) * 10) / 10;
        const clamped = Math.max(0.5, Math.min(600, d));
        if (clamped !== scene.duration_sec) onResize(scene.scene_id, clamped);
      }}
      onPointerUp={() => (drag.current = null)}
    />
  );
}
