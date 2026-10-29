import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { CLIENT_DIST, EXPORTS_DIR, MEDIA_DIR, PROJECT_ID } from './paths.js';
import {
  DEFAULT_SETTINGS, MAX_SHOTS, MOTIONS, READONLY_SETTINGS, RESOLUTIONS, SCENE_TEXT_FIELDS, SFX_LAYER_EDITABLE, SHOT_EDITABLE, findScene,
  newShot, newSfxLayer, syncCues, newScene, nextSceneId, readStoryboard, redo, undo,
  updateStoryboard,
} from './storyboard.js';
import { historyState } from './history.js';
import { requestContext, subscribe } from './events.js';
import { createProject, initProjects, listProjects, openProject, trackBusy } from './projects.js';
import {
  GENERATORS, generateReferenceImage, generateSceneShotImage, generateSceneSfxLayer, generateSceneVideo, imageReferenceCapacity,
} from './generate.js';
import { CAPTION_MODES, CAPTION_POSITIONS, LOOKS, SHAKES } from './finish.js';
import {
  addToLibrary, clearSceneSlot, deleteAsset, musicFromAsset, removeMusic, renameAsset, saveSceneVisualToLibrary, sceneFromAsset,
  snapshotAsset, useAssetInScene,
} from './uploads.js';
import { listImageModels, modelParams } from './replicate.js';
import { geminiParams, isGeminiModel, listGeminiModels } from './gemini.js';
import { generationPlan, getJob, startExport, startGenerateMissing } from './jobs.js';
import { listModels, listVoices } from './elevenlabs.js';
import { readPreferences, setStarred } from './preferences.js';
import { accountBalances, setPrice, usageReport } from './usage.js';
import { FFMPEG } from './ffmpeg.js';

const PORT = Number(process.env.PORT) || 3001;
const app = express();
app.use(express.json({ limit: '2mb' }));

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// Remember which browser tab made the request (X-Client), so change events can name their origin.
app.use('/api', (req, _res, next) => requestContext.run({ client: req.get('X-Client') || null }, next));

// Every API response names the open project and says what undo / redo would do next, so the client
// notices a project switch and its undo buttons stay current.
app.use('/api', (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    res.set('X-Project', PROJECT_ID);
    res.set('X-History', encodeURIComponent(JSON.stringify(historyState())));
    return json(body);
  };
  next();
});

// A change sent for a project that's no longer open (X-Project) is refused rather than applied to
// whichever project is open now.
app.use('/api', (req, res, next) => {
  const project = req.get('X-Project');
  if (req.method === 'GET' || req.path.startsWith('/projects') || !project || project === PROJECT_ID) return next();
  res.status(409).json({ error: `Project "${project}" is no longer open`, project_changed: true });
});

app.use('/api', trackBusy);

function sanitizeAssetIds(value, field) {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw badRequest(`${field} must be a list of asset ids`);
  return [...new Set(value)].slice(0, 14);
}

function sanitizeScenePatch(body) {
  const patch = {};
  for (const f of SCENE_TEXT_FIELDS) if (typeof body[f] === 'string') patch[f] = body[f];
  if (body.duration_sec !== undefined) {
    const d = Number(body.duration_sec);
    if (!Number.isFinite(d) || d < 0.5 || d > 600) throw badRequest('duration_sec must be between 0.5 and 600');
    patch.duration_sec = Math.round(d * 10) / 10;
  }
  if (body.video_start_sec !== undefined) {
    const v = Number(body.video_start_sec);
    if (!Number.isFinite(v) || v < 0) throw badRequest('video_start_sec must be 0 or more');
    patch.video_start_sec = Math.round(v * 10) / 10;
  }
  if (body.reference_asset_ids !== undefined) patch.reference_asset_ids = sanitizeAssetIds(body.reference_asset_ids, 'reference_asset_ids');
  if (body.use_global_references !== undefined) patch.use_global_references = Boolean(body.use_global_references);
  if (body.use_previous_scene !== undefined) patch.use_previous_scene = Boolean(body.use_previous_scene);
  if (body.notes !== undefined) patch.notes = String(body.notes).slice(0, 2000);
  if (typeof body.video_prompt === 'string') patch.video_prompt = body.video_prompt;
  if (body.sfx_layers !== undefined) patch.sfx_layers = sanitizeSfxLayers(body.sfx_layers);
  if (body.shots !== undefined) patch.shots = sanitizeShots(body.shots);
  if (body.motion !== undefined) {
    if (body.motion !== null && !MOTIONS.includes(body.motion)) throw badRequest(`motion must be null or one of ${MOTIONS.join(', ')}`);
    patch.motion = body.motion;
  }
  if (body.shake !== undefined) {
    if (body.shake !== null && !SHAKES[body.shake]) throw badRequest(`shake must be null or one of ${Object.keys(SHAKES).join(', ')}`);
    patch.shake = body.shake;
  }
  if (body.title_text !== undefined) patch.title_text = String(body.title_text ?? '').slice(0, 80);
  if (body.video_volume !== undefined) {
    const v = Number(body.video_volume);
    if (!Number.isFinite(v) || v < 0 || v > 2) throw badRequest('video_volume must be between 0 and 2');
    patch.video_volume = v;
  }
  return patch;
}

const LAYER_ID = /^l_[\w-]{1,24}$/;

/**
 * Sound effect layers as sent by the client: only the editable fields are taken (see
 * applyScenePatch), and new layers without an id get one.
 */
function sanitizeSfxLayers(value) {
  if (!Array.isArray(value)) throw badRequest('sfx_layers must be a list');
  if (value.length > 12) throw badRequest('At most 12 extra sound effects per scene');
  return value.map((l, i) => {
    if (!l || typeof l !== 'object') throw badRequest(`sfx_layers[${i}] must be an object`);
    const layer = newSfxLayer(LAYER_ID.test(l.layer_id) ? { layer_id: l.layer_id } : {});
    if (l.prompt !== undefined) layer.prompt = String(l.prompt).slice(0, 2000);
    if (l.volume !== undefined) {
      const v = Number(l.volume);
      if (!Number.isFinite(v) || v < 0 || v > 2) throw badRequest(`sfx_layers[${i}].volume must be between 0 and 2`);
      layer.volume = v;
    }
    if (l.start_sec !== undefined) {
      const t = Number(l.start_sec);
      if (!Number.isFinite(t) || t < 0 || t > 600) throw badRequest(`sfx_layers[${i}].start_sec must be between 0 and 600`);
      layer.start_sec = Math.round(t * 100) / 100;
    }
    if (l.length_sec !== undefined && l.length_sec !== null && l.length_sec !== '') {
      const d = Number(l.length_sec);
      if (!Number.isFinite(d) || d < 0.5 || d > 30) throw badRequest(`sfx_layers[${i}].length_sec must be between 0.5 and 30`);
      layer.length_sec = Math.round(d * 10) / 10;
    }
    if (typeof l.cue === 'string' && l.cue.trim()) layer.cue = l.cue.trim().slice(0, 200);
    return layer;
  });
}

const SHOT_ID = /^s_[\w-]{1,24}$/;

/** Shots as sent by the client: only the editable fields are taken (see applyScenePatch). */
function sanitizeShots(value) {
  if (!Array.isArray(value)) throw badRequest('shots must be a list');
  if (value.length > MAX_SHOTS - 1) throw badRequest(`At most ${MAX_SHOTS} pictures per scene (the scene's own and ${MAX_SHOTS - 1} shots)`);
  return value.map((s, i) => {
    if (!s || typeof s !== 'object') throw badRequest(`shots[${i}] must be an object`);
    const shot = newShot(SHOT_ID.test(s.shot_id) ? { shot_id: s.shot_id } : {});
    if (s.image_prompt !== undefined) shot.image_prompt = String(s.image_prompt).slice(0, 4000);
    if (s.motion !== undefined && s.motion !== null) {
      if (!MOTIONS.includes(s.motion)) throw badRequest(`shots[${i}].motion must be null or one of ${MOTIONS.join(', ')}`);
      shot.motion = s.motion;
    }
    if (s.start_sec !== undefined) {
      const t = Number(s.start_sec);
      if (!Number.isFinite(t) || t < 0 || t > 600) throw badRequest(`shots[${i}].start_sec must be between 0 and 600`);
      shot.start_sec = Math.round(t * 100) / 100;
    }
    if (typeof s.cue === 'string' && s.cue.trim()) shot.cue = s.cue.trim().slice(0, 200);
    return shot;
  });
}

/** Merge items by id: the client's list and editable fields, the server's media for items it has. */
function mergeById(current = [], incoming, idKey, editable) {
  const byId = new Map(current.map((x) => [x[idKey], x]));
  return incoming.map((x) => {
    const existing = byId.get(x[idKey]);
    return existing ? { ...existing, ...Object.fromEntries(editable.map((k) => [k, x[k]])) } : x;
  });
}

/**
 * Apply a sanitized patch to a scene. Sound effect layers and shots are merged by id: the client
 * decides which exist, their order and their editable fields, but their audio or picture is kept from
 * the server so an edit sent while it was generating can't wipe the result.
 */
function applyScenePatch(scene, { sfx_layers, shots, ...patch }) {
  Object.assign(scene, patch);
  if (sfx_layers) scene.sfx_layers = mergeById(scene.sfx_layers, sfx_layers, 'layer_id', SFX_LAYER_EDITABLE);
  if (shots) scene.shots = mergeById(scene.shots, shots, 'shot_id', SHOT_EDITABLE);
  // Sounds synced to words follow the narration (exact once the voiceover is generated).
  return syncCues(scene);
}

const EDIT_LABELS = {
  image_prompt: 'Edit image prompt',
  voiceover_text: 'Edit voiceover text',
  sfx_prompt: 'Edit sound effect prompt',
  duration_sec: 'Change duration',
  video_start_sec: 'Trim video',
  video_volume: 'Change clip volume',
  notes: 'Edit notes',
  video_prompt: 'Edit video prompt',
  motion: 'Change motion',
  shake: 'Change shake',
  title_text: 'Edit on-screen text',
  sfx_layers: 'Edit sound effects',
  shots: 'Edit shots',
  reference_asset_ids: 'Change references',
  use_global_references: 'Change references',
  use_previous_scene: 'Change references',
};

/** Undo label + merge key for a scene edit: successive edits of the same fields of one scene merge. */
function sceneEditHistory(id, patch) {
  const fields = Object.keys(patch).sort();
  return { label: EDIT_LABELS[fields[0]] || 'Edit scene', key: `scene:${id}:${fields.join(',')}` };
}

/** Turn a pasted script into scenes: one per paragraph, with optional [image: …] and [sfx: …] tags. */
function parseScript(script) {
  return script
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para) => {
      let image = '';
      let sfx = '';
      const text = para
        .replace(/\[(image|img|sfx|sound)\s*:\s*([^\]]*)\]/gi, (_, tag, value) => {
          if (/^i/i.test(tag)) image = value.trim();
          else sfx = value.trim();
          return '';
        })
        .replace(/\s+/g, ' ')
        .trim();
      const words = text ? text.split(' ').length : 0;
      return {
        voiceover_text: text,
        image_prompt: image || text,
        sfx_prompt: sfx,
        duration_sec: Math.max(3, Math.ceil((words / 2.6 + 1) * 2) / 2),
      };
    });
}

// ---- Projects ---------------------------------------------------------------------------------

app.get('/api/projects', async (_req, res) => res.json({ open: PROJECT_ID, projects: await listProjects() }));

// { title, open? }: create an empty project, and open it if `open` is true.
app.post('/api/projects', async (req, res) => {
  const project = await createProject(req.body.title);
  if (req.body.open) await openProject(project.id);
  res.status(201).json({ ...project, open: project.id === PROJECT_ID });
});

app.post('/api/projects/:id/open', async (req, res) => {
  await openProject(req.params.id);
  res.json({ open: PROJECT_ID });
});

// Server-sent events: { type: 'storyboard' | 'project', project, origin } whenever anything changes.
app.get('/api/events', subscribe);

// ---- Storyboard -------------------------------------------------------------------------------

app.get('/api/storyboard', async (_req, res) => res.json(await readStoryboard()));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const OBJECT_SETTINGS = ['image_params', 'video_params', 'tts_params', 'sfx_params'];

app.put('/api/settings', async (req, res) => {
  if (req.body.reference_asset_ids !== undefined) req.body.reference_asset_ids = sanitizeAssetIds(req.body.reference_asset_ids, 'reference_asset_ids');
  for (const key of OBJECT_SETTINGS) {
    if (req.body[key] !== undefined && !isPlainObject(req.body[key])) throw badRequest(`${key} must be an object`);
  }
  for (const key of ['image_params', 'video_params']) {
    if (req.body[key] && !Object.values(req.body[key]).every(isPlainObject)) throw badRequest(`${key} must map model ids to objects`);
  }
  const sb = await updateStoryboard((sb) => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (req.body[key] !== undefined && !READONLY_SETTINGS.includes(key)) sb.settings[key] = req.body[key];
    }
  }, { label: 'Edit project settings', key: `settings:${Object.keys(req.body).sort().join(',')}` });
  res.json(sb.settings);
});

app.put('/api/scene/:id', async (req, res) => {
  const patch = sanitizeScenePatch(req.body);
  res.json(await updateStoryboard((sb) => applyScenePatch(findScene(sb, req.params.id), patch), sceneEditHistory(req.params.id, patch)));
});

app.post('/api/scenes', async (req, res) => {
  const scene = await updateStoryboard((sb) => {
    const s = syncCues(newScene(nextSceneId(sb), sanitizeScenePatch(req.body)));
    let at = sb.scenes.length;
    if (Number.isInteger(req.body.index)) at = Math.max(0, Math.min(req.body.index, sb.scenes.length));
    else {
      const after = sb.scenes.findIndex((x) => String(x.scene_id) === String(req.body.after_id));
      if (after !== -1) at = after + 1;
    }
    sb.scenes.splice(at, 0, s);
    return s;
  }, { label: 'Add scene' });
  res.status(201).json(scene);
});

/** A new scene with the same prompts and duration as `src` (media isn't copied). */
function copyOf(sb, src) {
  return newScene(nextSceneId(sb), {
    ...Object.fromEntries(SCENE_TEXT_FIELDS.map((f) => [f, src[f]])),
    duration_sec: src.duration_sec,
    notes: src.notes,
    video_prompt: src.video_prompt,
    motion: src.motion,
    shake: src.shake,
    title_text: src.title_text,
    sfx_layers: (src.sfx_layers || []).map((l) => newSfxLayer({ prompt: l.prompt, volume: l.volume, start_sec: l.start_sec, length_sec: l.length_sec, cue: l.cue })),
    shots: (src.shots || []).map((s) => newShot({ image_prompt: s.image_prompt, motion: s.motion, start_sec: s.start_sec, cue: s.cue })),
  });
}

/** The scenes named by `ids`, in timeline order. */
function scenesById(sb, ids) {
  if (!Array.isArray(ids) || !ids.length) throw badRequest('ids must list at least one scene_id');
  ids.forEach((id) => findScene(sb, id));
  const wanted = new Set(ids.map(String));
  return sb.scenes.filter((s) => wanted.has(String(s.scene_id)));
}

const scenesLabel = (verb, n) => `${verb} ${n === 1 ? 'scene' : `${n} scenes`}`;

app.post('/api/scene/:id/duplicate', async (req, res) => {
  const scene = await updateStoryboard((sb) => {
    const src = findScene(sb, req.params.id);
    const copy = copyOf(sb, src);
    sb.scenes.splice(sb.scenes.indexOf(src) + 1, 0, copy);
    return copy;
  }, { label: 'Duplicate scene' });
  res.status(201).json(scene);
});

// Copies of several scenes, placed together (in timeline order) after the last of them. Responds with the copies.
app.post('/api/scenes/duplicate', async (req, res) => {
  const copies = await updateStoryboard((sb) => {
    const sources = scenesById(sb, req.body.ids);
    const at = sb.scenes.indexOf(sources.at(-1)) + 1;
    const made = [];
    for (const src of sources) {
      const copy = copyOf(sb, src);
      sb.scenes.splice(at + made.length, 0, copy);
      made.push(copy);
    }
    return made;
  }, { label: scenesLabel('Duplicate', req.body.ids?.length) });
  res.status(201).json(copies);
});

// The scene's media files are deleted once no undo step needs them.
app.delete('/api/scene/:id', async (req, res) => {
  await updateStoryboard((sb) => {
    const s = findScene(sb, req.params.id);
    sb.scenes.splice(sb.scenes.indexOf(s), 1);
  }, { label: 'Delete scene' });
  res.json({ ok: true });
});

// Replace the prompts of several scenes: { ids, prompts: { image_prompt, voiceover_text, sfx_prompt } }.
app.post('/api/scenes/paste-prompts', async (req, res) => {
  const prompts = Object.fromEntries(SCENE_TEXT_FIELDS.map((f) => [f, String(req.body.prompts?.[f] ?? '')]));
  const sb = await updateStoryboard((sb) => {
    for (const s of scenesById(sb, req.body.ids)) Object.assign(s, prompts);
  }, { label: `Paste prompts into ${req.body.ids?.length === 1 ? 'scene' : `${req.body.ids?.length} scenes`}` });
  res.json(sb);
});

app.post('/api/scenes/delete', async (req, res) => {
  await updateStoryboard((sb) => {
    const doomed = new Set(scenesById(sb, req.body.ids));
    sb.scenes = sb.scenes.filter((s) => !doomed.has(s));
  }, { label: scenesLabel('Delete', req.body.ids?.length) });
  res.json({ ok: true });
});

app.post('/api/scenes/reorder', async (req, res) => {
  const order = (req.body.order || []).map(String);
  const sb = await updateStoryboard((sb) => {
    const ids = sb.scenes.map((s) => String(s.scene_id));
    if (order.length !== ids.length || !ids.every((id) => order.includes(id))) {
      throw badRequest('order must list every scene_id exactly once');
    }
    sb.scenes.sort((a, b) => order.indexOf(String(a.scene_id)) - order.indexOf(String(b.scene_id)));
  }, { label: 'Move scene' });
  res.json(sb);
});

app.post('/api/scenes/import-script', async (req, res) => {
  const parsed = parseScript(String(req.body.script || ''));
  if (!parsed.length) throw badRequest('The script is empty');
  const sb = await updateStoryboard((sb) => {
    if (req.body.mode === 'replace') sb.scenes = [];
    for (const fields of parsed) sb.scenes.push(newScene(nextSceneId(sb), fields));
  }, { label: 'Import script' });
  res.json(sb);
});

const IMPORT_SCENE_FIELDS = [
  ...SCENE_TEXT_FIELDS, 'video_prompt', 'motion', 'shake', 'title_text', 'reference_names', 'sfx_layers', 'shots', 'duration_sec', 'notes',
];
const IMPORT_SETTINGS = Object.keys(DEFAULT_SETTINGS).filter((k) => !READONLY_SETTINGS.includes(k) && k !== 'reference_asset_ids');
const SETTING_CHOICES = {
  aspect_ratio: Object.keys(RESOLUTIONS), motion: MOTIONS, look: Object.keys(LOOKS), captions: CAPTION_MODES, caption_position: CAPTION_POSITIONS,
};
const SETTING_RANGES = { motion_amount: [1, 40], vignette: [0, 1], grain: [0, 1], image_check_retries: [0, 5] };

/** Check an imported settings object; throws a 400 naming the problem. */
function sanitizeImportSettings(settings = {}) {
  if (typeof settings !== 'object' || Array.isArray(settings)) throw badRequest('settings must be an object');
  for (const [key, value] of Object.entries(settings)) {
    if (!IMPORT_SETTINGS.includes(key)) throw badRequest(`Unknown setting "${key}". Allowed: ${IMPORT_SETTINGS.join(', ')}`);
    if (SETTING_CHOICES[key] && !SETTING_CHOICES[key].includes(value)) {
      throw badRequest(`${key} must be one of ${SETTING_CHOICES[key].join(', ')}`);
    }
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) throw badRequest(`${key} must be a ${typeof DEFAULT_SETTINGS[key]}`);
    const range = SETTING_RANGES[key];
    if (range && !(value >= range[0] && value <= range[1])) throw badRequest(`${key} must be between ${range[0]} and ${range[1]}`);
  }
  return settings;
}

/**
 * Exact-timing import (used by the timeline-generation skill):
 * { mode: 'append' | 'replace', scenes: [{ duration_sec, image_prompt, voiceover_text, sfx_prompt, sfx_layers, video_prompt, motion,
 * shake, title_text, reference_names, notes }], settings? }.
 * reference_names: library images (by name) used as this scene's own references, e.g. ["Bunker kitchen"].
 * sfx_layers: extra sound effects playing at the same time, [{ prompt, volume?, start_sec?, length_sec?, cue? }];
 * shots: more pictures after the scene's own, [{ image_prompt, start_sec?, cue?, motion? }].
 * A cue (words from voiceover_text) sets start_sec to when they're spoken.
 * Scenes are added with no media, ready to generate. One undo step.
 */
app.post('/api/scenes/import', async (req, res) => {
  const { mode, scenes } = req.body;
  if (mode !== 'append' && mode !== 'replace') throw badRequest('mode must be "append" or "replace"');
  if (!Array.isArray(scenes) || !scenes.length) throw badRequest('scenes must be a non-empty list');
  if (scenes.length > 500) throw badRequest('At most 500 scenes per import');
  const { library } = await readStoryboard();
  const patches = scenes.map((scene, i) => {
    const where = `Scene ${i + 1}`;
    if (!scene || typeof scene !== 'object') throw badRequest(`${where} must be an object`);
    const unknown = Object.keys(scene).filter((k) => !IMPORT_SCENE_FIELDS.includes(k));
    if (unknown.length) throw badRequest(`${where}: unknown field(s) ${unknown.join(', ')}. Allowed: ${IMPORT_SCENE_FIELDS.join(', ')}`);
    if (scene.duration_sec === undefined) throw badRequest(`${where}: duration_sec is required`);
    for (const f of [...SCENE_TEXT_FIELDS, 'video_prompt', 'notes']) {
      if (scene[f] !== undefined && typeof scene[f] !== 'string') throw badRequest(`${where}: ${f} must be text`);
    }
    try {
      return { ...sanitizeScenePatch(scene), ...referencesByName(library, scene.reference_names) };
    } catch (err) {
      throw badRequest(`${where}: ${err.message}`);
    }
  });
  const settings = sanitizeImportSettings(req.body.settings);
  const sb = await updateStoryboard((sb) => {
    if (mode === 'replace') sb.scenes = [];
    Object.assign(sb.settings, settings);
    for (const patch of patches) sb.scenes.push(syncCues(newScene(nextSceneId(sb), patch)));
  }, { label: `Import ${patches.length} scene${patches.length === 1 ? '' : 's'}` });
  res.json(sb);
});

/** { reference_asset_ids } for library images named in `names` (case and extension don't matter), or {}. */
function referencesByName(library, names) {
  if (names === undefined) return {};
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) throw badRequest('reference_names must be a list of names');
  const key = (name) => name.trim().replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase();
  const images = library.filter((a) => a.type === 'image');
  const ids = names.map((name) => {
    const asset = images.find((a) => key(a.name) === key(name));
    if (!asset) throw badRequest(`no library image is named "${name}" (generate it first with timeline.mjs references)`);
    return asset.asset_id;
  });
  return { reference_asset_ids: [...new Set(ids)].slice(0, 14) };
}

/**
 * Generate a reference image (a character or location master) into the library under `name`, and
 * with `for_every_scene`, add it to the project-wide references: { name, prompt, for_every_scene? }.
 * A library image with the same name is replaced as the reference.
 */
app.post('/api/references/generate', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const prompt = String(req.body?.prompt || '').trim().slice(0, 4000);
  if (!name || !prompt) throw badRequest('name and prompt are required');
  res.status(201).json(await generateReferenceImage({ name, prompt, forEveryScene: Boolean(req.body.for_every_scene) }));
});

// ---- Undo / redo ------------------------------------------------------------------------------
// Responds with { storyboard, label }, or { storyboard: null } when there is nothing to undo / redo.

app.post('/api/undo', async (_req, res) => res.json((await undo()) ?? { storyboard: null }));
app.post('/api/redo', async (_req, res) => res.json((await redo()) ?? { storyboard: null }));

// ---- Generation -------------------------------------------------------------------------------

const routes = { 'regenerate-image': 'image', 'regenerate-audio': 'voiceover', 'regenerate-sfx': 'sfx' };
for (const [route, kind] of Object.entries(routes)) {
  app.post(`/api/scene/:id/${route}`, async (req, res) => {
    // Optionally save edited prompt text in the same request.
    const patch = sanitizeScenePatch(req.body || {});
    if (Object.keys(patch).length) await updateStoryboard((sb) => applyScenePatch(findScene(sb, req.params.id), patch), sceneEditHistory(req.params.id, patch));
    res.json(await GENERATORS[kind].fn(req.params.id));
  });
}

// Generate the picture of one of a scene's extra shots.
app.post('/api/scene/:id/shots/:shotId/generate', async (req, res) => res.json(await generateSceneShotImage(req.params.id, req.params.shotId)));

// Generate one of a scene's extra sound effect layers.
app.post('/api/scene/:id/sfx-layers/:layerId/generate', async (req, res) => res.json(await generateSceneSfxLayer(req.params.id, req.params.layerId)));

// Video from the scene's image prompt (and its image as the first frame, if it has one).
app.post('/api/scene/:id/generate-video', async (req, res) => res.json(await generateSceneVideo(req.params.id)));

// ---- Library ----------------------------------------------------------------------------------
// Uploads go into the library only. Files are sent as the raw request body with the original name
// in the X-Filename header. Assets are then placed on the reel explicitly with the routes below.

app.get('/api/library', async (_req, res) => res.json((await readStoryboard()).library));

app.post('/api/library', async (req, res) => res.status(201).json(await addToLibrary(req)));

app.patch('/api/library/:assetId', async (req, res) => res.json(await renameAsset(req.params.assetId, req.body.name)));

// Save one frame of a library video as a new library image.
app.post('/api/library/:assetId/snapshot', async (req, res) => {
  res.status(201).json(await snapshotAsset(req.params.assetId, req.body.time_sec));
});

// Copy a scene's generated image into the library (e.g. to reuse a character as a reference).
app.post('/api/scene/:id/save-to-library', async (req, res) => res.status(201).json(await saveSceneVisualToLibrary(req.params.id)));

// How many reference images a Replicate model accepts (0 = none, null = no stated limit).
app.get('/api/model-info', async (req, res) => {
  res.json({ model: req.query.model, reference_capacity: await imageReferenceCapacity(String(req.query.model || '')) });
});

// Models to choose from (Replicate collections, Gemini API), and the settings a model offers.
app.get('/api/image-models', async (_req, res) => res.json(await listImageModels()));

app.get('/api/gemini-models', async (_req, res) => res.json(await listGeminiModels()));

app.get('/api/model-params', async (req, res) => {
  const model = String(req.query.model || '');
  if (isGeminiModel(model)) return res.json({ model, params: geminiParams(model) });
  if (!model.includes('/')) throw badRequest('model must look like owner/name or gemini:model');
  res.json({ model, params: await modelParams(model) });
});

app.delete('/api/library/:assetId', async (req, res) => {
  res.json(await deleteAsset(req.params.assetId, req.query.force === '1'));
});

app.post('/api/scene/:id/use-asset', async (req, res) => {
  res.json(await useAssetInScene(req.params.id, String(req.body.asset_id), String(req.body.slot), {
    layerId: req.body.layer_id && String(req.body.layer_id),
    shotId: req.body.shot_id && String(req.body.shot_id),
  }));
});

app.post('/api/scenes/from-asset', async (req, res) => {
  const index = req.body.index == null ? undefined : Number(req.body.index);
  res.status(201).json(await sceneFromAsset(String(req.body.asset_id), index));
});

app.put('/api/music', async (req, res) => res.json(await musicFromAsset(String(req.body.asset_id))));

app.delete('/api/music', async (_req, res) => res.json(await removeMusic()));

app.delete('/api/scene/:id/media/:slot', async (req, res) => {
  res.json(await clearSceneSlot(req.params.id, req.params.slot));
});

// What Generate missing would make and what it would cost, for the dialog that asks first.
app.post('/api/generate-missing/plan', async (req, res) => res.json(await generationPlan(req.body?.settings)));

app.post('/api/generate-missing', (req, res) => res.status(202).json(startGenerateMissing({ kinds: req.body?.kinds, ids: req.body?.items })));

app.post('/api/export', (_req, res) => res.status(202).json(startExport()));
// The open project's last export, if it has one: { url, size_bytes, updated_at }, or null.
app.get('/api/export', async (_req, res) => {
  const stat = await fs.promises.stat(path.join(EXPORTS_DIR, 'final_output.mp4')).catch(() => null);
  res.json(stat && { url: `/exports/final_output.mp4?t=${Math.round(stat.mtimeMs)}`, size_bytes: stat.size, updated_at: stat.mtime.toISOString() });
});

app.get('/api/job', (_req, res) => res.json(getJob()));

app.get('/api/voices', async (_req, res) => res.json(await listVoices()));

app.get('/api/elevenlabs-models', async (_req, res) => res.json(await listModels()));

// Starred voices and models (shared by every project).
app.get('/api/preferences', async (_req, res) => res.json(await readPreferences()));

// Every paid API call (all projects) with its cost, and the prices used to work it out.
app.get('/api/usage', async (_req, res) => res.json(await usageReport()));

app.get('/api/usage/accounts', async (_req, res) => res.json(await accountBalances()));

app.put('/api/usage/prices', async (req, res) => {
  await setPrice(req.body.key, req.body.price);
  res.json(await usageReport());
});

app.put('/api/preferences/starred', async (req, res) => {
  res.json(await setStarred(req.body.list, req.body.id, Boolean(req.body.starred)));
});

app.get('/api/status', (_req, res) => {
  res.json({
    replicate: Boolean(process.env.REPLICATE_API_TOKEN),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    ffmpeg: Boolean(FFMPEG && fs.existsSync(FFMPEG)),
  });
});

// ---- Static files -----------------------------------------------------------------------------

// Media and exports are served from whichever project is open.
const staticHandlers = new Map();
const serveOpenProject = (dirOf, options) => (req, res, next) => {
  const dir = dirOf();
  if (!staticHandlers.has(dir)) staticHandlers.set(dir, express.static(dir, options));
  staticHandlers.get(dir)(req, res, next);
};
app.use('/media', serveOpenProject(() => MEDIA_DIR, { maxAge: '1y', immutable: true }));
// With ?download=1 the export is saved as "<video title>.mp4" instead of played in the browser.
app.get('/exports/final_output.mp4', async (req, res, next) => {
  if (req.query.download) {
    const title = (await readStoryboard()).settings.title?.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '').trim();
    res.attachment(`${title || 'final_output'}.mp4`);
  }
  next();
});
app.use('/exports', serveOpenProject(() => EXPORTS_DIR));
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message, ...(err.uses && { uses: err.uses }) });
});

await initProjects();
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT} (project: ${PROJECT_ID})`);
  if (!process.env.REPLICATE_API_TOKEN) console.warn('  ! REPLICATE_API_TOKEN missing (copy .env.example to .env)');
  if (!process.env.ELEVENLABS_API_KEY) console.warn('  ! ELEVENLABS_API_KEY missing (copy .env.example to .env)');
});
