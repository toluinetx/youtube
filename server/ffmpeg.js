import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path;

const KENBURNS_ZOOM = 0.12;

function run(bin, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
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
 * An image as a JPEG data URI no larger than 1024px on its longest side, for sending to Replicate
 * as a reference (data URIs are recommended only under 1MB).
 */
export async function referenceDataUri(imagePath) {
  const tmp = path.join(os.tmpdir(), `ref-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await run(FFMPEG, [
      '-y', '-hide_banner', '-v', 'error', '-i', imagePath, '-frames:v', '1',
      '-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease,format=yuvj420p",
      '-q:v', '3', tmp,
    ]);
    return `data:image/jpeg;base64,${(await fs.readFile(tmp)).toString('base64')}`;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function parseTime(line) {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const AFORMAT = 'aformat=sample_rates=44100:channel_layouts=stereo';

/**
 * Render one scene to an mp4, padded/trimmed to exactly `duration` seconds. The visual is a video clip
 * (starting at `videoStart`, last frame held if it runs short), a still image (optionally with a slow
 * Ken Burns zoom) or black. The clip's own audio, voiceover and SFX are mixed together.
 * Every clip uses identical codec settings so they concat losslessly.
 */
export async function renderSceneClip({
  videoPath, videoStart = 0, videoAudio = false, videoVolume = 1, imagePath, voPath, sfxPath,
  duration, width, height, fps, motion, zoomIn, sfxVolume, outPath, onProgress,
}) {
  const args = ['-y', '-hide_banner'];
  const frames = Math.max(1, Math.round(duration * fps));
  const cover = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

  let video;
  if (videoPath) {
    args.push('-ss', String(videoStart), '-i', videoPath);
    video = `[0:v]${cover},fps=${fps},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${duration}[v]`;
  } else if (imagePath) {
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', imagePath);
    if (motion === 'kenburns') {
      // Upscale first so zoompan's integer cropping doesn't jitter.
      const z = zoomIn ? `1+${KENBURNS_ZOOM}*on/${frames}` : `${1 + KENBURNS_ZOOM}-${KENBURNS_ZOOM}*on/${frames}`;
      video =
        `[0:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},` +
        `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},` +
        `setsar=1,format=yuv420p[v]`;
    } else {
      video = `[0:v]${cover},fps=${fps},setsar=1,format=yuv420p[v]`;
    }
  } else {
    args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}`);
    video = '[0:v]setsar=1,format=yuv420p[v]';
  }

  const audio = [];
  let next = 1;
  if (videoPath && videoAudio && videoVolume > 0) audio.push(`[0:a]${AFORMAT},volume=${videoVolume}`);
  if (voPath) {
    args.push('-i', voPath);
    audio.push(`[${next++}:a]${AFORMAT}`);
  }
  if (sfxPath) {
    args.push('-i', sfxPath);
    const fadeStart = Math.max(0, duration - 0.4);
    audio.push(`[${next++}:a]${AFORMAT},volume=${sfxVolume},afade=t=out:st=${fadeStart}:d=0.4`);
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

  await run(FFMPEG, args, {
    onStderr: (line) => {
      const t = parseTime(line);
      if (t != null) onProgress?.(Math.min(1, t / duration));
    },
  });
}

/**
 * Join clips that share codec settings. Video is stream-copied; audio is re-encoded to avoid gaps at the seams.
 * With `music`, a looped background track is mixed underneath (faded in/out, optionally ducked under speech).
 */
export async function concatClips(clipPaths, outPath, listPath, music = null) {
  const list = clipPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, list + '\n');
  const args = ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', listPath];
  if (music) {
    const total = music.totalSec;
    const fadeOut = Math.min(2, total / 4);
    args.push('-stream_loop', '-1', '-i', music.path);
    const bed = `[1:a]${AFORMAT},atrim=0:${total},volume=${music.volume},afade=t=in:d=${Math.min(1, total / 4)},afade=t=out:st=${total - fadeOut}:d=${fadeOut}`;
    const filter = music.ducking
      ? `[0:a]${AFORMAT},asplit=2[main][key];${bed}[bed];[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];[main][duck]amix=inputs=2:duration=first:normalize=0[a]`
      : `[0:a]${AFORMAT}[main];${bed}[bed];[main][bed]amix=inputs=2:duration=first:normalize=0[a]`;
    args.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]');
  }
  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath);
  try {
    await run(FFMPEG, args);
  } finally {
    await fs.rm(listPath, { force: true });
  }
}
