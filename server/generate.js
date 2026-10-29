import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR, mediaPathToUrl, mediaUrlToPath } from './paths.js';
import { findScene, readStoryboard, sceneTimeline, syncCues, updateStoryboard } from './storyboard.js';
import { generateImage, referenceCapacity } from './replicate.js';
import { OMNI_TOKENS_PER_SECOND, generateGeminiImage, generateGeminiVideo, geminiReferenceCapacity, isGeminiModel } from './gemini.js';
import { recordUsage } from './usage.js';
import { soundEffect, textToSpeech } from './elevenlabs.js';
import { extractThumbnail, probe, probeDuration, referenceDataUri } from './ffmpeg.js';

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

/** The visual slot holds either an image or a video; setting one clears the other. */
export const CLEAR_VIDEO = { video_url: null, video_thumb_url: null, video_duration_sec: null, video_has_audio: false, video_start_sec: 0 };
export const CLEAR_IMAGE = { image_url: null };

/** Never let narration get cut off: grow the scene to fit, rounded up to half a second. */
export function fitToVoiceover(scene) {
  const d = scene.voiceover_duration_sec;
  if (d && d + 0.3 > scene.duration_sec) scene.duration_sec = Math.ceil((d + 0.5) * 2) / 2;
}

/**
 * Apply `mutate` to a scene as one undo step named `label`. Media files it no longer references are
 * deleted once no undo step needs them. Resolves with the updated scene.
 */
export function commitScene(sceneId, mutate, label) {
  return updateStoryboard((sb) => {
    const s = findScene(sb, sceneId);
    mutate(s);
    return s;
  }, { label });
}

/**
 * A library entry for a file under media/. `info` is what probe() returned (duration, hasAudio);
 * `thumbUrl` defaults to the file itself for images.
 */
export async function assetRecord({ file, name, type, info = {}, thumbUrl, size, extra }) {
  return {
    asset_id: `a_${crypto.randomBytes(4).toString('hex')}`,
    name,
    type,
    url: mediaPathToUrl(file),
    thumb_url: thumbUrl ?? (type === 'image' ? mediaPathToUrl(file) : null),
    duration_sec: type === 'image' ? null : info.duration ?? null,
    has_audio: Boolean(info.hasAudio),
    size_bytes: size ?? (await fs.stat(file)).size,
    added_at: new Date().toISOString(),
    ...extra,
  };
}

const firstWords = (text, n = 6) => text.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).slice(0, n).join(' ').replace(/[\\/:*?"<>|]/g, '');

/**
 * Like commitScene, and also adds the generated file to the library (same undo step), named after
 * the scene and its prompt, e.g. "Scene 3 image - A lone submarine descending into.png".
 */
async function commitGenerated(sceneId, { file, kind, type, prompt, model, info, thumbUrl }, mutate, label) {
  const asset = await assetRecord({ file, type, info, thumbUrl, name: '', extra: { generated: { kind, model, prompt } } });
  return updateStoryboard((sb) => {
    const s = findScene(sb, sceneId);
    mutate(s);
    const words = firstWords(prompt);
    sb.library.push({ ...asset, name: `Scene ${sb.scenes.indexOf(s) + 1} ${kind}${words ? ` - ${words}` : ''}${path.extname(file)}` });
    return s;
  }, { label });
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

/**
 * The picture on screen in `scene` just before `atSec` (seconds into it): { path, atSec? } for a
 * reference, or null. A video gives the frame shown then; an extra shot its image.
 */
function pictureBefore(scene, atSec) {
  const part = sceneTimeline(scene).filter((p) => p.start < atSec).at(-1);
  if (part?.shot) {
    const path = mediaUrlToPath(part.shot.image_url);
    return path ? { path } : null;
  }
  const video = mediaUrlToPath(scene.video_url);
  if (video) {
    const shownUntil = (Number(scene.video_start_sec) || 0) + Math.min(atSec, scene.duration_sec);
    const end = Math.min(shownUntil, scene.video_duration_sec || shownUntil);
    return { path: video, atSec: Math.max(0, end - 0.1) };
  }
  const image = mediaUrlToPath(scene.image_url);
  return image ? { path: image } : null;
}

/**
 * The previous scene's last picture on screen, if this scene uses it: its image or last extra shot,
 * or the last frame of its video that's shown. Resolves with { label, path, atSec } or null.
 */
function previousSceneReference(sb, scene) {
  if (scene.use_previous_scene === false) return null;
  const i = sb.scenes.indexOf(scene);
  const prev = sb.scenes[i - 1];
  const picture = prev && pictureBefore(prev, prev.duration_sec);
  return picture ? { label: `Previous shot (scene ${i})`, ...picture } : null;
}

/**
 * The prompt for a scene with reference images. Design references (the library images) decide the
 * look: characters and setting must look exactly like them, and the scene text only decides what
 * changes for the story (action, pose, expression, framing). They're named so the scene text can
 * point at them ("Maya walks into the lab"). The previous shot, if sent, is for continuity only.
 */
function referencePrompt(scenePrompt, style, refs) {
  const n = (r) => refs.indexOf(r) + 1;
  const design = refs.filter((r) => !r.previous);
  const previous = refs.find((r) => r.previous);
  return [
    `Reference images, in order: ${refs.map((r) => `${n(r)}) ${r.label}`).join(', ')}.`,
    design.length &&
      `Treat ${previous ? `reference${design.length > 1 ? 's' : ''} ${design.map(n).join(', ')}` : 'the reference images'} as the exact design for this image. ` +
        'Every character must look exactly as in the references: same face, hair, body, clothing and colours. The setting must ' +
        'also be the same: same place, architecture, furniture, props, materials, lighting and art style. Change only what the ' +
        'scene below calls for, such as action, pose, facial expression, camera angle and framing. Where the scene text ' +
        'describes appearance differently from the references, follow the references.',
    previous &&
      `Reference ${n(previous)} is the previous shot of this video. Keep continuity with it: the same characters, clothing, ` +
      'props, lighting and state of the setting, and the same art style. But this is a new shot: frame and stage it as the ' +
      'scene below describes rather than copying the previous one.',
    `Scene: ${scenePrompt}`,
    style && `Style notes (only where the references don't already decide it): ${style}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Reference images an image model accepts (0 = none, null = no stated limit), from either provider. */
export async function imageReferenceCapacity(model) {
  return isGeminiModel(model) ? geminiReferenceCapacity(model) : referenceCapacity(model);
}

/**
 * Generate an image for `scene` from `imagePrompt`, with the scene's and project's references and the
 * `previous` shot (for continuity). Resolves with { buffer, ext, usage, model }.
 */
async function generateImageFor(sb, scene, imagePrompt, previous) {
  const { settings } = sb;
  // Scene references, then project ones, then the previous shot (dropped first if the model takes fewer).
  let refs = sceneReferences(sb, scene).map((a) => ({ label: refLabel(a), path: mediaUrlToPath(a.url) }));
  if (previous) refs.push({ ...previous, previous: true });
  const model = (refs.length ? settings.reference_model : settings.image_model)?.trim();
  if (!model) throw badRequest(`Pick ${refs.length ? 'a reference' : 'an image'} model in the Project panel (left)`);
  if (refs.length) {
    // Only name the references the model will actually receive.
    const capacity = await imageReferenceCapacity(model).catch(() => null);
    if (capacity) refs = refs.slice(0, capacity);
  }

  const prompt = refs.length
    ? referencePrompt(imagePrompt, settings.style_prompt?.trim(), refs)
    : [imagePrompt, settings.style_prompt?.trim()].filter(Boolean).join('. ');
  const references = await Promise.all(refs.map((r) => referenceDataUri(r.path, r.atSec)));
  const params = settings.image_params?.[model] || {};
  const generate = isGeminiModel(model) ? generateGeminiImage : generateImage;
  const { buffer, ext, usage } = await generate({
    prompt, model, aspectRatio: settings.aspect_ratio, references, referenceLabels: refs.map((r) => r.label), params,
  });
  recordUsage({ provider: isGeminiModel(model) ? 'gemini' : 'replicate', kind: 'image', model, scene_id: scene.scene_id, units: usage });
  return { buffer, ext, model };
}

export async function generateSceneImage(sceneId) {
  const sb = await readStoryboard();
  const scene = findScene(sb, sceneId);
  if (!scene.image_prompt.trim()) throw badRequest('This scene has no image prompt');

  const { buffer, ext, model } = await generateImageFor(sb, scene, scene.image_prompt.trim(), previousSceneReference(sb, scene));
  const file = await saveMedia('images', scene.scene_id, ext, buffer);
  const media = { file, kind: 'image', type: 'image', prompt: scene.image_prompt.trim(), model };
  return commitGenerated(scene.scene_id, media, (s) => {
    Object.assign(s, CLEAR_VIDEO, { image_url: mediaPathToUrl(file) });
    setSourceName(s, 'image', null);
  }, 'Generate image');
}

const CONTEXT_CHARS = 600;
const withoutTags = (text) => text.replace(/\[[^\]\n]{1,60}\]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The narration around a scene: the voiceover of the scenes before it (up to CONTEXT_CHARS, nearest
 * last) and of the next scene with narration. Audio tags are left out; they direct only their own line.
 */
function narrationContext(scenes, scene) {
  const i = scenes.indexOf(scene);
  const spoken = (s) => withoutTags(s.voiceover_text || '');
  let previous = '';
  for (let j = i - 1; j >= 0 && previous.length < CONTEXT_CHARS; j--) {
    const t = spoken(scenes[j]);
    if (t) previous = previous ? `${t} ${previous}` : t;
  }
  const next = scenes.slice(i + 1).map(spoken).find(Boolean) || '';
  return { previousText: previous.slice(-CONTEXT_CHARS), nextText: next.slice(0, CONTEXT_CHARS) };
}

export async function generateSceneVoiceover(sceneId) {
  const { settings, scenes } = await readStoryboard();
  const scene = findScene({ scenes }, sceneId);
  if (!scene.voiceover_text.trim()) throw badRequest('This scene has no voiceover text');

  const text = scene.voiceover_text.trim();
  // The neighbouring narration is sent as context, so tone and pace carry across scenes.
  const { buffer, usage, words } = await textToSpeech({
    text, voiceId: settings.voice_id, modelId: settings.tts_model, params: settings.tts_params, ...narrationContext(scenes, scene),
  });
  recordUsage({
    provider: 'elevenlabs', kind: 'voiceover', model: settings.tts_model, scene_id: scene.scene_id, units: { ...usage, characters: text.length },
  });
  const file = await saveMedia('voiceover', scene.scene_id, 'mp3', buffer);
  const duration = await probeDuration(file);
  const media = {
    file, kind: 'voiceover', type: 'audio', prompt: scene.voiceover_text.trim(), model: `${settings.tts_model} · ${settings.voice_id}`,
    info: { duration, hasAudio: true },
  };
  return commitGenerated(scene.scene_id, media, (s) => {
    Object.assign(s, { voiceover_url: mediaPathToUrl(file), voiceover_duration_sec: duration, voiceover_words: words });
    setSourceName(s, 'voiceover', null);
    fitToVoiceover(s);
    // Sounds synced to a word now land exactly when it's spoken.
    syncCues(s);
  }, 'Generate voiceover');
}

export async function generateSceneSfx(sceneId) {
  const { settings, scenes } = await readStoryboard();
  const scene = findScene({ scenes }, sceneId);
  if (!scene.sfx_prompt.trim()) throw badRequest('This scene has no sound effect prompt');

  const { buffer, usage } = await soundEffect({
    text: scene.sfx_prompt.trim(), durationSec: scene.duration_sec, modelId: settings.sfx_model, params: settings.sfx_params,
  });
  recordUsage({ provider: 'elevenlabs', kind: 'sfx', model: settings.sfx_model, scene_id: scene.scene_id, units: usage });
  const file = await saveMedia('sfx', scene.scene_id, 'mp3', buffer);
  const duration = await probeDuration(file);
  const media = { file, kind: 'sfx', type: 'audio', prompt: scene.sfx_prompt.trim(), model: settings.sfx_model, info: { duration, hasAudio: true } };
  return commitGenerated(scene.scene_id, media, (s) => {
    Object.assign(s, { sfx_url: mediaPathToUrl(file), sfx_duration_sec: duration });
    setSourceName(s, 'sfx', null);
  }, 'Generate sound effect');
}

/** Find one of a scene's extra shots. */
export function findShot(scene, shotId) {
  const shot = (scene.shots || []).find((s) => s.shot_id === shotId);
  if (!shot) throw Object.assign(new Error(`Shot ${shotId} not found`), { status: 404 });
  return shot;
}

/** Generate the picture of an extra shot, continuing from the picture shown just before it. */
export async function generateSceneShotImage(sceneId, shotId) {
  const sb = await readStoryboard();
  const scene = findScene(sb, sceneId);
  const shot = findShot(scene, shotId);
  if (!shot.image_prompt.trim()) throw badRequest('This shot has no image prompt');

  const before = pictureBefore(scene, shot.start_sec);
  const previous = before && { label: 'Previous shot (the picture just before this one)', ...before };
  const { buffer, ext, model } = await generateImageFor(sb, scene, shot.image_prompt.trim(), previous);
  const file = await saveMedia('images', scene.scene_id, ext, buffer);
  const media = { file, kind: 'image', type: 'image', prompt: shot.image_prompt.trim(), model };
  return commitGenerated(scene.scene_id, media, (s) => {
    // The shot may have been removed while it was generating; then the image just goes to the library.
    const target = (s.shots || []).find((x) => x.shot_id === shotId);
    if (target) Object.assign(target, { image_url: mediaPathToUrl(file), source_name: null });
  }, 'Generate shot');
}

/** Find one of a scene's extra sound effect layers. */
export function findSfxLayer(scene, layerId) {
  const layer = (scene.sfx_layers || []).find((l) => l.layer_id === layerId);
  if (!layer) throw Object.assign(new Error(`Sound effect layer ${layerId} not found`), { status: 404 });
  return layer;
}

/** Generate an extra sound effect layer: its own length, or the rest of the scene after its start. */
export async function generateSceneSfxLayer(sceneId, layerId) {
  const { settings, scenes } = await readStoryboard();
  const scene = findScene({ scenes }, sceneId);
  const layer = findSfxLayer(scene, layerId);
  if (!layer.prompt.trim()) throw badRequest('This sound effect has no prompt');

  const { buffer, usage } = await soundEffect({
    text: layer.prompt.trim(),
    durationSec: Math.max(0.5, layer.length_sec || scene.duration_sec - (layer.start_sec || 0)),
    modelId: settings.sfx_model,
    params: settings.sfx_params,
  });
  recordUsage({ provider: 'elevenlabs', kind: 'sfx', model: settings.sfx_model, scene_id: scene.scene_id, units: usage });
  const file = await saveMedia('sfx', scene.scene_id, 'mp3', buffer);
  const duration = await probeDuration(file);
  const media = { file, kind: 'sfx', type: 'audio', prompt: layer.prompt.trim(), model: settings.sfx_model, info: { duration, hasAudio: true } };
  return commitGenerated(scene.scene_id, media, (s) => {
    // The layer may have been removed while it was generating; then the file just goes to the library.
    const target = (s.sfx_layers || []).find((l) => l.layer_id === layerId);
    if (target) Object.assign(target, { url: mediaPathToUrl(file), duration_sec: duration, source_name: null });
  }, 'Generate sound effect');
}

/**
 * Generate a video clip for the scene from its video prompt (or else its image prompt), plus the
 * project style. If the scene has an image, it becomes the clip's first frame. The clip replaces the
 * image as the scene's visual.
 */
export async function generateSceneVideo(sceneId) {
  const sb = await readStoryboard();
  const { settings } = sb;
  const scene = findScene(sb, sceneId);
  const scenePrompt = scene.video_prompt?.trim() || scene.image_prompt.trim();
  if (!scenePrompt) throw badRequest('This scene has no video or image prompt to make a video from');
  const model = settings.video_model?.trim();
  if (!model) throw badRequest('Pick a video model in the Project panel (left)');
  if (!isGeminiModel(model)) throw badRequest('Video generation works with Gemini video models (e.g. Gemini Omni Flash). Pick one in the Project panel (left).');

  const prompt = [scenePrompt, settings.style_prompt?.trim()].filter(Boolean).join('. ');
  const imagePath = mediaUrlToPath(scene.image_url);
  const image = imagePath ? await referenceDataUri(imagePath) : null;
  const params = settings.video_params?.[model] || {};
  const { buffer, usage } = await generateGeminiVideo({ prompt, model, aspectRatio: settings.aspect_ratio, image, params });

  const file = await saveMedia('video', scene.scene_id, 'mp4', buffer);
  const info = await probe(file);
  // If Google doesn't report output tokens, count them the way it bills (tokens per second of video).
  const estimated = usage.video_output_tokens == null && info.duration > 0;
  recordUsage({
    provider: 'gemini', kind: 'video', model, scene_id: scene.scene_id,
    units: {
      ...usage,
      seconds: info.duration,
      ...(estimated && { video_output_tokens: Math.round(info.duration * OMNI_TOKENS_PER_SECOND), estimated: true }),
    },
  });
  const thumb = file.replace(/\.mp4$/, '.thumb.jpg');
  await extractThumbnail(file, thumb, Math.min(0.5, (info.duration || 0) / 2)).catch(() => {});
  const media = { file, kind: 'video', type: 'video', prompt: scenePrompt, model, info, thumbUrl: mediaPathToUrl(thumb) };
  return commitGenerated(scene.scene_id, media, (s) => {
    Object.assign(s, CLEAR_IMAGE, {
      video_url: mediaPathToUrl(file),
      video_thumb_url: mediaPathToUrl(thumb),
      video_duration_sec: info.duration,
      video_has_audio: Boolean(info.hasAudio),
      video_start_sec: 0,
    });
    setSourceName(s, 'image', null);
    // Show the whole clip unless the scene is already longer (a short clip holds its last frame).
    if (info.duration > s.duration_sec) s.duration_sec = Math.round(info.duration * 10) / 10;
  }, 'Generate video');
}

export { setSourceName };

export const GENERATORS = {
  image: { fn: generateSceneImage, has: (s) => s.image_url || s.video_url, prompt: 'image_prompt', label: 'image' },
  voiceover: { fn: generateSceneVoiceover, has: (s) => s.voiceover_url, prompt: 'voiceover_text', label: 'voiceover' },
  sfx: { fn: generateSceneSfx, has: (s) => s.sfx_url, prompt: 'sfx_prompt', label: 'sound effect' },
};
