import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { FONT_FILE } from './finish.js';

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path;

/**
 * How far camera moves go: a zoom changes the size by `amount` (0.12 = 12%) over the shot, and a pan
 * is zoomed in by a quarter more than that so there's room to slide. Keep in sync with client/src/util.js.
 */
export const moveZooms = (amount = 0.12) => ({ zoom: amount, pan: Math.max(0.03, amount * 1.25) });

/** zoompan expressions for a motion (see MOTIONS in storyboard.js), or null for a still image. */
function zoompan(motion, frames, amount) {
  const t = `on/${frames}`;
  const { zoom, pan: panZoom } = moveZooms(amount);
  const center = { x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };
  const pan = { z: String(1 + panZoom), ...center };
  switch (motion) {
    case 'zoom_in': return { z: `1+${zoom}*${t}`, ...center };
    case 'zoom_out': return { z: `${1 + zoom}-${zoom}*${t}`, ...center };
    case 'pan_right': return { ...pan, x: `(iw-iw/zoom)*${t}` };
    case 'pan_left': return { ...pan, x: `(iw-iw/zoom)*(1-${t})` };
    case 'pan_down': return { ...pan, y: `(ih-ih/zoom)*${t}` };
    case 'pan_up': return { ...pan, y: `(ih-ih/zoom)*(1-${t})` };
    default: return null;
  }
}

function run(bin, args, { onStderr, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      onStderr?.(String(d));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stdout);
      const tail = stderr.trim().split('\n').slice(-8).join('\n');
      reject(new Error(`${bin.split(/[\\/]/).pop()} exited with code ${code}\n${tail}`));
    });
  });
}

export async function probeDuration(file) {
  return (await probe(file)).duration;
}

/** Duration plus which stream types a file contains. Images report hasVideo with no meaningful duration. */
export async function probe(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]);
  const data = JSON.parse(out);
  const types = new Set((data.streams || []).map((st) => st.codec_type));
  const d = parseFloat(data.format?.duration);
  return {
    duration: Number.isFinite(d) ? Math.round(d * 100) / 100 : null,
    hasVideo: types.has('video'),
    hasAudio: types.has('audio'),
  };
}

/** Grab a small JPEG frame from a video for timeline thumbnails. */
export async function extractThumbnail(videoPath, outPath, atSec = 0) {
  await run(FFMPEG, ['-y', '-hide_banner', '-v', 'error', '-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outPath]);
}

/** Save one full-resolution frame of a video (snapshots used as reference images). */
export async function extractFrame(videoPath, outPath, atSec = 0) {
  await run(FFMPEG, ['-y', '-hide_banner', '-v', 'error', '-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath]);
  await fs.access(outPath).catch(() => {
    throw Object.assign(new Error(`No frame at ${atSec}s`), { status: 400 });
  });
}

/**
 * An image (or, with `atSec`, that frame of a video) as a JPEG data URI no larger than 1024px on its
 * longest side, for sending to Replicate as a reference (data URIs are recommended only under 1MB).
 */
export async function referenceDataUri(imagePath, atSec) {
  const tmp = path.join(os.tmpdir(), `ref-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await run(FFMPEG, [
      '-y', '-hide_banner', '-v', 'error', ...(atSec != null ? ['-ss', String(atSec)] : []), '-i', imagePath, '-frames:v', '1',
      '-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease,format=yuvj420p",
      '-q:v', '3', tmp,
    ]);
    return `data:image/jpeg;base64,${(await fs.readFile(tmp)).toString('base64')}`;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Join audio files one after another into an mp3 at `outPath`, with `gapSec` of silence between them. */
export async function joinAudio(paths, gapSec, outPath) {
  const chains = paths.map((_, i) => `[${i}:a]${AFORMAT}${i < paths.length - 1 && gapSec > 0 ? `,apad=pad_dur=${gapSec}` : ''}[p${i}]`);
  const filter = `${chains.join(';')};${paths.map((_, i) => `[p${i}]`).join('')}concat=n=${paths.length}:v=0:a=1[a]`;
  await run(FFMPEG, [
    '-y', '-hide_banner', '-v', 'error', ...paths.flatMap((p) => ['-i', p]),
    '-filter_complex', filter, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '128k', outPath,
  ]);
}

function parseTime(line) {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const AFORMAT = 'aformat=sample_rates=44100:channel_layouts=stereo';

/**
 * Render one scene to an mp4, padded/trimmed to exactly `duration` seconds. The visual is a video clip
 * (starting at `videoStart`, last frame held if it runs short), a still image (optionally with a slow
 * zoom or pan, see `motion`) or black. `shots` are more images that take over at their `start`
 * (seconds), each with its own `motion`; each lasts until the next. The clip's own audio (only while
 * it's on screen), voiceover and SFX are mixed together. Every clip uses identical codec settings so
 * they concat losslessly. `moveAmount` is how far zooms and pans go (see moveZooms); `finish` is a
 * filter chain from finishFilters() (grade, shake…) and `captions` an ASS file's text (captionsAss()),
 * both applied over the whole scene.
 */
export async function renderSceneClip({
  videoPath, videoStart = 0, videoAudio = false, videoVolume = 1, imagePath, voPath, sfxPath,
  duration, width, height, fps, motion, moveAmount, shots = [], sfxVolume, sfxLayers = [], finish = '', captions = null, outPath, onProgress,
}) {
  const args = ['-y', '-hide_banner'];
  const frames = Math.max(1, Math.round(duration * fps));
  const cover = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

  // The pictures in order, cut on whole frames so the parts add up to exactly `frames`.
  const later = shots.filter((s) => s.start > 0 && s.start < duration).sort((a, b) => a.start - b.start);
  const pictures = [{ videoPath, imagePath, motion, start: 0 }, ...later.map((s) => ({ imagePath: s.imagePath, motion: s.motion, start: s.start }))];
  const bounds = [...pictures.map((p) => Math.round(p.start * fps)), frames];
  const segments = pictures
    .map((p, k) => ({ ...p, frames: bounds[k + 1] - bounds[k] }))
    .filter((p) => p.frames > 0);

  const filters = segments.map((seg, k) => {
    const d = seg.frames / fps;
    const end = `trim=end_frame=${seg.frames},setpts=PTS-STARTPTS[v${k}]`;
    if (seg.videoPath) {
      args.push('-ss', String(videoStart), '-i', seg.videoPath);
      return `[${k}:v]${cover},fps=${fps},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${d},${end}`;
    }
    if (seg.imagePath) {
      args.push('-loop', '1', '-framerate', String(fps), '-t', String(d), '-i', seg.imagePath);
      const move = zoompan(seg.motion, seg.frames, moveAmount);
      // Upscale first so zoompan's integer cropping doesn't jitter.
      return move
        ? `[${k}:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
            `zoompan=z='${move.z}':x='${move.x}':y='${move.y}':d=1:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p,${end}`
        : `[${k}:v]${cover},fps=${fps},setsar=1,format=yuv420p,${end}`;
    }
    args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${d}`);
    return `[${k}:v]setsar=1,format=yuv420p,${end}`;
  });
  // Captions are an ASS file read from a temporary folder (with the font), which ffmpeg runs in, so
  // the filter only names relative paths: absolute ones would need escaping per platform.
  const post = [finish, captions && 'ass=captions.ass:fontsdir=.'].filter(Boolean).join(',');
  const out = post ? '[vbase]' : '[v]';
  let video =
    segments.length > 1
      ? `${filters.join(';')};${segments.map((_, k) => `[v${k}]`).join('')}concat=n=${segments.length}:v=1:a=0${out}`
      : filters[0].replace(/\[v0\]$/, out);
  if (post) video += `;[vbase]${post},format=yuv420p[v]`;

  const audio = [];
  let next = segments.length;
  // A video's own sound plays only while it's on screen.
  if (videoPath && videoAudio && videoVolume > 0) audio.push(`[0:a]${AFORMAT},volume=${videoVolume},atrim=0:${segments[0].frames / fps}`);
  if (voPath) {
    args.push('-i', voPath);
    audio.push(`[${next++}:a]${AFORMAT}`);
  }
  if (sfxPath) {
    args.push('-i', sfxPath);
    const fadeStart = Math.max(0, duration - 0.4);
    audio.push(`[${next++}:a]${AFORMAT},volume=${sfxVolume},afade=t=out:st=${fadeStart}:d=0.4`);
  }
  // Extra sound effect layers, each delayed to its start and faded out with the scene.
  for (const layer of sfxLayers) {
    if (layer.start >= duration) continue;
    args.push('-i', layer.path);
    const ms = Math.round(layer.start * 1000);
    const fadeStart = Math.max(0, duration - 0.4);
    audio.push(`[${next++}:a]${AFORMAT},volume=${sfxVolume * layer.volume}${ms ? `,adelay=${ms}:all=1` : ''},afade=t=out:st=${fadeStart}:d=0.4`);
  }
  if (!audio.length) {
    args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo');
    audio.push(`[${next++}:a]${AFORMAT}`);
  }

  const parts = [video, ...audio.map((a, i) => `${a}[a${i}]`)];
  const labels = audio.map((_, i) => `[a${i}]`).join('');
  const mixed = audio.length > 1 ? `${labels}amix=inputs=${audio.length}:duration=longest:normalize=0` : `${labels}anull`;
  parts.push(`${mixed},apad,atrim=0:${duration}[a]`);

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
    '-t', String(duration),
    '-movflags', '+faststart',
    outPath,
  );

  const cwd = captions ? await fs.mkdtemp(path.join(os.tmpdir(), 'captions-')) : undefined;
  try {
    if (cwd) {
      await fs.writeFile(path.join(cwd, 'captions.ass'), captions);
      await fs.copyFile(FONT_FILE, path.join(cwd, path.basename(FONT_FILE)));
    }
    await run(FFMPEG, args, {
      cwd,
      onStderr: (line) => {
        const t = parseTime(line);
        if (t != null) onProgress?.(Math.min(1, t / duration));
      },
    });
  } finally {
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
  }
}

/** How long one ambience bed takes to fade into the next (they overlap by this much). */
const AMBIENCE_CROSSFADE_SEC = 1.5;

/**
 * Join clips that share codec settings. Video is stream-copied; audio is re-encoded to avoid gaps at the seams.
 * With `music` ({ path, totalSec, volume, ducking }), a looped background track is mixed underneath (faded
 * in/out, optionally ducked under speech). Each of `beds` ({ path, start, end, volume }, in seconds) is an
 * ambience loop played from `start` to `end`; beds that meet overlap so one crossfades into the next.
 */
export async function concatClips(clipPaths, outPath, listPath, { music = null, beds = [] } = {}) {
  const list = clipPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list + '\n');
  const args = ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', listPath];
  const filters = [];
  const layers = [];
  let next = 1;
  let main = '[0:a]';
  if (music) {
    const total = music.totalSec;
    const fadeOut = Math.min(2, total / 4);
    args.push('-stream_loop', '-1', '-i', music.path);
    const bed = `[${next++}:a]${AFORMAT},atrim=0:${total},volume=${music.volume},afade=t=in:d=${Math.min(1, total / 4)},afade=t=out:st=${total - fadeOut}:d=${fadeOut}`;
    if (music.ducking) {
      filters.push(`[0:a]${AFORMAT},asplit=2[main][key]`, `${bed}[bed]`, '[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck]');
      main = '[main]';
      layers.push('[duck]');
    } else {
      filters.push(`${bed}[bed]`);
      layers.push('[bed]');
    }
  }
  for (const [k, b] of beds.entries()) {
    const start = Math.max(0, b.start - (b.start > 0 ? AMBIENCE_CROSSFADE_SEC / 2 : 0));
    const end = b.end + (b.atEnd ? 0 : AMBIENCE_CROSSFADE_SEC / 2);
    const len = end - start;
    if (len <= 0.1) continue;
    const fadeIn = Math.min(start > 0 ? AMBIENCE_CROSSFADE_SEC : 0.5, len / 3);
    const fadeOut = Math.min(b.atEnd ? 2 : AMBIENCE_CROSSFADE_SEC, len / 3);
    const ms = Math.round(start * 1000);
    args.push('-stream_loop', '-1', '-i', b.path);
    filters.push(
      `[${next++}:a]${AFORMAT},atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,volume=${b.volume},` +
        `afade=t=in:d=${fadeIn.toFixed(3)},afade=t=out:st=${(len - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)},adelay=${ms}:all=1[amb${k}]`,
    );
    layers.push(`[amb${k}]`);
  }
  if (layers.length) {
    if (main === '[0:a]') filters.unshift(`[0:a]${AFORMAT}[main]`);
    filters.push(`[main]${layers.join('')}amix=inputs=${layers.length + 1}:duration=first:normalize=0[a]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[a]');
  }
  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath);
  try {
    await run(FFMPEG, args);
  } finally {
    await fs.rm(listPath, { force: true });
  }
}
