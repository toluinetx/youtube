#!/usr/bin/env node
// Helper for the continuity skill: reads and edits the open project's continuity bible and the image
// prompts it applies to, through the editor's API.
//
//   node continuity.mjs bible                          the bible (JSON)
//   node continuity.mjs pictures [which] [--entry NAME] every picture: prompt, entries in it, continuity text
//   node continuity.mjs save <bible.json>              replace the bible (keep entry_id / view_id / state_id)
//   node continuity.mjs prompt <picture> <file.txt>    set a picture's image prompt from a text file
//   node continuity.mjs include <picture> <entry>      apply an entry to a picture its prompt doesn't name
//   node continuity.mjs exclude <picture> <entry>      leave an entry out of a picture that names it
//   node continuity.mjs reset <picture> <entry>        undo include / exclude for that entry
//   node continuity.mjs story-time <scene> <scene|->   a flash-forward takes the states of another scene
//   node continuity.mjs generate <entry> <view>        generate one reference view (costs an image)
//
// which: scene numbers as the editor shows them ("3", "63-74,83"). picture: "63" (the scene's own
// picture) or "63.2" (its 2nd picture, i.e. its first extra shot), as the editor labels them.
// JSON and text files may be UTF-8 (with or without BOM) or UTF-16 (Windows PowerShell's default).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
try {
  process.loadEnvFile(path.join(repo, '.env'));
} catch {
  // No .env: default port.
}
const BASE = new URL(process.env.EDITOR_API || `http://localhost:${process.env.PORT || 3001}`);
const SHOT_FIELDS = ['shot_id', 'image_prompt', 'motion', 'start_sec', 'cue', 'continues', 'reference_asset_ids', 'continuity_include', 'continuity_exclude'];

function call(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      new URL(route, BASE),
      { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(text);
          } catch {
            // Not JSON.
          }
          if (res.statusCode >= 400) reject(new Error(`${method} ${route} failed (${res.statusCode}): ${json.error || text.slice(0, 200)}`));
          else resolve(json);
        });
      },
    );
    req.on('error', () => fail(`The editor isn't running at ${BASE.origin}. Start it with "npm run dev" in ${repo}, then try again.`));
    if (data) req.write(data);
    req.end();
  });
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}
const readJson = (file) => {
  try {
    return JSON.parse(readText(file));
  } catch (err) {
    fail(`${file} isn't valid JSON: ${err.message}`);
  }
};

function parseRange(spec) {
  if (!spec) return null;
  const out = new Set();
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) fail(`Can't read "${part}": use numbers and ranges like 3,5-7`);
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) out.add(n);
  }
  return out;
}

/** "63" → the scene's own picture, "63.2" → its first extra shot. */
function findPicture(sb, key) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(key || ''));
  if (!m) fail(`Name a picture as the editor does: 63 or 63.2`);
  const scene = sb.scenes[Number(m[1]) - 1];
  if (!scene) fail(`There's no scene ${m[1]}`);
  const n = Number(m[2] || 1);
  if (n === 1) return { scene, shot: null, slot: scene };
  const shot = (scene.shots || [])[n - 2];
  if (!shot) fail(`Scene ${m[1]} has no picture ${n}`);
  return { scene, shot, slot: shot };
}

function findEntry(sb, name) {
  const e = sb.continuity.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());
  if (!e) fail(`No continuity entry "${name}". Entries: ${sb.continuity.map((x) => x.name).join(', ')}`);
  return e;
}

/** Save a change to a scene's own picture or to one of its shots (shots are sent as a whole list). */
async function patchPicture({ scene, shot }, patch) {
  if (!shot) return call('PUT', `/api/scene/${scene.scene_id}`, patch);
  const shots = scene.shots.map((x) => {
    const out = Object.fromEntries(SHOT_FIELDS.filter((f) => x[f] !== undefined).map((f) => [f, x[f]]));
    return x.shot_id === shot.shot_id ? { ...out, ...patch } : out;
  });
  return call('PUT', `/api/scene/${scene.scene_id}`, { shots });
}

const commands = {
  async bible() {
    console.log(JSON.stringify((await call('GET', '/api/storyboard')).continuity, null, 2));
  },

  async pictures(args) {
    const sb = await call('GET', '/api/storyboard');
    const wanted = parseRange(args.find((a) => !a.startsWith('--')));
    const only = args.includes('--entry') ? findEntry(sb, args[args.indexOf('--entry') + 1]).entry_id : null;
    const out = [];
    for (const [i, s] of sb.scenes.entries()) {
      if (wanted && !wanted.has(i + 1)) continue;
      for (const [k, slot] of [s, ...(s.shots || [])].entries()) {
        if (!slot.image_prompt?.trim()) continue;
        const c = await call('GET', `/api/scene/${s.scene_id}/continuity${k ? `?shot_id=${slot.shot_id}` : ''}`);
        const used = c.entries.filter((e) => e.included);
        if (only && !used.some((e) => e.entry_id === only)) continue;
        out.push({
          picture: k ? `${i + 1}.${k + 1}` : String(i + 1),
          title: s.title_text || undefined,
          story_time: s.continuity_at != null ? `as scene ${sb.scenes.findIndex((x) => String(x.scene_id) === String(s.continuity_at)) + 1}` : undefined,
          prompt: slot.image_prompt,
          entries: used.map((e) => `${e.name}${e.detected ? '' : ' (added by hand)'}${e.state ? `: ${e.state}` : ''}`),
          left_out: c.entries.filter((e) => e.detected && !e.included).map((e) => e.name),
        });
      }
    }
    console.log(JSON.stringify(out, null, 2));
  },

  async save([file]) {
    if (!file) fail('Usage: node continuity.mjs save <bible.json>');
    const list = readJson(file);
    const saved = await call('PUT', '/api/continuity', { continuity: Array.isArray(list) ? list : list.continuity });
    console.log(`Saved ${saved.length} entries: ${saved.map((e) => e.name).join(', ')}`);
  },

  async prompt([key, file]) {
    if (!file) fail('Usage: node continuity.mjs prompt <picture> <file.txt>');
    const sb = await call('GET', '/api/storyboard');
    const pic = findPicture(sb, key);
    await patchPicture(pic, { image_prompt: readText(file).trim() });
    console.log(`Picture ${key}: prompt updated (its image is now out of date until it's regenerated).`);
  },

  async include([key, name]) {
    const sb = await call('GET', '/api/storyboard');
    const pic = findPicture(sb, key);
    const id = findEntry(sb, name).entry_id;
    await patchPicture(pic, {
      continuity_include: [...new Set([...(pic.slot.continuity_include || []), id])],
      continuity_exclude: (pic.slot.continuity_exclude || []).filter((x) => x !== id),
    });
    console.log(`Picture ${key}: ${name} included`);
  },

  async exclude([key, name]) {
    const sb = await call('GET', '/api/storyboard');
    const pic = findPicture(sb, key);
    const id = findEntry(sb, name).entry_id;
    await patchPicture(pic, {
      continuity_exclude: [...new Set([...(pic.slot.continuity_exclude || []), id])],
      continuity_include: (pic.slot.continuity_include || []).filter((x) => x !== id),
    });
    console.log(`Picture ${key}: ${name} left out`);
  },

  async reset([key, name]) {
    const sb = await call('GET', '/api/storyboard');
    const pic = findPicture(sb, key);
    const id = findEntry(sb, name).entry_id;
    await patchPicture(pic, {
      continuity_include: (pic.slot.continuity_include || []).filter((x) => x !== id),
      continuity_exclude: (pic.slot.continuity_exclude || []).filter((x) => x !== id),
    });
    console.log(`Picture ${key}: ${name} back to automatic`);
  },

  async 'story-time'([scene, as]) {
    const sb = await call('GET', '/api/storyboard');
    const s = sb.scenes[Number(scene) - 1];
    if (!s) fail(`There's no scene ${scene}`);
    const target = as === '-' || !as ? null : sb.scenes[Number(as) - 1]?.scene_id;
    if (as && as !== '-' && target == null) fail(`There's no scene ${as}`);
    await call('PUT', `/api/scene/${s.scene_id}`, { continuity_at: target });
    console.log(`Scene ${scene}: ${target == null ? 'its own story time' : `continuity as in scene ${as}`}`);
  },

  async generate([name, label]) {
    const sb = await call('GET', '/api/storyboard');
    const e = findEntry(sb, name);
    const v = e.views.find((x) => x.label.toLowerCase() === String(label || '').toLowerCase());
    if (!v) fail(`"${name}" has no view "${label}". Views: ${e.views.map((x) => x.label).join(', ')}`);
    console.error(`Generating "${e.name} - ${v.label}"…`);
    const { asset, check } = await call('POST', `/api/continuity/${e.entry_id}/views/${v.view_id}/generate`);
    console.log(JSON.stringify({ asset: asset.name, url: asset.url, check }, null, 2));
  },
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command]) fail(`Usage: node continuity.mjs ${Object.keys(commands).join(' | ')} (see the top of this file)`);
commands[command](args).catch((err) => fail(err.message));
