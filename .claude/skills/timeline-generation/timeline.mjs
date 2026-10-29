#!/usr/bin/env node
// Helper for the timeline-generation skill: talks to the running editor's API.
//
//   node timeline.mjs projects                 list projects (JSON)
//   node timeline.mjs voices                   list ElevenLabs voices (JSON; needs ELEVENLABS_API_KEY)
//   node timeline.mjs import <payload.json>    create/open the project, import the scenes, print a summary
//   node timeline.mjs estimate <payload.json>  estimated cost of generating the payload's scenes (works offline)
//
// payload.json:
//   {
//     "project": { "id": "existing-id" } | { "new": "Title of the new project" },
//     "mode": "append" | "replace",
//     "settings": { "style_prompt": "...", "aspect_ratio": "16:9", ... },      (optional)
//     "scenes": [{ "duration_sec": 7, "image_prompt": "...", "voiceover_text": "...", "sfx_prompt": "...", "notes": "..." }]
//   }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  process.loadEnvFile(path.join(repo, '.env'));
} catch {
  // No .env: default port.
}
const BASE = process.env.EDITOR_API || `http://localhost:${process.env.PORT || 3001}`;

async function call(method, route, body, headers = {}) {
  let res;
  try {
    res = await fetch(BASE + route, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...headers },
      body: body && JSON.stringify(body),
    });
  } catch {
    fail(`The editor isn't running at ${BASE}. Start it with "npm run dev" in ${repo}, then try again.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(`${method} ${route} failed (${res.status}): ${data.error || res.statusText}`);
  return data;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`;

async function importPayload(file) {
  const { project = {}, mode, settings, scenes } = await loadPayload(file, 'import');

  let id = project.id;
  if (project.new) {
    id = (await call('POST', '/api/projects', { title: project.new, open: true })).id;
    console.log(`Created project "${project.new}" (${id}) and opened it in the editor.`);
  } else if (id) {
    await call('POST', `/api/projects/${encodeURIComponent(id)}/open`);
    console.log(`Opened project ${id} in the editor.`);
  } else {
    fail('payload.project needs "id" (existing project) or "new" (title for a new project)');
  }

  // X-Project makes the server refuse the import if another project was opened in the meantime.
  const sb = await call('POST', '/api/scenes/import', { mode, settings, scenes }, { 'X-Project': id });

  const added = mode === 'replace' ? sb.scenes : sb.scenes.slice(-scenes.length);
  const offset = sb.scenes.length - added.length;
  let t = sb.scenes.slice(0, offset).reduce((sum, s) => sum + s.duration_sec, 0);
  console.log(`\nImported ${added.length} scene(s) (${mode}). The project now has ${sb.scenes.length} scene(s).`);
  if (settings && Object.keys(settings).length) console.log(`Project settings updated: ${Object.keys(settings).join(', ')}`);
  console.log('');
  for (const [i, s] of added.entries()) {
    const layers = s.sfx_layers || [];
    const sounds = (s.sfx_prompt ? 1 : 0) + layers.length;
    const flags = [s.image_prompt && 'image', s.voiceover_text && 'voice', sounds && (sounds > 1 ? `${sounds} sfx` : 'sfx')].filter(Boolean).join(' + ') || 'empty';
    console.log(`  Scene ${offset + i + 1}  ${fmt(t)}–${fmt(t + s.duration_sec)}  (${s.duration_sec}s)  ${flags}${s.notes ? `  · note: ${s.notes}` : ''}`);
    // Shots and event sounds with their timing (synced ones are re-timed exactly when the voiceover is generated).
    for (const sh of s.shots || []) {
      console.log(`      shot: ${sh.image_prompt.slice(0, 50)}  · ${sh.cue ? `at "${sh.cue}" (~${sh.start_sec}s)` : `from ${sh.start_sec}s`}`);
    }
    for (const l of layers) {
      const when = l.cue ? `at "${l.cue}" (~${l.start_sec}s)` : `from ${l.start_sec}s`;
      console.log(`      sfx: ${l.prompt.slice(0, 50)}  · ${when} · ${l.length_sec ? `${l.length_sec}s` : 'to scene end'}`);
    }
    t += s.duration_sec;
  }
  const total = sb.scenes.reduce((sum, s) => sum + s.duration_sec, 0);
  console.log(`\nTotal length: ${fmt(total)}. Nothing is generated yet: use "Generate missing" or each scene's Generate buttons.`);
  console.log('Ctrl/Cmd+Z in the editor undoes the whole import.');
}

// ---- Cost estimate ---------------------------------------------------------------------------------
// Priced by the editor's own estimator (server/estimate.js), the same one its Generate dialog uses.

async function loadPayload(file, usage) {
  if (!file) fail(`Usage: node timeline.mjs ${usage} <payload.json>`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`Could not read ${file}: ${err.message}`);
  }
}

async function estimatePayload(file) {
  const { project = {}, mode = 'append', settings: changes = {}, scenes = [] } = await loadPayload(file, 'estimate');
  // Imported after .env is loaded, so PROJECTS_DIR is the editor's.
  const { PROJECTS_DIR } = await import('../../../server/paths.js');
  const { DEFAULT_SETTINGS } = await import('../../../server/storyboard.js');
  const { costEstimator } = await import('../../../server/estimate.js');

  // The target project's settings (read only), with the payload's changes on top.
  let existing = { settings: {}, scenes: [] };
  if (project.id) {
    try {
      existing = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, project.id, 'storyboard.json'), 'utf8'));
    } catch (err) {
      fail(`Could not read project "${project.id}": ${err.message}`);
    }
  }
  const s = { ...DEFAULT_SETTINGS, ...existing.settings, ...changes };
  const cost = await costEstimator(s);
  const { unpriced, elevenlabsRate: elevenlabs } = cost;

  // After the first picture of the video, the editor sends the picture before (and any project
  // references) as references, so the reference model makes every image but a first one without them.
  const projectRefs = (s.reference_asset_ids || []).length;
  let pictureBefore = mode === 'append' && existing.scenes.length > 0;

  const rows = scenes.map((scene, i) => {
    const row = { n: i + 1, image: 0, voice: 0, sfx: 0, credits: 0, pictures: 0, voices: 0, sounds: 0, unpriced: new Set(), video: null };
    const add = (key, { usd, credits = 0 }) => {
      row.credits += credits;
      if (usd == null) row.unpriced.add(key);
      else row[key] += usd;
    };
    for (const prompt of [scene.image_prompt, ...(scene.shots || []).map((sh) => sh.image_prompt)].filter((p) => p?.trim())) {
      add('image', cost.image(prompt, projectRefs + (pictureBefore ? 1 : 0)));
      row.pictures++;
      pictureBefore = true;
    }
    if (scene.voiceover_text?.trim()) {
      add('voice', cost.voice(scene.voiceover_text));
      row.voices++;
    }
    const lengths = [
      scene.sfx_prompt?.trim() && scene.duration_sec,
      ...(scene.sfx_layers || []).filter((l) => l.prompt?.trim()).map((l) => l.length_sec || scene.duration_sec - (l.start_sec || 0)),
    ].filter(Boolean);
    for (const sec of lengths) {
      add('sfx', cost.sfx(sec));
      row.sounds++;
    }
    // Video clips are off by default in "Generate missing": priced separately, for scenes that ask for one.
    if (scene.video_prompt?.trim() || /generate (a )?video/i.test(scene.notes || '')) row.video = cost.video(scene.duration_sec);
    row.total = row.image + row.voice + row.sfx;
    return row;
  });

  const usd = (n) => (n < 0.995 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
  const sum = (key) => rows.reduce((t, r) => t + r[key], 0);
  console.log(`Estimated cost of generating ${scenes.length} scene(s) once (USD):`);
  console.log(`  image: ${projectRefs ? '' : `${s.image_model} (first picture), then `}${s.reference_model} · voice: ${s.tts_model} · sound: ${s.sfx_model}\n`);
  for (const r of rows) {
    const cost = (key) => (!r.unpriced.has(key) ? usd(r[key]) : r[key] ? `${usd(r[key])} + unpriced` : 'no price');
    const parts = [
      r.pictures && `${r.pictures} picture${r.pictures > 1 ? 's' : ''} ${cost('image')}`,
      r.voices && `voice ${cost('voice')}`,
      r.sounds && `${r.sounds} sound${r.sounds > 1 ? 's' : ''} ${cost('sfx')}`,
      r.video && `optional video ~${r.video.sec}s ${r.video.usd == null ? 'no price' : usd(r.video.usd)}`,
    ].filter(Boolean);
    console.log(`  Scene ${r.n}  ${usd(r.total)}${r.unpriced.size ? '+' : ''}  ${parts.join(' · ') || 'nothing to generate'}`);
  }
  const total = sum('total');
  const videos = rows.filter((r) => r.video?.usd != null);
  console.log(`\n  Images ${usd(sum('image'))} · Voice ${usd(sum('voice'))} · Sound ${usd(sum('sfx'))}`);
  console.log(`  TOTAL ${usd(total)}${unpriced.size ? '+' : ''} for "Generate missing" (${Math.round(sum('credits')).toLocaleString('en-US')} ElevenLabs credits)`);
  if (videos.length) console.log(`  + ${usd(videos.reduce((t, r) => t + r.video.usd, 0))} if the ${videos.length} suggested video clip(s) are generated`);
  if (unpriced.size) console.log(`\n  No price for: ${[...unpriced].join(', ')}. Those items aren't included (marked +). Set a price in the editor's Usage panel.`);
  console.log(`\n  Regenerating an item costs the same again. ElevenLabs is at its pay-as-you-go rate (${elevenlabs == null ? 'no price set' : `$${elevenlabs}/1k credits`}); on a subscription it uses the plan's credits instead.`);
}

const [command, arg] = process.argv.slice(2);
if (command === 'projects') console.log(JSON.stringify(await call('GET', '/api/projects'), null, 2));
else if (command === 'voices') console.log(JSON.stringify(await call('GET', '/api/voices'), null, 2));
else if (command === 'import') await importPayload(arg);
else if (command === 'estimate') await estimatePayload(arg);
else fail('Commands: projects | voices | import <payload.json> | estimate <payload.json>');
