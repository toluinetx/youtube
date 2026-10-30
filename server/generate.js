import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MEDIA_DIR, mediaPathToUrl, mediaUrlToPath } from './paths.js';
import {
  AMBIENCE_LOOP_SEC, findAmbience, findScene, imageVariantCount, readStoryboard, sceneTimeline, speakerParts, syncCues, updateStoryboard, withoutSpeakers,
} from './storyboard.js';
import { generateImage, referenceCapacity } from './replicate.js';
import { OMNI_TOKENS_PER_SECOND, checkImage, generateGeminiImage, generateGeminiVideo, geminiReferenceCapacity, isGeminiModel } from './gemini.js';
import { comfyReferenceCapacity, generateComfyImage, isComfyModel } from './comfyui.js';
import { recordUsage } from './usage.js';
import { composeMusic, soundEffect, textToSpeech } from './elevenlabs.js';
import { extractThumbnail, joinAudio, probe, probeDuration, referenceDataUri } from './ffmpeg.js';

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
 * the scene and its prompt, e.g. "Scene 3 image - A lone submarine descending into.png". With
 * `variants`, the entry is a stack of pictures ([{ url, image_check }]) and `file` the one in use.
 */
async function commitGenerated(sceneId, { file, kind, type, prompt, model, info, thumbUrl, variants }, mutate, label) {
  const asset = await assetRecord({ file, type, info, thumbUrl, name: '', extra: { generated: { kind, model, prompt }, ...(variants && { variants }) } });
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
 * The project's style images for a scene, with their captions: [{ asset, caption }]. Sent if the
 * scene's `use_style_references` says so ("+ style"), else whenever it uses project references
 * ("+ project refs"), so a scene can keep the style without the project's characters and places.
 */
export function styleReferences(sb, scene) {
  if (!(scene.use_style_references ?? scene.use_global_references !== false)) return [];
  const byId = new Map(sb.library.map((a) => [a.asset_id, a]));
  return (sb.settings.style_references || [])
    .map((r) => ({ asset: byId.get(r.asset_id), caption: r.caption?.trim() || '' }))
    .filter((r) => r.asset?.type === 'image' && mediaUrlToPath(r.asset.url));
}

/** A style image as a reference for generateImagesFor: labelled by its caption, marked `style`. */
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
  const frame = previous?.frame;
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
    frame &&
      `Reference ${n(previous)} is the previous frame of this same shot, a moment earlier. Keep its framing, camera angle, ` +
        'composition, lens, lighting, characters, clothing and setting exactly the same, as if it were the next frame of a film. ' +
        "Change only what the scene below describes, as the next moment of the action. Don't add people, arms or hands that " +
        "the scene below doesn't describe.",
    previous && !frame &&
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

/** Reference images an image model accepts (0 = none, null = no stated limit), from any provider. */
export async function imageReferenceCapacity(model) {
  if (isComfyModel(model)) return comfyReferenceCapacity(model);
  return isGeminiModel(model) ? geminiReferenceCapacity(model) : referenceCapacity(model);
}

/** Which provider an image model id belongs to: 'gemini', 'comfyui' or 'replicate'. */
export const imageProvider = (model) => (isGeminiModel(model) ? 'gemini' : isComfyModel(model) ? 'comfyui' : 'replicate');
const IMAGE_GENERATORS = { gemini: generateGeminiImage, comfyui: generateComfyImage, replicate: generateImage };

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
 * attempt with the fewest problems is kept. With `variants`, makes as many pictures as the project asks
 * for with this model (see imageVariantCount), each checked once instead of retried.
 * Resolves with { model, images: [{ buffer, ext, check }] }, where check is { ok, issues, people, hands,
 * attempts }, { error } if the check itself failed, or null if it's off.
 */
async function generateImagesFor(sb, scene, imagePrompt, previous, { variants = false } = {}) {
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
  /** The prompt and reference images for a list of references. */
  const inputsFor = async (list) => ({
    refs: list,
    basePrompt: list.length
      ? referencePrompt(imagePrompt, style, list, guardrails)
      : // Last, so a model that cuts long prompts short (FLUX) drops it before the scene and the style.
        [imagePrompt, style, guardrails && IMAGE_GUARDRAILS].filter(Boolean).join('. '),
    references: await Promise.all(list.map((r) => referenceDataUri(r.path, r.atSec))),
  });
  const first = await inputsFor(refs);
  // Retries after a failed check leave out the previous shot: a mistake in the picture before (a prop
  // in the wrong place) would otherwise be copied again on every try. A flipbook's previous frame stays,
  // since matching it is the point.
  const withoutPrevious = refs.filter((r) => !r.previous || r.frame);
  let retryInputs = null;
  const params = settings.image_params?.[model] || {};
  const provider = imageProvider(model);
  const generate = IMAGE_GENERATORS[provider];
  const count = variants ? imageVariantCount(settings, model) : 1;
  const checkModel = settings.image_check && hasGeminiKey() ? settings.image_check_model?.trim() : null;
  // Variants are each checked once: picking among them replaces retrying.
  const tries = checkModel && count === 1 ? 1 + Math.min(5, Math.max(0, Math.round(Number(settings.image_check_retries) || 0))) : 1;
  const seeded = params.seed !== undefined && params.seed !== null && params.seed !== '';

  /** One picture; variant `n` > 0 gets the next seed if a seed is set, so they don't all come out the same. */
  async function picture(n) {
    const pictureParams = n && seeded ? { ...params, seed: Number(params.seed) + n } : params;
    let best = null;
    let problems = [];
    for (let attempt = 1; attempt <= tries; attempt++) {
      const retrying = problems.length > 0 && withoutPrevious.length > 0 && withoutPrevious.length < refs.length;
      const { refs: sent, basePrompt, references } = retrying ? (retryInputs ??= await inputsFor(withoutPrevious)) : first;
      const prompt = problems.length
        ? `${basePrompt}\n\nAn earlier attempt at this image was rejected for: ${problems.join(' ')} Make sure this one doesn't have these problems.`
        : basePrompt;
      const { buffer, ext, usage } = await generate({
        prompt, model, aspectRatio: settings.aspect_ratio, references, referenceLabels: sent.map((r) => r.label), params: pictureParams,
      });
      recordUsage({ provider, kind: 'image', model, scene_id: scene.scene_id, units: usage });
      if (!checkModel) return { buffer, ext, check: null };

      let check;
      try {
        const { usage: checkUsage, ...result } = await checkImage({ image: bufferDataUri(buffer, ext), brief: imagePrompt, model: checkModel });
        recordUsage({ provider: 'gemini', kind: 'image check', model: checkModel, scene_id: scene.scene_id, units: checkUsage });
        check = { ...result, attempts: attempt };
      } catch (err) {
        // A check that can't run mustn't lose an image that's already paid for.
        console.warn(`Image check failed: ${err.message}`);
        return { buffer, ext, check: { error: err.message, attempts: attempt } };
      }
      if (!best || check.issues.length < best.check.issues.length) best = { buffer, ext, check };
      if (check.ok) return best;
      problems = check.issues;
    }
    return { ...best, check: { ...best.check, attempts: tries } };
  }

  // All at once: a local ComfyUI queues them, a paid API runs them side by side. Variants that failed
  // are left out, unless they all did.
  const results = await Promise.allSettled(Array.from({ length: count }, (_, n) => picture(n)));
  const images = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!images.length) throw results[0].reason;
  return { model, images };
}

/** Index of the variant to show first: the first that passed its check, else the one with the fewest problems. */
function bestVariant(images) {
  const passed = images.findIndex((i) => i.check?.ok);
  if (passed !== -1) return passed;
  const issues = (i) => (i.check?.issues ? i.check.issues.length : Infinity);
  return images.reduce((best, img, n) => (issues(img) < issues(images[best]) ? n : best), 0);
}

/**
 * Save generated `images` for a scene, then resolve with { file, url, check, variants }: the picture to
 * use and, for more than one, the library's list of them all ([{ url, image_check }]) to pick from.
 */
async function saveImages(sceneId, images) {
  const saved = [];
  for (const { buffer, ext, check } of images) {
    const file = await saveMedia('images', sceneId, ext, buffer);
    const url = mediaPathToUrl(file);
    saved.push({ file, url, check: checkRecord(check, url) });
  }
  const chosen = saved[bestVariant(images)];
  const variants = saved.length > 1 ? saved.map(({ url, check }) => ({ url, image_check: check })) : null;
  return { ...chosen, variants };
}

const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const bufferDataUri = (buffer, ext) => `data:${MIME[ext] || 'image/png'};base64,${buffer.toString('base64')}`;

/** What's stored with a picture about its check: kept with its url, so a replaced picture's is ignored. */
const checkRecord = (check, url) => (check ? { url, ...check } : null);

/**
 * Use another of a library image's variants (`url`) instead of the one it shows now: in the library
 * entry and wherever that picture is used (scenes and shots), as one undo step. Resolves with the entry.
 */
export async function chooseImageVariant(assetId, url) {
  const variantOf = (sb) => {
    const asset = sb.library.find((a) => a.asset_id === assetId);
    if (!asset) throw Object.assign(new Error('No such library item'), { status: 404 });
    const variant = asset.variants?.find((v) => v.url === url);
    if (!variant) throw badRequest("That picture isn't one of this item's variants");
    return { asset, variant };
  };
  variantOf(await readStoryboard());
  const size = (await fs.stat(mediaUrlToPath(url))).size;
  return updateStoryboard((sb) => {
    const { asset, variant } = variantOf(sb);
    const old = asset.url;
    if (old === url) return asset;
    Object.assign(asset, { url, thumb_url: url, size_bytes: size });
    const swap = (slot) => {
      if (slot.image_url === old) Object.assign(slot, { image_url: url, image_check: variant.image_check ?? null });
    };
    for (const s of sb.scenes) {
      swap(s);
      for (const shot of s.shots || []) swap(shot);
    }
    return asset;
  }, { label: 'Choose image variant' });
}

/**
 * Generate a reference image (a character sheet or a location's master shot) into the library as
 * `name`, made without other references, or from `basedOn` (library image ids): the same character
 * or place seen from another angle. Images already named `name` are renamed "(earlier)" and
 * replaced by the new one wherever they're used as a reference. With `forEveryScene`, it's also added
 * to the project-wide references. Resolves with { asset, check }.
 */
export async function generateReferenceImage({ name, prompt, forEveryScene, basedOn = [] }) {
  const sb = await readStoryboard();
  // The style images (a new character or place is drawn in the video's style), plus the references it's based on.
  const standalone = { scene_id: 'reference', reference_asset_ids: basedOn, use_global_references: false, use_style_references: true };
  const { model, images: [{ buffer, ext, check }] } = await generateImagesFor(sb, standalone, prompt, null);
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

  const { model, images } = await generateImagesFor(sb, scene, scene.image_prompt.trim(), previousSceneReference(sb, scene), { variants: true });
  const { file, url, check, variants } = await saveImages(scene.scene_id, images);
  const media = { file, kind: 'image', type: 'image', prompt: scene.image_prompt.trim(), model, variants };
  return commitGenerated(scene.scene_id, media, (s) => {
    Object.assign(s, CLEAR_VIDEO, { image_url: url, image_check: check });
    setSourceName(s, 'image', null);
  }, 'Generate image');
}

const CONTEXT_CHARS = 600;
const withoutTags = (text) => withoutSpeakers(text).replace(/\[[^\]\n]{1,60}\]/g, ' ').replace(/\s+/g, ' ').trim();

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

/** Silence between two speakers' parts of one voiceover. */
const SPEAKER_GAP_SEC = 0.25;

/** The ElevenLabs voice for a speaker label (null = the narrator). */
function voiceFor(settings, speaker) {
  if (!speaker) return settings.voice_id;
  const voice = (settings.voices || []).find((v) => v.name.toLowerCase() === speaker.toLowerCase());
  if (voice?.voice_id) return voice.voice_id;
  if (speaker.toLowerCase() === 'narrator') return settings.voice_id;
  throw badRequest(`No voice for "{${speaker}}". Add a speaker named ${speaker} under Voice in the Project panel (left).`);
}

/**
 * Speak a voiceover line, each part in its speaker's voice ("{Eli} …"), joined with a short gap.
 * Resolves with { buffer, words }, the word times running across the whole line.
 */
async function speakLine(settings, scenes, scene, text) {
  const parts = speakerParts(text).map((p) => ({ ...p, voiceId: voiceFor(settings, p.speaker) }));
  if (!parts.length) throw badRequest('This scene has no voiceover text');
  // The neighbouring narration is sent as context, so tone and pace carry across scenes (and parts).
  const context = narrationContext(scenes, scene);
  const spoken = [];
  for (const [i, part] of parts.entries()) {
    const { buffer, usage, words } = await textToSpeech({
      text: part.text, voiceId: part.voiceId, modelId: settings.tts_model, params: settings.tts_params,
      previousText: i ? withoutTags(parts.slice(0, i).map((p) => p.text).join(' ')) : context.previousText,
      nextText: i < parts.length - 1 ? withoutTags(parts[i + 1].text) : context.nextText,
    });
    recordUsage({
      provider: 'elevenlabs', kind: 'voiceover', model: settings.tts_model, scene_id: scene.scene_id,
      units: { ...usage, characters: part.text.length, ...(part.speaker && { speaker: part.speaker }) },
    });
    spoken.push({ buffer, words });
  }
  if (spoken.length === 1) return spoken[0];

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voiceover-'));
  try {
    const files = [];
    for (const [i, { buffer }] of spoken.entries()) {
      files.push(path.join(dir, `part-${i}.mp3`));
      await fs.writeFile(files[i], buffer);
    }
    // Each part's words move along by the length of the parts (and gaps) before it.
    const words = [];
    let offset = 0;
    for (const [i, part] of spoken.entries()) {
      if (part.words) words.push(...part.words.map((w) => ({ ...w, start: round2(w.start + offset), end: round2(w.end + offset) })));
      offset += (await probeDuration(files[i])) + SPEAKER_GAP_SEC;
    }
    const joined = path.join(dir, 'joined.mp3');
    await joinAudio(files, SPEAKER_GAP_SEC, joined);
    return { buffer: await fs.readFile(joined), words: spoken.every((p) => p.words) ? words : null };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const round2 = (n) => Math.round(n * 100) / 100;

export async function generateSceneVoiceover(sceneId) {
  const { settings, scenes } = await readStoryboard();
  const scene = findScene({ scenes }, sceneId);
  if (!scene.voiceover_text.trim()) throw badRequest('This scene has no voiceover text');

  const text = scene.voiceover_text.trim();
  const { buffer, words } = await speakLine(settings, scenes, scene, text);
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
  // A flipbook frame always gets the frame before. Another shot gets the picture before it unless the
  // scene doesn't send previous pictures ("+ previous scene" off): models that copy their references
  // closely (Qwen Edit) would otherwise repeat its people and framing.
  const previous = before && (shot.continues
    ? { label: 'Previous frame (this same shot a moment earlier)', ...before, frame: true }
    : scene.use_previous_scene !== false ? { label: 'Previous shot (the picture just before this one)', ...before } : null);
  // With its own references, the shot is made as if the scene had those.
  const asScene = shot.reference_asset_ids ? { ...scene, reference_asset_ids: shot.reference_asset_ids } : scene;
  const { model, images } = await generateImagesFor(sb, asScene, shot.image_prompt.trim(), previous, { variants: true });
  const { file, url, check, variants } = await saveImages(scene.scene_id, images);
  const media = { file, kind: 'image', type: 'image', prompt: shot.image_prompt.trim(), model, variants };
  return commitGenerated(scene.scene_id, media, (s) => {
    // The shot may have been removed while it was generating; then the image just goes to the library.
    const target = (s.shots || []).find((x) => x.shot_id === shotId);
    if (target) Object.assign(target, { image_url: url, source_name: null, image_check: check });
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

/**
 * Generate the video's background music from the project's music prompt (ElevenLabs Music,
 * instrumental). It goes into the library and becomes the music track. Resolves with the settings.
 */
export async function generateMusic() {
  const { settings } = await readStoryboard();
  const prompt = settings.music_prompt?.trim();
  if (!prompt) throw badRequest('Write a music prompt first');
  const model = settings.music_model || 'music_v1';
  const { buffer, usage } = await composeMusic({ prompt, lengthSec: Number(settings.music_length_sec) || 180, modelId: model });
  recordUsage({ provider: 'elevenlabs', kind: 'music', model, units: { ...usage, seconds: Number(settings.music_length_sec) || null } });
  const file = mediaFilePath('music', 'music', 'mp3');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  const duration = await probeDuration(file);
  const words = firstWords(prompt);
  const asset = await assetRecord({
    file, type: 'audio', name: `Music${words ? ` - ${words}` : ''}.mp3`, info: { duration, hasAudio: true },
    extra: { generated: { kind: 'music', model, prompt } },
  });
  const sb = await updateStoryboard((sb) => {
    sb.library.push(asset);
    Object.assign(sb.settings, { music_url: asset.url, music_name: asset.name, music_duration_sec: duration });
  }, { label: 'Generate music' });
  return sb.settings;
}

/**
 * Generate an ambience bed's sound: a seamless loop (ElevenLabs sound effects with `loop`) of
 * AMBIENCE_LOOP_SEC seconds from its prompt, also added to the library. Resolves with the bed.
 */
export async function generateAmbience(ambienceId) {
  const { settings, ...sb } = await readStoryboard();
  const bed = findAmbience(sb, ambienceId);
  const prompt = bed.prompt.trim();
  if (!prompt) throw badRequest(`Ambience "${bed.name || 'untitled'}" has no prompt`);
  const { buffer, usage } = await soundEffect({
    text: prompt, durationSec: AMBIENCE_LOOP_SEC, modelId: settings.sfx_model, params: { ...settings.sfx_params, auto_duration: false, loop: true },
  });
  recordUsage({ provider: 'elevenlabs', kind: 'ambience', model: settings.sfx_model, units: usage });
  const file = mediaFilePath('sfx', 'ambience', 'mp3');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  const duration = await probeDuration(file);
  const asset = await assetRecord({
    file, type: 'audio', name: `Ambience - ${(bed.name || firstWords(prompt)).replace(/[\\/:*?"<>|]/g, '')}.mp3`, info: { duration, hasAudio: true },
    extra: { generated: { kind: 'ambience', model: settings.sfx_model, prompt } },
  });
  return updateStoryboard((sb) => {
    sb.library.push(asset);
    // The bed may have been deleted while it was generating; then the sound just goes to the library.
    const target = sb.ambience.find((a) => a.ambience_id === ambienceId);
    if (target) Object.assign(target, { url: asset.url, duration_sec: duration, source_name: null });
    return target ?? null;
  }, { label: `Generate ambience "${bed.name || 'untitled'}"` });
}

export { setSourceName };

export const GENERATORS = {
  image: { fn: generateSceneImage, has: (s) => s.image_url || s.video_url, prompt: 'image_prompt', label: 'image' },
  voiceover: { fn: generateSceneVoiceover, has: (s) => s.voiceover_url, prompt: 'voiceover_text', label: 'voiceover' },
  sfx: { fn: generateSceneSfx, has: (s) => s.sfx_url, prompt: 'sfx_prompt', label: 'sound effect' },
};
