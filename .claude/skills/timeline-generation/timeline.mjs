#!/usr/bin/env node
// Helper for the timeline-generation skill: talks to the running editor's API.
//
//   node timeline.mjs projects                 list projects (JSON)
//   node timeline.mjs voices                   list ElevenLabs voices (JSON; needs ELEVENLABS_API_KEY)
//   node timeline.mjs import <payload.json>    create/open the project, import the scenes, print a summary
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
  if (!file) fail('Usage: node timeline.mjs import <payload.json>');
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`Could not read ${file}: ${err.message}`);
  }
  const { project = {}, mode, settings, scenes } = payload;

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
    const flags = [s.image_prompt && 'image', s.voiceover_text && 'voice', s.sfx_prompt && 'sfx'].filter(Boolean).join(' + ') || 'empty';
    console.log(`  Scene ${offset + i + 1}  ${fmt(t)}–${fmt(t + s.duration_sec)}  (${s.duration_sec}s)  ${flags}${s.notes ? `  · note: ${s.notes}` : ''}`);
    t += s.duration_sec;
  }
  const total = sb.scenes.reduce((sum, s) => sum + s.duration_sec, 0);
  console.log(`\nTotal length: ${fmt(total)}. Nothing is generated yet: use "Generate missing" or each scene's Generate buttons.`);
  console.log('Ctrl/Cmd+Z in the editor undoes the whole import.');
}

const [command, arg] = process.argv.slice(2);
if (command === 'projects') console.log(JSON.stringify(await call('GET', '/api/projects'), null, 2));
else if (command === 'voices') console.log(JSON.stringify(await call('GET', '/api/voices'), null, 2));
else if (command === 'import') await importPayload(arg);
else fail('Commands: projects | voices | import <payload.json>');
