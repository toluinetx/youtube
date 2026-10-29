import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR, mediaPathToUrl, mediaUrlToPath } from './paths.js';
import { findScene, readStoryboard, sceneTimeline, syncCues, updateStoryboard } from './storyboard.js';
import { generateImage, referenceCapacity } from './replicate.js';
import { OMNI_TOKENS_PER_SECOND, checkImage, generateGeminiImage, generateGeminiVideo, geminiReferenceCapacity, isGeminiModel } from './gemini.js';
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

/**
 * The project's style images for a scene, with their captions: [{ asset, caption }]. Sent whenever
 * the scene uses project references ("+ project refs"); a standalone reference sets
 * `use_style_references` to get the style without the other references.
 */
export function styleReferences(sb, scene) {
  if (!(scene.use_style_references ?? scene.use_global_references !== false)) return [];
  const byId = new Map(sb.library.map((a) => [a.asset_id, a]));
  return (sb.settings.style_references || [])
    .map((r) => ({ asset: byId.get(r.asset_id), caption: r.caption?.trim() || '' }))
    .filter((r) => r.asset?.type === 'image' && mediaUrlToPath(r.asset.url));
}

/** A style image as a reference for generateImageFor: labelled by its caption, marked `style`. */
const styleRef = ({ asset, caption }) => ({
  label: caption ? `style: ${caption}` : 'style reference', caption, path: mediaUrlToPath(asset.url), style: true,
});

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
function referencePrompt(scenePrompt, style, refs, guardrails) {
  const n = (r) => refs.indexOf(r) + 1;
  const design = refs.filter((r) => !r.previous && !r.style);
  const styles = refs.filter((r) => r.style);
  const previous = refs.find((r) => r.previous);
  const only = design.length === refs.length;
  return [
    `Reference images, in order: ${refs.map((r) => `${n(r)}) ${r.label}`).join(', ')}.`,
    design.length &&
      `Treat ${only ? 'the reference images' : `reference${design.length > 1 ? 's' : ''} ${design.map(n).join(', ')}`} as the exact design for this image. ` +
        'Every character must look exactly as in the references: same face, hair, body, clothing and colours. The setting must ' +
        'also be the same: same place, architecture, furniture, props, materials, lighting and art style. Change only what the ' +
        'scene below calls for, such as action, pose, facial expression, camera angle and framing. Where the scene text ' +
        'describes appearance differently from the references, follow the references.',
    styles.length &&
      (styles.length > 1
        ? `References ${styles.map(n).join(', ')} show the art style of this video. Match their medium, linework, colour palette, ` +
          'lighting, texture and rendering, but don\'t copy their characters, objects, setting or composition.' +
          (styles.some((r) => r.caption) ? ` What to take from each: ${styles.filter((r) => r.caption).map((r) => `${n(r)}) ${r.caption}`).join('; ')}.` : '')
        : `Reference ${n(styles[0])} shows the art style of this video. Match its medium, linework, colour palette, lighting, ` +
          'texture and rendering, but don\'t copy its characters, objects, setting or composition.' +
          (styles[0].caption ? ` Take from it: ${styles[0].caption}.` : '')),
    previous &&
      `Reference ${n(previous)} is the previous shot of this video. Keep continuity with it: the same characters, clothing, ` +
      'props, lighting and state of the setting, and the same art style. But this is a new shot: frame and stage it as the ' +
      'scene below describes rather than copying the previous one. Don\'t carry over people, arms or hands from it that ' +
      'the scene below doesn\'t describe.',
    `Scene: ${scenePrompt}`,
    guardrails && IMAGE_GUARDRAILS,
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
 * Added to every image prompt (unless the project turns it off): image models often add a second
 * person, or a third hand, to scenes with one character and to close-ups of hands.
 */
const IMAGE_GUARDRAILS =
  'People and hands: show only the people this scene describes, each of them once. A character described as alone ' +
  'is the only person in the frame, with no one else\'s hands or arms in it. Every person has exactly two arms and two ' +
  'hands with five fingers each, all clearly attached to them';

/**
 * Generate an image for `scene` from `imagePrompt`, with the scene's and project's references and the
 * `previous` shot (for continuity). If the project checks images, a vision model looks at each one and
 * it's regenerated (telling the model what went wrong) until it passes or the retries run out; the
 * attempt with the fewest problems is kept. Resolves with { buffer, ext, model, check }, where check is
 * { ok, issues, people, hands, attempts }, { error } if the check itself failed, or null if it's off.
 */
async function generateImageFor(sb, scene, imagePrompt, previous) {
  const { settings } = sb;
  // Scene references, then project ones, then style images, then the previous shot (dropped first if
  // the model takes fewer). An image that's both a reference and a style image is sent once, as style.
  const styleImages = styleReferences(sb, scene);
  const styleIds = new Set(styleImages.map((r) => r.asset.asset_id));
  let refs = sceneReferences(sb, scene)
    .filter((a) => !styleIds.has(a.asset_id))
    .map((a) => ({ label: refLabel(a), path: mediaUrlToPath(a.url) }));
  refs.push(...styleImages.map(styleRef));
  if (previous) refs.push({ ...previous, previous: true });
  const model = (refs.length ? settings.reference_model : settings.image_model)?.trim();
  if (!model) throw badRequest(`Pick ${refs.length ? 'a reference' : 'an image'} model in the Project panel (left)`);
  if (refs.length) {
    // Only name the references the model will actually receive.
    const capacity = await imageReferenceCapacity(model).catch(() => null);
    if (capacity) refs = refs.slice(0, capacity);
  }

  const guardrails = settings.image_guardrails !== false;
  const style = settings.style_prompt?.trim();
  const basePrompt = refs.length
    ? referencePrompt(imagePrompt, style, refs, guardrails)
    : // Last, so a model that cuts long prompts short (FLUX) drops it before the scene and the style.
      [imagePrompt, style, guardrails && IMAGE_GUARDRAILS].filter(Boolean).join('. ');
  const references = await Promise.all(refs.map((r) => referenceDataUri(r.path, r.atSec)));
  const params = settings.image_params?.[model] || {};
  const generate = isGeminiModel(model) ? generateGeminiImage : generateImage;
  const checkModel = settings.image_check && hasGeminiKey() ? settings.image_check_model?.trim() : null;
  const tries = checkModel ? 1 + Math.min(5, Math.max(0, Math.round(Number(settings.image_check_retries) || 0))) : 1;

  let best = null;
  let problems = [];
  for (let attempt = 1; attempt <= tries; attempt++) {
    const prompt = problems.length
      ? `${basePrompt}\n\nAn earlier attempt at this image was rejected for: ${problems.join(' ')} Make sure this one doesn't have these problems.`
      : basePrompt;
    const { buffer, ext, usage } = await generate({
      prompt, model, aspectRatio: settings.aspect_ratio, references, referenceLabels: refs.map((r) => r.label), params,
    });
    recordUsage({ provider: isGeminiModel(model) ? 'gemini' : 'replicate', kind: 'image', model, scene_id: scene.scene_id, units: usage });
    if (!checkModel) return { buffer, ext, model, check: null };

    let check;
    try {
      const { usage: checkUsage, ...result } = await checkImage({ image: bufferDataUri(buffer, ext), brief: imagePrompt, model: checkModel });
      recordUsage({ provider: 'gemini', kind: 'image check', model: checkModel, scene_id: scene.scene_id, units: checkUsage });
      check = { ...result, attempts: attempt };
    } catch (err) {
      // A check that can't run mustn't lose an image that's already paid for.
      console.warn(`Image check failed: ${err.message}`);
      return { buffer, ext, model, check: { error: err.message, attempts: attempt } };
    }
    if (!best || check.issues.length < best.check.issues.length) best = { buffer, ext, model, check };
    if (check.ok) return best;
    problems = check.issues;
  }
  return { ...best, check: { ...best.check, attempts: tries } };
}

const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const bufferDataUri = (buffer, ext) => `data:${MIME[ext] || 'image/png'};base64,${buffer.toString('base64')}`;

/** What's stored with a picture about its check: kept with its url, so a replaced picture's is ignored. */
const checkRecord = (check, url) => (check ? { url, ...check } : null);

/**
 * Generate a reference image (a character sheet or a location's master shot) into the library as
 * `name`, made without other references. Images already named `name` are renamed "(earlier)" and
 * replaced by the new one wherever they're used as a reference. With `forEveryScene`, it's also added
 * to the project-wide references. Resolves with { asset, check }.
 */
export async function generateReferenceImage({ name, prompt, forEveryScene }) {
  const sb = await readStoryboard();
  // Only the style images: a new character or place should be drawn in the video's style.
  const standalone = { scene_id: 'reference', reference_asset_ids: [], use_global_references: false, use_style_references: true };
  const { buffer, ext, model, check } = await generateImageFor(sb, standalone, prompt, null);
  const file = await saveMedia('images', 'reference', ext, buffer);
  const url = mediaPathToUrl(file);
  const asset = await assetRecord({
    file, type: 'image', name: `${name}${path.extname(file)}`,
    extra: { generated: { kind: 'reference', model, prompt }, ...(check && { image_check: checkRecord(check, url) }) },
  });
  const key = (n) => n.replace(/\.[a-z0-9]{2,4}$/i, '').trim().toLowerCase();
  await updateStoryboard((sb) => {
    const older = sb.library.filter((a) => a.type === 'image' && key(a.name) === key(name));
    const swap = (ids = []) => [...new Set(ids.map((id) => (older.some((a) => a.asset_id === id) ? asset.asset_id : id)))];
    for (const a of older) a.name = `${a.name.slice(0, a.name.length - path.extname(a.name).length)} (earlier)${path.extname(a.name)}`;
    sb.library.push(asset);
    sb.settings.reference_asset_ids = swap(sb.settings.reference_asset_ids);
    for (const s of sb.scenes) s.reference_asset_ids = swap(s.reference_asset_ids);
    // Style images keep their captions when the image is replaced.
    const seen = new Set();
    sb.settings.style_references = (sb.settings.style_references || [])
      .map((r) => (older.some((a) => a.asset_id === r.asset_id) ? { ...r, asset_id: asset.asset_id } : r))
      .filter((r) => !seen.has(r.asset_id) && seen.add(r.asset_id));
    if (forEveryScene && !sb.settings.reference_asset_ids.includes(asset.asset_id)) sb.settings.reference_asset_ids.push(asset.asset_id);
  }, { label: `Generate reference "${name}"` });
  return { asset, check };
}

export async function generateSceneImage(sceneId) {
  const sb = await readStoryboard();
  const scene = findScene(sb, sceneId);
  if (!scene.image_prompt.trim()) throw badRequest('This scene has no image prompt');

  const { buffer, ext, model, check } = await generateImageFor(sb, scene, scene.image_prompt.trim(), previousSceneReference(sb, scene));
  const file = await saveMedia('images', scene.scene_id, ext, buffer);
  const media = { file, kind: 'image', type: 'image', prompt: scene.image_prompt.trim(), model };
  return commitGenerated(scene.scene_id, media, (s) => {
    Object.assign(s, CLEAR_VIDEO, { image_url: mediaPathToUrl(file), image_check: checkRecord(check, mediaPathToUrl(file)) });
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
  const { buffer, ext, model, check } = await generateImageFor(sb, scene, shot.image_prompt.trim(), previous);
  const file = await saveMedia('images', scene.scene_id, ext, buffer);
  const media = { file, kind: 'image', type: 'image', prompt: shot.image_prompt.trim(), model };
  return commitGenerated(scene.scene_id, media, (s) => {
    // The shot may have been removed while it was generating; then the image just goes to the library.
    const target = (s.shots || []).find((x) => x.shot_id === shotId);
    if (target) Object.assign(target, { image_url: mediaPathToUrl(file), source_name: null, image_check: checkRecord(check, mediaPathToUrl(file)) });
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
 * image as the scene's visual. Style images: with a first frame (already made in the style) only their
 * captions are sent, since a second image could be taken for the last frame; without one, the images
 * themselves go as style references.
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

  const imagePath = mediaUrlToPath(scene.image_url);
  const image = imagePath ? await referenceDataUri(imagePath) : null;
  const styleImages = styleReferences(sb, scene);
  const captions = styleImages.map((r) => r.caption).filter(Boolean);
  const references = image ? [] : await Promise.all(styleImages.map((r) => referenceDataUri(mediaUrlToPath(r.asset.url))));
  const prompt = [
    references.length &&
      'Use the given images only as style references (medium, linework, colour palette, lighting, rendering). They are not ' +
        'frames of the video: don\'t show them or copy their content.' +
        (captions.length ? ` What to take from each: ${styleImages.map((r, i) => r.caption && `${i + 1}) ${r.caption}`).filter(Boolean).join('; ')}.` : ''),
    scenePrompt,
    settings.style_prompt?.trim(),
    !references.length && captions.length && `Style: ${captions.join('; ')}`,
  ].filter(Boolean).join('. ');
  const params = settings.video_params?.[model] || {};
  const { buffer, usage } = await generateGeminiVideo({ prompt, model, aspectRatio: settings.aspect_ratio, image, references, params });

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
