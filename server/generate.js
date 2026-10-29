import fs from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR, mediaPathToUrl, mediaUrlToPath } from './paths.js';
import { MEDIA_URL_FIELDS, findScene, readStoryboard, updateStoryboard } from './storyboard.js';
import { generateImage, referenceCapacity } from './replicate.js';
import { soundEffect, textToSpeech } from './elevenlabs.js';
import { probeDuration, referenceDataUri } from './ffmpeg.js';

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export async function saveMedia(kind, sceneId, ext, buffer) {
  const file = mediaFilePath(kind, `scene-${sceneId}`, ext);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  return file;
}

/** Unique name per file so the browser never shows a stale cached copy. */
export function mediaFilePath(kind, prefix, ext) {
  return path.join(MEDIA_DIR, kind, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
}

/** Delete a scene-owned media file. Library files are shared and only deleted from the library. */
export async function removeMedia(url) {
  if (!url || url.startsWith('/media/library/')) return;
  const file = mediaUrlToPath(url);
  if (file) await fs.rm(file, { force: true });
}

export const sceneMediaUrls = (scene) => MEDIA_URL_FIELDS.map((f) => scene[f]).filter(Boolean);

/** The visual slot holds either an image or a video; setting one clears the other. */
export const CLEAR_VIDEO = { video_url: null, video_thumb_url: null, video_duration_sec: null, video_has_audio: false, video_start_sec: 0 };
export const CLEAR_IMAGE = { image_url: null };

/** Never let narration get cut off: grow the scene to fit, rounded up to half a second. */
export function fitToVoiceover(scene) {
  const d = scene.voiceover_duration_sec;
  if (d && d + 0.3 > scene.duration_sec) scene.duration_sec = Math.ceil((d + 0.5) * 2) / 2;
}

/**
 * Apply `mutate` to a scene and delete any media files it no longer references.
 * Resolves with the updated scene.
 */
export async function commitScene(sceneId, mutate) {
  let orphaned = [];
  const scene = await updateStoryboard((sb) => {
    const s = findScene(sb, sceneId);
    const before = sceneMediaUrls(s);
    mutate(s);
    const after = new Set(sceneMediaUrls(s));
    orphaned = before.filter((u) => !after.has(u));
    return s;
  });
  await Promise.all(orphaned.map(removeMedia));
  return scene;
}

function setSourceName(scene, slot, name) {
  const { [slot]: _, ...rest } = scene.source_names || {};
  scene.source_names = name ? { ...rest, [slot]: name } : rest;
}

/**
 * The library images to send as references for a scene: its own, then (unless turned off) the
 * project-wide ones. Missing or non-image assets are skipped.
 */
export function sceneReferences(sb, scene) {
  const ids = [...(scene.reference_asset_ids || []), ...(scene.use_global_references !== false ? sb.settings.reference_asset_ids || [] : [])];
  const byId = new Map(sb.library.map((a) => [a.asset_id, a]));
  return [...new Set(ids)].map((id) => byId.get(id)).filter((a) => a?.type === 'image' && mediaUrlToPath(a.url));
}

const refLabel = (asset) => asset.name.replace(/\.[^.]+$/, '');

export async function generateSceneImage(sceneId) {
  const sb = await readStoryboard();
  const { settings } = sb;
  const scene = findScene(sb, sceneId);
  if (!scene.image_prompt.trim()) throw badRequest('This scene has no image prompt');

  let refs = sceneReferences(sb, scene);
  const model = (refs.length ? settings.reference_model : settings.image_model)?.trim();
  if (!model) throw badRequest(`Pick ${refs.length ? 'a reference' : 'an image'} model in the Project tab`);
  if (refs.length) {
    // Only name the references the model will actually receive (scene ones come first).
    const capacity = await referenceCapacity(model).catch(() => null);
    if (capacity) refs = refs.slice(0, capacity);
  }

  const parts = [scene.image_prompt.trim(), settings.style_prompt?.trim()];
  if (refs.length) {
    // Name the references so the prompt can point at them ("Maya walks into the lab").
    parts.push(
      `Reference images, in order: ${refs.map((a, i) => `${i + 1}) ${refLabel(a)}`).join(', ')}. ` +
        'Keep the characters, faces, outfits and places consistent with the reference images.',
    );
  }
  const prompt = parts.filter(Boolean).join('. ');
  const references = await Promise.all(refs.map((a) => referenceDataUri(mediaUrlToPath(a.url))));
  const { buffer, ext } = await generateImage({ prompt, model, aspectRatio: settings.aspect_ratio, references });
  const file = await saveMedia('images', scene.scene_id, ext, buffer);
  return commitScene(scene.scene_id, (s) => {
    Object.assign(s, CLEAR_VIDEO, { image_url: mediaPathToUrl(file) });
    setSourceName(s, 'image', null);
  });
}

export async function generateSceneVoiceover(sceneId) {
  const { settings, scenes } = await readStoryboard();
  const scene = findScene({ scenes }, sceneId);
  if (!scene.voiceover_text.trim()) throw badRequest('This scene has no voiceover text');

  const buffer = await textToSpeech({ text: scene.voiceover_text.trim(), voiceId: settings.voice_id, modelId: settings.tts_model });
  const file = await saveMedia('voiceover', scene.scene_id, 'mp3', buffer);
  const duration = await probeDuration(file);
  return commitScene(scene.scene_id, (s) => {
    Object.assign(s, { voiceover_url: mediaPathToUrl(file), voiceover_duration_sec: duration });
    setSourceName(s, 'voiceover', null);
    fitToVoiceover(s);
  });
}

export async function generateSceneSfx(sceneId) {
  const { scenes } = await readStoryboard();
  const scene = findScene({ scenes }, sceneId);
  if (!scene.sfx_prompt.trim()) throw badRequest('This scene has no sound effect prompt');

  const buffer = await soundEffect({ text: scene.sfx_prompt.trim(), durationSec: scene.duration_sec });
  const file = await saveMedia('sfx', scene.scene_id, 'mp3', buffer);
  const duration = await probeDuration(file);
  return commitScene(scene.scene_id, (s) => {
    Object.assign(s, { sfx_url: mediaPathToUrl(file), sfx_duration_sec: duration });
    setSourceName(s, 'sfx', null);
  });
}

export { setSourceName };

export const GENERATORS = {
  image: { fn: generateSceneImage, has: (s) => s.image_url || s.video_url, prompt: 'image_prompt', label: 'image' },
  voiceover: { fn: generateSceneVoiceover, has: (s) => s.voiceover_url, prompt: 'voiceover_text', label: 'voiceover' },
  sfx: { fn: generateSceneSfx, has: (s) => s.sfx_url, prompt: 'sfx_prompt', label: 'sound effect' },
};
