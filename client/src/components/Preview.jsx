import { useEffect, useRef, useState } from 'react';
import { Captions, Film, ImageOff, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { formatTime, lookFilter, motionTransform, sceneIndexAt, sceneMotion, sceneTimeline } from '../util.js';

const RESYNC_THRESHOLD_SEC = 0.25;

/**
 * Live preview: shows the current scene's video clip or image (with the same zoom / pan motion as the
 * export) and plays its voiceover, SFX and the background music in sync with a wall-clock playhead.
 */
export default function Preview({
  scenes, starts, total, time, seekToken, setTime, seek, playing, setPlaying, settings, mode, setMode, exportUrl,
}) {
  const voRef = useRef(null);
  const sfxRef = useRef(null);
  // One <audio> per extra sound effect layer of the current scene, by layer id.
  const layerRefs = useRef(new Map());
  const videoRef = useRef(null);
  const musicRef = useRef(null);
  const timeRef = useRef(time);
  const clock = useRef({ origin: 0, base: 0 });
  const [captions, setCaptions] = useState(true);

  timeRef.current = time;
  const idx = sceneIndexAt(starts, scenes, time);
  const scene = scenes[idx];
  const local = scene ? time - starts[idx] : 0;
  const progress = scene ? Math.min(1, local / scene.duration_sec) : 0;

  // Wall-clock driven playhead.
  useEffect(() => {
    if (!playing || mode !== 'live') return;
    if (timeRef.current >= total - 0.05) seek(0);
    clock.current = { origin: performance.now(), base: timeRef.current >= total - 0.05 ? 0 : timeRef.current };
    let raf;
    const tick = () => {
      const t = clock.current.base + (performance.now() - clock.current.origin) / 1000;
      if (t >= total) {
        setTime(total);
        setPlaying(false);
        return;
      }
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode, total, seek, setTime, setPlaying]);

  // External seeks (timeline clicks, scrubber) re-anchor the clock.
  useEffect(() => {
    clock.current = { origin: performance.now(), base: timeRef.current };
  }, [seekToken]);

  // Keep every media element following the playhead. Each one has the position it should be at.
  const lastSeek = useRef(seekToken);
  const musicLen = Number(settings.music_duration_sec) || 0;
  useEffect(() => {
    const forceSeek = lastSeek.current !== seekToken;
    lastSeek.current = seekToken;
    const active = playing && mode === 'live';
    const media = [
      { el: voRef.current, url: scene?.voiceover_url, at: local, volume: 1 },
      { el: sfxRef.current, url: scene?.sfx_url, at: local, volume: Number(settings.sfx_volume) || 0 },
      {
        el: videoRef.current,
        url: scene?.video_url,
        at: (Number(scene?.video_start_sec) || 0) + local,
        volume: scene?.video_has_audio ? Number(scene.video_volume) : 0,
        holdLastFrame: true,
      },
      { el: musicRef.current, url: settings.music_url, at: musicLen ? time % musicLen : time, volume: Number(settings.music_volume) || 0 },
      ...(scene?.sfx_layers || []).map((l) => ({
        el: layerRefs.current.get(l.layer_id),
        url: l.url,
        at: local - (Number(l.start_sec) || 0),
        volume: (Number(settings.sfx_volume) || 0) * (Number.isFinite(Number(l.volume)) ? Number(l.volume) : 1),
      })),
    ];
    for (const { el, url, at, volume, holdLastFrame } of media) {
      if (!el) continue;
      if (!url) {
        if (el.getAttribute('src')) {
          el.pause();
          el.removeAttribute('src');
          el.load();
        }
        continue;
      }
      let reseek = forceSeek;
      if (el.getAttribute('src') !== url) {
        el.src = url;
        reseek = true;
      }
      el.volume = Math.max(0, Math.min(1, volume || 0));
      const ended = Number.isFinite(el.duration) && at >= el.duration;
      // A sound effect layer that starts later in the scene waits at its beginning.
      const early = at < 0;
      // A video that runs out freezes on its last frame, like in the export.
      const target = ended && holdLastFrame ? Math.max(0, el.duration - 0.05) : Math.max(0, at);
      if (!active || ended || early) {
        if (!el.paused) el.pause();
        if ((reseek || early) && (!ended || holdLastFrame) && el.currentTime !== target) el.currentTime = target;
        continue;
      }
      if (reseek || Math.abs(el.currentTime - target) > RESYNC_THRESHOLD_SEC) el.currentTime = target;
      if (el.paused) el.play().catch(() => {});
    }
  }, [scene, local, time, musicLen, playing, mode, seekToken, settings.sfx_volume, settings.music_url, settings.music_volume]);

  // Warm the browser cache so scene changes don't flash.
  useEffect(() => {
    for (const s of scenes) {
      if (s.image_url && !s.video_url) new Image().src = s.image_url;
      for (const shot of s.shots || []) if (shot.image_url) new Image().src = shot.image_url;
    }
  }, [scenes]);

  const ratio = settings.aspect_ratio.replace(':', ' / ');
  const [rw, rh] = settings.aspect_ratio.split(':').map(Number);
  // The picture on screen now: the scene's own, or the extra shot that has cut in, each with its own motion.
  const parts = scene ? sceneTimeline(scene) : [];
  const k = Math.max(0, parts.findLastIndex((p) => p.start <= local));
  const part = parts[k];
  const shot = part?.shot;
  const partProgress = part ? Math.min(1, Math.max(0, (local - part.start) / Math.max(0.01, part.end - part.start))) : progress;
  const transform = scene ? motionTransform(sceneMotion(shot || scene, settings, idx + k), partProgress, settings.motion_amount) : 'none';
  // The export's finishing, approximated: the grade as a CSS filter, the vignette as a gradient, and the
  // scene's on-screen title for its first seconds (as server/finish.js times it).
  const filter = lookFilter(settings.look) || undefined;
  const vignette = Math.min(1, Math.max(0, Number(settings.vignette) || 0));
  const titleShown = scene?.title_text?.trim() && local >= Math.min(0.3, scene.duration_sec / 4) && local < Math.min(scene.duration_sec - 0.2, 3.3);

  const jump = (dir) => {
    const target = dir < 0 && local > 0.75 ? idx : Math.max(0, Math.min(scenes.length - 1, idx + dir));
    if (scenes[target]) seek(starts[target] + 0.001);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-black/40">
      <div className="relative min-h-0 flex-1 p-4" style={{ containerType: 'size' }}>
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md bg-zinc-900 shadow-2xl ring-1 ring-white/10"
            style={{ aspectRatio: ratio, width: `min(100cqw, calc(100cqh * ${rw} / ${rh}))` }}
          >
            {mode === 'rendered' ? (
              exportUrl ? (
                <video key={exportUrl} src={exportUrl} controls autoPlay className="h-full w-full bg-black" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500">
                  <Film className="size-8" />
                  Export the video to watch the final render here.
                </div>
              )
            ) : shot ? (
              <img
                src={shot.image_url}
                alt={shot.image_prompt}
                draggable={false}
                className="h-full w-full object-cover will-change-transform"
                style={{ transform, filter }}
              />
            ) : scene?.video_url ? (
              // src is managed by the sync effect so a new clip always gets seeked to the right spot.
              <video ref={videoRef} playsInline preload="auto" className="h-full w-full bg-black object-cover" style={{ filter }} />
            ) : scene?.image_url ? (
              <img
                src={scene.image_url}
                alt={scene.image_prompt}
                draggable={false}
                className="h-full w-full object-cover will-change-transform"
                style={{ transform, filter }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-900 to-zinc-800 p-8 text-center">
                <ImageOff className="size-8 text-zinc-600" />
                <p className="max-w-md text-sm text-zinc-500">
                  {scene ? scene.image_prompt || 'No image prompt yet' : 'No scenes'}
                </p>
              </div>
            )}

            {mode === 'live' && vignette > 0 && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(ellipse at center, transparent ${70 - 25 * vignette}%, rgba(0,0,0,${(0.35 + 0.5 * vignette).toFixed(2)}) 100%)` }}
              />
            )}
            {mode === 'live' && titleShown && (
              <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-[8%] ${settings.caption_position === 'center' ? 'top-[10%]' : 'top-1/2 -translate-y-1/2'}`}>
                <p className="text-center text-[clamp(16px,6cqmin,72px)] font-extrabold tracking-wider text-white uppercase [text-shadow:0_0_6px_#000,0_2px_2px_#000]">
                  {scene.title_text}
                </p>
              </div>
            )}
            {mode === 'live' && captions && scene?.voiceover_text && (
              <div className="pointer-events-none absolute inset-x-0 bottom-[6%] flex justify-center px-[8%]">
                <p className="rounded bg-black/70 px-3 py-1.5 text-center text-[clamp(11px,1.6cqw,20px)] leading-snug text-white">
                  {scene.voiceover_text}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="absolute top-4 right-4 flex rounded-md bg-zinc-900/90 p-0.5 text-xs ring-1 ring-white/10">
          {[
            ['live', 'Live preview'],
            ['rendered', 'Rendered MP4'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setMode(key);
                setPlaying(false);
              }}
              className={`rounded px-2.5 py-1 font-medium ${mode === key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-zinc-800 bg-zinc-900/60 px-4 py-2">
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" title="Previous scene (←)" onClick={() => jump(-1)} disabled={mode !== 'live'}>
            <SkipBack className="size-4" />
          </button>
          <button
            className="inline-flex size-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-30"
            title="Play / pause (Space)"
            disabled={mode !== 'live' || !scenes.length}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </button>
          <button className="icon-btn" title="Next scene (→)" onClick={() => jump(1)} disabled={mode !== 'live'}>
            <SkipForward className="size-4" />
          </button>
        </div>
        <span className="w-24 text-xs text-zinc-400 tabular-nums">
          {formatTime(time, true)} / {formatTime(total)}
        </span>
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.01}
          value={time}
          disabled={mode !== 'live'}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-rose-500"
          aria-label="Playhead"
        />
        <span className="text-xs text-zinc-500 tabular-nums">
          {scene ? `Scene ${idx + 1}/${scenes.length}` : ''}
        </span>
        <button
          className={`icon-btn ${captions ? 'text-zinc-100' : ''}`}
          title="Toggle voiceover captions (preview only)"
          onClick={() => setCaptions(!captions)}
        >
          <Captions className="size-4" />
        </button>
      </div>

      <audio ref={voRef} preload="auto" />
      <audio ref={sfxRef} preload="auto" />
      {(scene?.sfx_layers || []).map((l) => (
        <audio
          key={l.layer_id}
          ref={(el) => (el ? layerRefs.current.set(l.layer_id, el) : layerRefs.current.delete(l.layer_id))}
          preload="auto"
        />
      ))}
      <audio ref={musicRef} preload="auto" />
    </section>
  );
}
