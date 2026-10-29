import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLIPS_DIR, EXPORTS_DIR, mediaUrlToPath } from './paths.js';
import { RESOLUTIONS, readStoryboard, sceneMotion, sceneTimeline } from './storyboard.js';
import { concatClips, renderSceneClip } from './ffmpeg.js';
import { captionWords, captionsAss, finishFilters } from './finish.js';
import { GENERATORS, generateSceneShotImage, generateSceneSfxLayer, generateSceneVideo, sceneReferences } from './generate.js';
import { costEstimator } from './estimate.js';
import { isGeminiModel } from './gemini.js';
import { accountBalances } from './usage.js';

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

      const duration = Math.max(0.5, Number(scene.duration_sec) || 5);
      const opts = {
        videoPath, imagePath, voPath, sfxPath, width, height, fps, duration,
        videoStart: Number(scene.video_start_sec) || 0,
        videoAudio: Boolean(scene.video_has_audio),
        videoVolume: Number.isFinite(Number(scene.video_volume)) ? Number(scene.video_volume) : 1,
        motion: sceneMotion(scene, settings, i),
        moveAmount: moveAmount(settings),
        shots,
        sfxVolume: Number.isFinite(Number(settings.sfx_volume)) ? Number(settings.sfx_volume) : 0.35,
        sfxLayers,
        finish: finishFilters({ look: settings.look, vignette: settings.vignette, grain: settings.grain, shake: scene.shake, width, height }),
        captions: captionsAss({
          words: voPath && settings.captions !== 'off' ? captionWords(scene) : null,
          mode: settings.captions,
          position: settings.caption_position,
          title: scene.title_text,
          width, height, duration,
        }),
      };
      // Cache key covers every input, so unchanged scenes are reused instead of re-rendered.
      const key = crypto
        .createHash('sha1')
        .update(JSON.stringify({
          ...opts, v: 3, videoPath: await fileStamp(videoPath), imagePath: await fileStamp(imagePath), voPath: await fileStamp(voPath), sfxPath: await fileStamp(sfxPath),
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

/** How far camera moves go, as a fraction (settings.motion_amount is in percent). */
const moveAmount = (settings) => Math.min(0.4, Math.max(0.01, (Number(settings.motion_amount) || 12) / 100));

/** Whether a scene asks for a video clip: it has a video prompt, or its notes say "Generate video". */
const wantsVideo = (scene) => Boolean(scene.video_prompt?.trim() || /generate (a )?video/i.test(scene.notes || ''));

/**
 * Everything "Generate missing" can make, in the order it's made: per scene, each asset with a prompt
 * but no file yet (pictures first), then a video clip for each scene that asks for one and has none.
 * Videos go last so a clip starts from its scene's new image. Video items are `optional`: they're
 * only made when picked. Each item has `run` and the inputs its cost depends on.
 */
async function missingItems(sb) {
  const items = [];
  const videos = [];
  let previousHasPicture = false;
  for (const [i, scene] of sb.scenes.entries()) {
    const add = (fields) => items.push({ scene_id: scene.scene_id, scene: i + 1, ...fields });
    const refs = sceneReferences(sb, scene).length;
    const hasPicture = Boolean(
      (await existingFile(scene.image_url)) || (await existingFile(scene.video_url)) || scene.image_prompt?.trim(),
    );

    const image = GENERATORS.image;
    if (scene.image_prompt?.trim() && !(await existingFile(image.has(scene)))) {
      const previous = scene.use_previous_scene !== false && previousHasPicture;
      add({ id: `${scene.scene_id}:image`, kind: 'image', label: 'Image', prompt: scene.image_prompt.trim(), refs: refs + (previous ? 1 : 0), run: () => image.fn(scene.scene_id) });
    }
    // Extra shots count as images; each continues from the picture before it.
    for (const [n, s] of (scene.shots || []).entries()) {
      if (s.image_prompt?.trim() && !(await existingFile(s.image_url))) {
        add({
          id: `${scene.scene_id}:shot:${s.shot_id}`, kind: 'image', label: `Shot ${n + 2}`, prompt: s.image_prompt.trim(), refs: refs + (hasPicture ? 1 : 0),
          run: () => generateSceneShotImage(scene.scene_id, s.shot_id),
        });
      }
    }
    for (const kind of ['voiceover', 'sfx']) {
      const g = GENERATORS[kind];
      if (scene[g.prompt]?.trim() && !(await existingFile(g.has(scene)))) {
        add({
          id: `${scene.scene_id}:${kind}`, kind, label: kind === 'sfx' ? 'Background sound' : 'Voiceover', prompt: scene[g.prompt].trim(),
          sec: scene.duration_sec, run: () => g.fn(scene.scene_id),
        });
      }
    }
    // Extra sound effect layers count as sound effects.
    for (const [n, l] of (scene.sfx_layers || []).entries()) {
      if (l.prompt?.trim() && !(await existingFile(l.url))) {
        add({
          id: `${scene.scene_id}:sfx:${l.layer_id}`, kind: 'sfx', label: `Sound effect ${n + 2}`, prompt: l.prompt.trim(),
          sec: l.length_sec || scene.duration_sec - (l.start_sec || 0), run: () => generateSceneSfxLayer(scene.scene_id, l.layer_id),
        });
      }
    }
    if (wantsVideo(scene) && !(await existingFile(scene.video_url))) {
      videos.push({
        scene_id: scene.scene_id, scene: i + 1, id: `${scene.scene_id}:video`, kind: 'video', label: 'Video clip', optional: true,
        prompt: (scene.video_prompt || scene.image_prompt || '').trim(), sec: scene.duration_sec, run: () => generateSceneVideo(scene.scene_id),
      });
    }
    previousHasPicture = hasPicture;
  }
  return [...items, ...videos];
}

/**
 * What "Generate missing" would make, with each item's model and estimated cost, for the dialog that
 * asks before generating. `settings` are unsaved changes to price with (e.g. a model just picked).
 */
export async function generationPlan(settings) {
  const saved = await readStoryboard();
  const sb = { ...saved, settings: { ...saved.settings, ...(settings && typeof settings === 'object' ? settings : {}) } };
  const cost = await costEstimator(sb.settings);
  const items = (await missingItems(sb)).map(({ run, refs, sec, ...item }) => {
    const estimate =
      item.kind === 'image' ? cost.image(item.prompt, refs)
        : item.kind === 'voiceover' ? cost.voice(item.prompt)
          : item.kind === 'sfx' ? cost.sfx(sec)
            : cost.video(sec);
    return { ...item, ...estimate };
  });
  // ElevenLabs is the only provider whose API reports what's left (null when it can't be read).
  const balances = await accountBalances().catch(() => null);
  const elevenlabsRemaining = balances?.elevenlabs?.ok ? balances.elevenlabs.remaining ?? null : null;
  return { items, unpriced: [...cost.unpriced], elevenlabs_rate: cost.elevenlabsRate, elevenlabs_remaining: elevenlabsRemaining };
}

// ---- Errors while generating ----------------------------------------------------------------------
// Provider errors read "<Provider> <HTTP status>: <message>" (elevenlabs.js, replicate.js, gemini.js).
// An account that can't pay fails every request after it, so "Generate missing" stops using that
// provider (and carries on with the others) instead of failing the rest of a long list one by one.

const PROVIDER_ERROR = /^(ElevenLabs|Replicate|Gemini) (\d{3})\b/;
const NO_CREDIT = /quota|credit|billing|insufficient|payment|exceeds your/i;
const RETRY_DELAYS_MS = [5000, 20000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 'credits' (the account is out of credits or over its quota), 'account' (the API key was refused),
 * 'retry' (may pass on another try), or null. Both of the first two stop that provider.
 */
function classify(err, lastTry) {
  const status = Number(err.message.match(PROVIDER_ERROR)?.[2]);
  if (status === 402 || ((status === 401 || status === 403) && NO_CREDIT.test(err.message))) return 'credits';
  if (status === 401) return 'account';
  // 429 is also a plain rate limit, so it's only taken as "out of quota" once retrying hasn't helped.
  if (status === 429) return lastTry && NO_CREDIT.test(err.message) ? 'credits' : 'retry';
  if (status >= 500 || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(err.message)) return 'retry';
  return null;
}

/** Which account an item is paid from. */
function providerOf(item, settings) {
  if (item.kind === 'voiceover' || item.kind === 'sfx') return 'ElevenLabs';
  if (item.kind === 'video') return 'Gemini';
  return isGeminiModel(item.refs ? settings.reference_model : settings.image_model) ? 'Gemini' : 'Replicate';
}

/** Run an item, retrying errors that may pass (rate limits, server errors). Throws with `err.kind`. */
async function runWithRetry(item, onRetry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await item.run();
    } catch (err) {
      const lastTry = attempt === RETRY_DELAYS_MS.length;
      err.kind = classify(err, lastTry);
      if (err.kind !== 'retry' || lastTry) throw err;
      onRetry(err, RETRY_DELAYS_MS[attempt]);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Generate missing assets: the plan items with these `ids` (from generationPlan), or else every
 * non-optional item of the given `kinds` (image, voiceover, sfx).
 */
export function startGenerateMissing({ kinds, ids } = {}) {
  if (!Array.isArray(kinds)) kinds = Object.keys(GENERATORS);
  if (ids && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) {
    throw Object.assign(new Error('items must be a list of plan item ids'), { status: 400 });
  }
  return start('generate', async (report, current) => {
    const sb = await readStoryboard();
    const all = await missingItems(sb);
    const picked = ids ? new Set(ids) : null;
    const todo = all.filter((item) => (picked ? picked.has(item.id) : !item.optional && kinds.includes(item.kind)));
    if (!todo.length) return { generated: 0, total: 0 };

    let generated = 0;
    let failed = 0;
    // Providers that ran out of credits: name → { scene, label, skipped }.
    const stopped = new Map();
    for (const [n, item] of todo.entries()) {
      const { scene, label } = item;
      const provider = providerOf(item, sb.settings);
      if (stopped.has(provider)) {
        stopped.get(provider).skipped++;
        continue;
      }
      const step = `Scene ${scene}: generating ${label.toLowerCase()} (${n + 1}/${todo.length})`;
      report(n / todo.length, `${step}…`);
      try {
        await runWithRetry(item, (err, ms) => report(n / todo.length, `${step}: ${err.message.slice(0, 80)}. Retrying in ${ms / 1000} s…`));
        generated++;
      } catch (err) {
        if (err.status === 400) throw err; // missing API key or a bad setting: no point continuing
        failed++;
        const name = err.message.match(PROVIDER_ERROR)?.[1] || provider;
        if ((err.kind === 'credits' || err.kind === 'account') && !stopped.has(name)) {
          stopped.set(name, { scene, label, skipped: 0, reason: err.kind });
          const what = err.kind === 'credits' ? 'is out of credits or over its quota' : 'refused the API key';
          const fix = err.kind === 'credits' ? 'Top up' : 'Check the key in .env (then restart)';
          current.warnings.push(
            `${name} ${what} (scene ${scene} ${label.toLowerCase()}): ${err.message}. ` +
              `Nothing more was sent to ${name}. ${fix}, then use Generate missing again to make the rest.`,
          );
        } else {
          current.warnings.push(`Scene ${scene} ${label.toLowerCase()}: ${err.message}`);
        }
      }
    }
    const outOfCredits = [...stopped].map(([provider, s]) => ({ provider, ...s }));
    const skipped = outOfCredits.reduce((t, s) => t + s.skipped, 0);
    return { generated, failed, skipped, total: todo.length, out_of_credits: outOfCredits };
  });
}
