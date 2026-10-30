import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { mediaPathToUrl, mediaUrlToPath } from './paths.js';
import { findAmbience, findScene, newScene, nextSceneId, readStoryboard, syncCues, updateStoryboard } from './storyboard.js';
import { extractFrame, extractThumbnail, probe } from './ffmpeg.js';
import {
  CLEAR_IMAGE, CLEAR_VIDEO, assetRecord, badRequest, commitScene, findShot, findSfxLayer, fitToVoiceover, mediaFilePath, setSourceName,
} from './generate.js';

export const EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'],
};

/** Which asset types each slot accepts. Video works anywhere sound is wanted (its soundtrack is used). */
const SLOT_TYPES = { image: ['image', 'video'], voiceover: ['audio', 'video'], sfx: ['audio', 'video'], music: ['audio', 'video'] };

export function fileType(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const type = Object.keys(EXTENSIONS).find((t) => EXTENSIONS[t].includes(ext));
  return { ext, type };
}

const notFound = (message) => Object.assign(new Error(message), { status: 404 });

// ---- Library -----------------------------------------------------------------------------------
// Uploaded files live in media/library/; scenes and the music track merely reference them. A file is
// deleted once it has left the library and no undo step refers to it.

/**
 * Stream the raw request body into the library. The client sends the file as the body with its
 * original name in the X-Filename header (URI-encoded).
 */
export async function addToLibrary(req) {
  const name = decodeURIComponent(req.get('X-Filename') || '').trim();
  if (!name) throw badRequest('Missing X-Filename header');
  const { ext, type } = fileType(name);
  if (!type) throw badRequest(`"${name}" isn't a supported file. Use images (${EXTENSIONS.image.join(', ')}), video (${EXTENSIONS.video.join(', ')}) or audio (${EXTENSIONS.audio.join(', ')}).`);

  const file = mediaFilePath(`library/${type}`, 'asset', ext);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const thumb = file.replace(/\.[^.]+$/, '.thumb.jpg');
  try {
    await pipeline(req, fs.createWriteStream(file));
    const { size } = await fsp.stat(file);
    if (size === 0) throw badRequest(`"${name}" is empty`);
    const info = await probe(file).catch(() => null);
    if (!info || (type === 'audio' ? !info.hasAudio : !info.hasVideo)) throw badRequest(`Couldn't read "${name}". Is it a valid ${type} file?`);

    return await registerAsset({ file, name, type, info, size });
  } catch (err) {
    await Promise.all([fsp.rm(file, { force: true }), fsp.rm(thumb, { force: true })]);
    throw err;
  }
}

/** Add a file that's already in media/library/ to the library list. */
async function registerAsset({ file, name, type, info, size, extra }) {
  let thumbUrl = type === 'image' ? mediaPathToUrl(file) : null;
  if (type === 'video') {
    const thumb = file.replace(/\.[^.]+$/, '.thumb.jpg');
    await extractThumbnail(file, thumb, Math.min(0.5, (info.duration || 0) / 2)).catch(() => {});
    if (fs.existsSync(thumb)) thumbUrl = mediaPathToUrl(thumb);
  }
  const asset = await assetRecord({ file, name, type, info, thumbUrl, size, extra });
  await updateStoryboard((sb) => {
    sb.library.push(asset);
  }, { label: `Add "${name}" to the library` });
  return asset;
}

const stripExt = (name) => name.replace(/\.[^.]+$/, '');
const stamp = (sec) => {
  const m = Math.floor(sec / 60);
  return `${m}m${(sec - m * 60).toFixed(1).padStart(4, '0')}s`;
};

/** Save a frame of a library video as a new library image (e.g. to use as a reference). */
export async function snapshotAsset(assetId, timeSec) {
  const { library } = await readStoryboard();
  const video = findAsset({ library }, assetId);
  if (video.type !== 'video') throw badRequest(`"${video.name}" isn't a video`);
  const t = Math.max(0, Math.min(Number(timeSec) || 0, Math.max(0, (video.duration_sec || 0) - 0.05)));
  const file = mediaFilePath('library/image', 'snapshot', 'jpg');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await extractFrame(mediaUrlToPath(video.url), file, t);
    return await registerAsset({
      file,
      name: `${stripExt(video.name)} @ ${stamp(t)}.jpg`,
      type: 'image',
      info: { hasAudio: false },
      extra: { source: { asset_id: video.asset_id, time_sec: t } },
    });
  } catch (err) {
    await fsp.rm(file, { force: true });
    throw err;
  }
}

/** Copy a scene's generated image (or the current frame of its video) into the library. */
export async function saveSceneVisualToLibrary(sceneId) {
  const sb = await readStoryboard();
  const scene = findScene(sb, sceneId);
  const n = sb.scenes.indexOf(scene) + 1;
  if (scene.video_url) {
    const video = sb.library.find((a) => a.url === scene.video_url);
    if (video) return snapshotAsset(video.asset_id, scene.video_start_sec || 0);
  }
  const source = mediaUrlToPath(scene.image_url);
  if (!source || !fs.existsSync(source)) throw badRequest('This scene has no image to save');
  const existing = sb.library.find((a) => a.url === scene.image_url);
  if (existing) return existing;
  const ext = path.extname(source).slice(1) || 'png';
  const file = mediaFilePath('library/image', 'scene', ext);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.copyFile(source, file);
  const label = scene.image_prompt.trim().split(/\s+/).slice(0, 5).join(' ') || 'image';
  return registerAsset({ file, name: `Scene ${n} - ${label}.${ext}`, type: 'image', info: { hasAudio: false } });
}

export function renameAsset(assetId, name) {
  const clean = String(name || '').trim().slice(0, 120);
  if (!clean) throw badRequest('Name cannot be empty');
  return updateStoryboard((sb) => {
    const asset = findAsset(sb, assetId);
    asset.name = clean;
    for (const s of sb.scenes) {
      for (const slot of Object.keys(s.source_names || {})) {
        const url = slot === 'image' ? s.image_url || s.video_url : s[`${slot}_url`];
        if (url === asset.url) s.source_names[slot] = clean;
      }
      for (const l of s.sfx_layers || []) if (l.url === asset.url) l.source_name = clean;
      for (const shot of s.shots || []) if (shot.image_url === asset.url) shot.source_name = clean;
    }
    if (sb.settings.music_url === asset.url) sb.settings.music_name = clean;
    return asset;
  }, { label: `Rename "${clean}"` });
}

function findAsset(sb, assetId) {
  const asset = sb.library.find((a) => a.asset_id === assetId);
  if (!asset) throw notFound(`Asset ${assetId} not found in the library`);
  return asset;
}

/** Every place an asset is used: scene slots, scene / project references, and the music track. */
function usagesOf(sb, asset) {
  const uses = [];
  for (const s of sb.scenes) {
    if (s.image_url === asset.url || s.video_url === asset.url) uses.push({ scene_id: s.scene_id, slot: 'image' });
    if (s.voiceover_url === asset.url) uses.push({ scene_id: s.scene_id, slot: 'voiceover' });
    if (s.sfx_url === asset.url) uses.push({ scene_id: s.scene_id, slot: 'sfx' });
    for (const l of s.sfx_layers || []) if (l.url === asset.url) uses.push({ scene_id: s.scene_id, slot: 'sfx_layer', layer_id: l.layer_id });
    for (const shot of s.shots || []) {
      if (shot.image_url === asset.url) uses.push({ scene_id: s.scene_id, slot: 'shot', shot_id: shot.shot_id });
      if (shot.reference_asset_ids?.includes(asset.asset_id)) uses.push({ scene_id: s.scene_id, slot: 'shot_reference', shot_id: shot.shot_id });
    }
    if (s.reference_asset_ids?.includes(asset.asset_id)) uses.push({ scene_id: s.scene_id, slot: 'reference' });
  }
  if (sb.settings.music_url === asset.url) uses.push({ slot: 'music' });
  for (const bed of sb.ambience || []) if (bed.url === asset.url) uses.push({ slot: 'ambience', ambience_id: bed.ambience_id });
  if (sb.settings.reference_asset_ids?.includes(asset.asset_id)) uses.push({ slot: 'project_reference' });
  if (sb.settings.style_references?.some((r) => r.asset_id === asset.asset_id)) uses.push({ slot: 'style_reference' });
  return uses;
}

const CLEAR_SLOT = {
  image: { ...CLEAR_IMAGE, ...CLEAR_VIDEO },
  voiceover: { voiceover_url: null, voiceover_duration_sec: null, voiceover_words: null },
  sfx: { sfx_url: null, sfx_duration_sec: null },
};
const CLEAR_MUSIC = { music_url: null, music_name: null, music_duration_sec: null };

/**
 * Remove an asset from the library. If it's in use, refuses with 409 unless `force`,
 * in which case it's removed from those scenes / the music track first.
 */
export function deleteAsset(assetId, force) {
  return updateStoryboard((sb) => {
    const a = findAsset(sb, assetId);
    const uses = usagesOf(sb, a);
    if (uses.length && !force) {
      throw Object.assign(new Error(`"${a.name}" is used in ${uses.length} place(s)`), { status: 409, uses });
    }
    for (const use of uses) {
      if (use.slot === 'music') Object.assign(sb.settings, CLEAR_MUSIC);
      // The bed keeps its prompt and its scenes, so it can be generated again.
      else if (use.slot === 'ambience') Object.assign(findAmbience(sb, use.ambience_id), { url: null, duration_sec: null, source_name: null });
      else if (use.slot === 'project_reference') {
        sb.settings.reference_asset_ids = sb.settings.reference_asset_ids.filter((id) => id !== a.asset_id);
      } else if (use.slot === 'style_reference') {
        sb.settings.style_references = sb.settings.style_references.filter((r) => r.asset_id !== a.asset_id);
      } else if (use.slot === 'sfx_layer') {
        // The layer keeps its prompt, so it can be generated again.
        const layer = findSfxLayer(findScene(sb, use.scene_id), use.layer_id);
        Object.assign(layer, { url: null, duration_sec: null, source_name: null });
      } else if (use.slot === 'shot') {
        // The shot keeps its prompt and timing, so it can be generated again.
        Object.assign(findShot(findScene(sb, use.scene_id), use.shot_id), { image_url: null, source_name: null });
      } else if (use.slot === 'shot_reference') {
        const shot = findShot(findScene(sb, use.scene_id), use.shot_id);
        shot.reference_asset_ids = shot.reference_asset_ids.filter((id) => id !== a.asset_id);
      } else if (use.slot === 'reference') {
        const scene = findScene(sb, use.scene_id);
        scene.reference_asset_ids = scene.reference_asset_ids.filter((id) => id !== a.asset_id);
      } else {
        const scene = findScene(sb, use.scene_id);
        Object.assign(scene, CLEAR_SLOT[use.slot]);
        setSourceName(scene, use.slot, null);
      }
    }
    sb.library = sb.library.filter((x) => x !== a);
    return a;
  }, { label: 'Delete from library' });
}

// ---- Using library assets ----------------------------------------------------------------------

function checkSlot(asset, slot) {
  if (!SLOT_TYPES[slot]) throw badRequest(`Unknown slot "${slot}"`);
  if (!SLOT_TYPES[slot].includes(asset.type)) {
    const what = { image: 'an image or video', voiceover: 'audio', sfx: 'audio', music: 'audio' }[slot];
    throw badRequest(`"${asset.name}" is ${asset.type}; this slot needs ${what}`);
  }
  if (slot !== 'image' && !asset.has_audio) throw badRequest(`"${asset.name}" has no sound`);
}

const roundDuration = (d) => Math.min(600, Math.max(0.5, Math.round(d * 10) / 10));

function visualPatch(asset) {
  if (asset.type === 'image') return { ...CLEAR_VIDEO, image_url: asset.url };
  return {
    ...CLEAR_IMAGE,
    video_url: asset.url,
    video_thumb_url: asset.thumb_url,
    video_duration_sec: asset.duration_sec,
    video_has_audio: asset.has_audio,
    video_start_sec: 0,
  };
}

/**
 * Put a library asset into one slot of a scene (image | voiceover | sfx). With `layerId`, a sound goes
 * into that extra sound effect layer instead of the main one; with `shotId`, an image becomes that
 * extra shot's picture. Resolves with the scene.
 */
export async function useAssetInScene(sceneId, assetId, slot, { layerId, shotId } = {}) {
  let asset;
  await updateStoryboard((sb) => {
    asset = findAsset(sb, assetId);
    checkSlot(asset, slot);
    const scene = findScene(sb, sceneId);
    if (layerId) findSfxLayer(scene, layerId);
    if (shotId) {
      findShot(scene, shotId);
      if (asset.type !== 'image') throw badRequest(`"${asset.name}" is a ${asset.type}; a shot needs an image`);
    }
  });
  return commitScene(sceneId, (s) => {
    if (layerId) {
      Object.assign(findSfxLayer(s, layerId), { url: asset.url, duration_sec: asset.duration_sec, source_name: asset.name });
      return;
    }
    if (shotId) {
      Object.assign(findShot(s, shotId), { image_url: asset.url, source_name: asset.name });
      return;
    }
    if (slot === 'image') {
      Object.assign(s, visualPatch(asset));
      if (asset.type === 'video' && asset.duration_sec) s.duration_sec = roundDuration(asset.duration_sec);
    } else {
      s[`${slot}_url`] = asset.url;
      s[`${slot}_duration_sec`] = asset.duration_sec;
      // An imported recording has no word timings: synced sounds go back to estimated times.
      if (slot === 'voiceover') {
        s.voiceover_words = null;
        syncCues(s);
      }
    }
    fitToVoiceover(s); // never cut narration off; a short clip holds its last frame instead
    setSourceName(s, slot, asset.name);
  }, `Use "${asset.name}"`);
}

/** Create a new scene at `index` (default: end) whose visual is an image or video asset. */
export function sceneFromAsset(assetId, index) {
  return updateStoryboard((sb) => {
    const asset = findAsset(sb, assetId);
    checkSlot(asset, 'image');
    const scene = newScene(nextSceneId(sb), {
      ...visualPatch(asset),
      duration_sec: asset.type === 'video' && asset.duration_sec ? roundDuration(asset.duration_sec) : 5,
      source_names: { image: asset.name },
    });
    const i = Number.isInteger(index) ? Math.max(0, Math.min(index, sb.scenes.length)) : sb.scenes.length;
    sb.scenes.splice(i, 0, scene);
    return scene;
  }, { label: `Add scene from "${asset.name}"` });
}

async function setMusic(apply, label) {
  const sb = await updateStoryboard(apply, { label });
  return sb.settings;
}

export function musicFromAsset(assetId) {
  return setMusic((sb) => {
    const asset = findAsset(sb, assetId);
    checkSlot(asset, 'music');
    Object.assign(sb.settings, { music_url: asset.url, music_name: asset.name, music_duration_sec: asset.duration_sec });
  }, 'Set music');
}

/** Use a library sound as an ambience bed's loop. Resolves with the bed. */
export function ambienceFromAsset(ambienceId, assetId) {
  return updateStoryboard((sb) => {
    const asset = findAsset(sb, assetId);
    checkSlot(asset, 'music');
    const bed = findAmbience(sb, ambienceId);
    Object.assign(bed, { url: asset.url, duration_sec: asset.duration_sec, source_name: asset.name });
    return bed;
  }, { label: 'Set ambience sound' });
}

export function removeMusic() {
  return setMusic((sb) => void Object.assign(sb.settings, CLEAR_MUSIC), 'Remove music');
}

/** Remove one slot's media from a scene. Library files stay in the library. */
export function clearSceneSlot(sceneId, slot) {
  if (!CLEAR_SLOT[slot]) throw badRequest(`Unknown slot "${slot}"`);
  return commitScene(sceneId, (s) => {
    Object.assign(s, CLEAR_SLOT[slot]);
    setSourceName(s, slot, null);
    if (slot === 'voiceover') syncCues(s);
  }, `Remove ${{ image: 'image', voiceover: 'voiceover', sfx: 'sound effect' }[slot]}`);
}
