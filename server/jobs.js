import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLIPS_DIR, EXPORTS_DIR, mediaUrlToPath } from './paths.js';
import { RESOLUTIONS, readStoryboard, sceneMotion, sceneTimeline } from './storyboard.js';
import { concatClips, renderSceneClip } from './ffmpeg.js';
import { GENERATORS, generateSceneShotImage, generateSceneSfxLayer } from './generate.js';

/**
 * One long-running background job at a time (export or bulk generation).
 * The UI polls GET /api/job for progress.
 */
let job = { status: 'idle' };

export const getJob = () => job;

function start(kind, task) {
  if (job.status === 'running') {
    throw Object.assign(new Error(`A ${job.kind} job is already running`), { status: 409 });
  }
  job = { id: crypto.randomUUID(), kind, status: 'running', progress: 0, message: 'Starting…', warnings: [], startedAt: Date.now() };
  const current = job;
  const report = (progress, message) => Object.assign(current, { progress, ...(message && { message }) });
  task(report, current)
    .then((result) => Object.assign(current, { status: 'done', progress: 1, message: 'Done', result, finishedAt: Date.now() }))
    .catch((err) => Object.assign(current, { status: 'error', error: err.message, finishedAt: Date.now() }));
  return current;
}

async function fileStamp(file) {
  if (!file) return null;
  try {
    const st = await fs.stat(file);
    return `${file}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

async function existingFile(url) {
  const file = mediaUrlToPath(url);
  return file && (await fileStamp(file)) ? file : null;
}

export function startExport() {
  return start('export', async (report, current) => {
    const { settings, scenes } = await readStoryboard();
    if (!scenes.length) throw new Error('The storyboard has no scenes');
    const { width, height } = RESOLUTIONS[settings.aspect_ratio] || RESOLUTIONS['16:9'];
    const fps = Number(settings.fps) || 30;
    await fs.mkdir(CLIPS_DIR, { recursive: true });
    await fs.mkdir(EXPORTS_DIR, { recursive: true });

    const clipPaths = [];
    const steps = scenes.length + 1; // +1 for the final concat
    for (const [i, scene] of scenes.entries()) {
      const label = `Scene ${i + 1}/${scenes.length}`;
      const videoPath = await existingFile(scene.video_url);
      const imagePath = videoPath ? null : await existingFile(scene.image_url);
      const voPath = await existingFile(scene.voiceover_url);
      const sfxPath = await existingFile(scene.sfx_url);
      // Extra shots with a picture on disk, each with its own motion.
      const shots = [];
      for (const { shot, start } of sceneTimeline(scene).slice(1)) {
        const file = await existingFile(shot.image_url);
        if (file) shots.push({ imagePath: file, start, motion: sceneMotion(shot, settings, i + shots.length + 1) });
      }
      const sfxLayers = [];
      for (const l of scene.sfx_layers || []) {
        const file = await existingFile(l.url);
        if (file) sfxLayers.push({ path: file, volume: Number.isFinite(Number(l.volume)) ? Number(l.volume) : 1, start: Number(l.start_sec) || 0 });
      }
      if (!imagePath && !videoPath) current.warnings.push(`${label} has no image or video (rendered as black)`);
      if (scene.voiceover_duration_sec > scene.duration_sec) current.warnings.push(`${label}: voiceover is cut off`);

      const opts = {
        videoPath, imagePath, voPath, sfxPath, width, height, fps,
        videoStart: Number(scene.video_start_sec) || 0,
        videoAudio: Boolean(scene.video_has_audio),
        videoVolume: Number.isFinite(Number(scene.video_volume)) ? Number(scene.video_volume) : 1,
        duration: Math.max(0.5, Number(scene.duration_sec) || 5),
        motion: sceneMotion(scene, settings, i),
        shots,
        sfxVolume: Number.isFinite(Number(settings.sfx_volume)) ? Number(settings.sfx_volume) : 0.35,
        sfxLayers,
      };
      // Cache key covers every input, so unchanged scenes are reused instead of re-rendered.
      const key = crypto
        .createHash('sha1')
        .update(JSON.stringify({
          ...opts, v: 2, videoPath: await fileStamp(videoPath), imagePath: await fileStamp(imagePath), voPath: await fileStamp(voPath), sfxPath: await fileStamp(sfxPath),
          sfxLayers: await Promise.all(sfxLayers.map(async (l) => ({ ...l, path: await fileStamp(l.path) }))),
          shots: await Promise.all(shots.map(async (s) => ({ ...s, imagePath: await fileStamp(s.imagePath) }))),
        }))
        .digest('hex')
        .slice(0, 12);
      const outPath = path.join(CLIPS_DIR, `scene-${scene.scene_id}-${key}.mp4`);
      clipPaths.push(outPath);

      if (await fileStamp(outPath)) {
        report((i + 1) / steps, `${label}: unchanged, using cached clip`);
        continue;
      }
      report(i / steps, `${label}: rendering…`);
      await renderSceneClip({ ...opts, outPath: outPath + '.part.mp4', onProgress: (p) => report((i + p) / steps) });
      await fs.rename(outPath + '.part.mp4', outPath);
    }

    const totalSec = scenes.reduce((sum, s) => sum + Math.max(0.5, Number(s.duration_sec) || 5), 0);
    const musicPath = await existingFile(settings.music_url);
    const music = musicPath && {
      path: musicPath,
      totalSec,
      volume: Number.isFinite(Number(settings.music_volume)) ? Number(settings.music_volume) : 0.15,
      ducking: settings.music_ducking !== false,
    };
    if (settings.music_url && !musicPath) current.warnings.push('Background music file is missing');

    report(scenes.length / steps, music ? 'Stitching scenes and mixing music…' : 'Stitching scenes together…');
    const output = path.join(EXPORTS_DIR, 'final_output.mp4');
    await concatClips(clipPaths, output, path.join(CLIPS_DIR, 'concat.txt'), music);

    // Drop clips no longer referenced by any scene.
    const keep = new Set(clipPaths.map((p) => path.basename(p)));
    for (const name of await fs.readdir(CLIPS_DIR)) {
      if (!keep.has(name)) await fs.rm(path.join(CLIPS_DIR, name), { force: true });
    }

    return { url: `/exports/final_output.mp4?t=${Date.now()}`, path: output, duration_sec: totalSec, width, height };
  });
}

/** Generate every asset that has a prompt but no file yet. `kinds` limits which asset types are generated. */
export function startGenerateMissing(kinds = Object.keys(GENERATORS)) {
  return start('generate', async (report, current) => {
    const { scenes } = await readStoryboard();
    const todo = [];
    for (const [i, scene] of scenes.entries()) {
      for (const kind of kinds) {
        const g = GENERATORS[kind];
        if (!g) continue;
        if (scene[g.prompt]?.trim() && !(await existingFile(g.has(scene)))) todo.push({ i, label: g.label, run: () => g.fn(scene.scene_id) });
        // Extra shots count as images, extra sound effect layers as sound effects.
        if (kind === 'image') {
          for (const [n, s] of (scene.shots || []).entries()) {
            if (s.image_prompt?.trim() && !(await existingFile(s.image_url))) {
              todo.push({ i, label: `shot ${n + 2}`, run: () => generateSceneShotImage(scene.scene_id, s.shot_id) });
            }
          }
        }
        if (kind !== 'sfx') continue;
        for (const [n, l] of (scene.sfx_layers || []).entries()) {
          if (l.prompt?.trim() && !(await existingFile(l.url))) {
            todo.push({ i, label: `sound effect ${n + 2}`, run: () => generateSceneSfxLayer(scene.scene_id, l.layer_id) });
          }
        }
      }
    }
    if (!todo.length) return { generated: 0 };

    let generated = 0;
    for (const [n, { i, label, run }] of todo.entries()) {
      report(n / todo.length, `Scene ${i + 1}: generating ${label} (${n + 1}/${todo.length})…`);
      try {
        await run();
        generated++;
      } catch (err) {
        current.warnings.push(`Scene ${i + 1} ${label}: ${err.message}`);
        if (err.status === 400) throw err; // missing API key: no point continuing
      }
    }
    return { generated, failed: todo.length - generated };
  });
}
