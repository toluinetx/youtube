import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { CLIENT_DIST, EXPORTS_DIR, MEDIA_DIR } from './paths.js';
import { DEFAULT_SETTINGS, READONLY_SETTINGS, SCENE_TEXT_FIELDS, findScene, newScene, nextSceneId, readStoryboard, updateStoryboard } from './storyboard.js';
import { GENERATORS, removeMedia, sceneMediaUrls } from './generate.js';
import {
  addToLibrary, clearSceneSlot, deleteAsset, musicFromAsset, removeMusic, renameAsset, saveSceneVisualToLibrary, sceneFromAsset,
  snapshotAsset, useAssetInScene,
} from './uploads.js';
import { referenceCapacity } from './replicate.js';
import { getJob, startExport, startGenerateMissing } from './jobs.js';
import { listVoices } from './elevenlabs.js';
import { FFMPEG } from './ffmpeg.js';

const PORT = Number(process.env.PORT) || 3001;
const app = express();
app.use(express.json({ limit: '2mb' }));

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

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
  if (body.video_volume !== undefined) {
    const v = Number(body.video_volume);
    if (!Number.isFinite(v) || v < 0 || v > 2) throw badRequest('video_volume must be between 0 and 2');
    patch.video_volume = v;
  }
  return patch;
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

// ---- Storyboard -------------------------------------------------------------------------------

app.get('/api/storyboard', async (_req, res) => res.json(await readStoryboard()));

app.put('/api/settings', async (req, res) => {
  if (req.body.reference_asset_ids !== undefined) req.body.reference_asset_ids = sanitizeAssetIds(req.body.reference_asset_ids, 'reference_asset_ids');
  const sb = await updateStoryboard((sb) => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (req.body[key] !== undefined && !READONLY_SETTINGS.includes(key)) sb.settings[key] = req.body[key];
    }
  });
  res.json(sb.settings);
});

app.put('/api/scene/:id', async (req, res) => {
  const patch = sanitizeScenePatch(req.body);
  res.json(await updateStoryboard((sb) => Object.assign(findScene(sb, req.params.id), patch)));
});

app.post('/api/scenes', async (req, res) => {
  const scene = await updateStoryboard((sb) => {
    const s = newScene(nextSceneId(sb), sanitizeScenePatch(req.body));
    const after = sb.scenes.findIndex((x) => String(x.scene_id) === String(req.body.after_id));
    sb.scenes.splice(after === -1 ? sb.scenes.length : after + 1, 0, s);
    return s;
  });
  res.status(201).json(scene);
});

app.post('/api/scene/:id/duplicate', async (req, res) => {
  const scene = await updateStoryboard((sb) => {
    const src = findScene(sb, req.params.id);
    const copy = newScene(nextSceneId(sb), {
      ...Object.fromEntries(SCENE_TEXT_FIELDS.map((f) => [f, src[f]])),
      duration_sec: src.duration_sec,
    });
    sb.scenes.splice(sb.scenes.indexOf(src) + 1, 0, copy);
    return copy;
  });
  res.status(201).json(scene);
});

app.delete('/api/scene/:id', async (req, res) => {
  const removed = await updateStoryboard((sb) => {
    const s = findScene(sb, req.params.id);
    sb.scenes.splice(sb.scenes.indexOf(s), 1);
    return s;
  });
  await Promise.all(sceneMediaUrls(removed).map(removeMedia));
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
  });
  res.json(sb);
});

app.post('/api/scenes/import-script', async (req, res) => {
  const parsed = parseScript(String(req.body.script || ''));
  if (!parsed.length) throw badRequest('The script is empty');
  const replace = req.body.mode === 'replace';
  let dropped = [];
  const sb = await updateStoryboard((sb) => {
    if (replace) {
      dropped = sb.scenes;
      sb.scenes = [];
    }
    for (const fields of parsed) sb.scenes.push(newScene(nextSceneId(sb), fields));
  });
  await Promise.all(dropped.flatMap(sceneMediaUrls).map(removeMedia));
  res.json(sb);
});

// ---- Generation -------------------------------------------------------------------------------

const routes = { 'regenerate-image': 'image', 'regenerate-audio': 'voiceover', 'regenerate-sfx': 'sfx' };
for (const [route, kind] of Object.entries(routes)) {
  app.post(`/api/scene/:id/${route}`, async (req, res) => {
    // Optionally save edited prompt text in the same request.
    const patch = sanitizeScenePatch(req.body || {});
    if (Object.keys(patch).length) await updateStoryboard((sb) => Object.assign(findScene(sb, req.params.id), patch));
    res.json(await GENERATORS[kind].fn(req.params.id));
  });
}

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
  res.json({ model: req.query.model, reference_capacity: await referenceCapacity(String(req.query.model || '')) });
});

app.delete('/api/library/:assetId', async (req, res) => {
  res.json(await deleteAsset(req.params.assetId, req.query.force === '1'));
});

app.post('/api/scene/:id/use-asset', async (req, res) => {
  res.json(await useAssetInScene(req.params.id, String(req.body.asset_id), String(req.body.slot)));
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

app.post('/api/generate-missing', (req, res) => res.status(202).json(startGenerateMissing(req.body?.kinds)));

app.post('/api/export', (_req, res) => res.status(202).json(startExport()));

app.get('/api/job', (_req, res) => res.json(getJob()));

app.get('/api/voices', async (_req, res) => res.json(await listVoices()));

app.get('/api/status', (_req, res) => {
  res.json({
    replicate: Boolean(process.env.REPLICATE_API_TOKEN),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    ffmpeg: Boolean(FFMPEG && fs.existsSync(FFMPEG)),
  });
});

// ---- Static files -----------------------------------------------------------------------------

app.use('/media', express.static(MEDIA_DIR, { maxAge: '1y', immutable: true }));
app.use('/exports', express.static(EXPORTS_DIR));
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

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (!process.env.REPLICATE_API_TOKEN) console.warn('  ! REPLICATE_API_TOKEN missing (copy .env.example to .env)');
  if (!process.env.ELEVENLABS_API_KEY) console.warn('  ! ELEVENLABS_API_KEY missing (copy .env.example to .env)');
});
