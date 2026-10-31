#!/usr/bin/env node
// Helper for the vision-check skill: lists the open project's pictures with their image prompts and
// files on disk, records Claude's verdicts, picks a variant and regenerates a picture with feedback.
//
//   node vision.mjs list [which] [--all | --flagged] [--ids]
//   node vision.mjs record <results.json>
//   node vision.mjs choose <picture> <url>
//   node vision.mjs regenerate <picture> [--feedback-file <problems.json>] [--feedback "problem" ...]
//
// which:    scene numbers as the editor shows them ("3", "63-74,83"), or scene ids with --ids. Default: all.
// picture:  a key from `list`: "63" for a scene's own picture, "63:s_ab12cd34" for one of its shots.
// list:     by default only pictures Claude hasn't checked yet; --flagged: pictures whose check failed
//           (by any checker); --all: every picture.
// results:  [{ "url": "/media/images/…png", "adherence": 90, "logic": 40, "quality": 85, "people": 1, "hands": 3,
//             "issues": [{ "text": "…", "type": "anatomy|cast|text|content|minor" }], "attempts": 1 }]
//           (the editor computes the overall score and whether it passes the project's pass mark).
// problems: ["A second hand reaches in from the right edge.", "…"]. A file avoids quoting differences
//           between PowerShell, cmd and bash. JSON files may be UTF-8 (with or without BOM) or UTF-16.
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
const PROJECTS_DIR = path.resolve(repo, process.env.PROJECTS_DIR || 'projects');

/** A request to the editor's API with no time limit (generating a picture can take minutes). */
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

/** Read a JSON file written by any tool: UTF-8 with or without a BOM, or UTF-16 (Windows PowerShell's default). */
function readJson(file) {
  const buf = fs.readFileSync(file);
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  else text = buf.toString('utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${file} isn't valid JSON: ${err.message}`);
  }
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/** "3,5-7" → Set {3,5,6,7}; empty → null (everything). */
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

async function load() {
  const [{ open }, sb] = await Promise.all([call('GET', '/api/projects'), call('GET', '/api/storyboard')]);
  if (!open) fail('No project is open in the editor.');
  const media = path.join(PROJECTS_DIR, open, 'media');
  const file = (url) => (url?.startsWith('/media/') ? path.join(media, decodeURIComponent(url.split('?')[0].slice(7))) : null);
  return { open, sb, file };
}

/** Every picture in the project: each scene's own image and each shot's, with its variants. */
function pictures({ sb, file }) {
  const byUrl = new Map();
  for (const a of sb.library) for (const v of a.variants || []) byUrl.set(v.url, a);
  const out = [];
  sb.scenes.forEach((s, i) => {
    const slots = [{ slot: s, shot: null, prompt: s.image_prompt }, ...(s.shots || []).map((x, n) => ({ slot: x, shot: { id: x.shot_id, n: n + 2 }, prompt: x.image_prompt }))];
    for (const { slot, shot, prompt } of slots) {
      if (!slot.image_url) continue;
      const asset = byUrl.get(slot.image_url);
      out.push({
        key: shot ? `${i + 1}:${shot.id}` : String(i + 1),
        scene: i + 1,
        scene_id: s.scene_id,
        shot: shot ? shot.n : 1,
        label: `Scene ${i + 1}${shot ? `, shot ${shot.n}` : ''}`,
        prompt: (prompt || '').trim(),
        narration: (s.voiceover_text || '').replace(/\{[^}]*\}|\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(),
        url: slot.image_url,
        file: file(slot.image_url),
        check: slot.image_check?.url === slot.image_url ? slot.image_check : null,
        // The other pictures made in the same generation, to choose from (the one in use included).
        variants: asset ? asset.variants.map((v) => ({ url: v.url, file: file(v.url), check: v.image_check ?? null })) : null,
      });
    }
  });
  return out;
}

async function list(args) {
  const all = args.includes('--all');
  const flagged = args.includes('--flagged');
  const byId = args.includes('--ids');
  const wanted = parseRange(args.find((a) => !a.startsWith('--')));
  const ctx = await load();
  const items = pictures(ctx).filter((p) => {
    if (wanted && !wanted.has(byId ? p.scene_id : p.scene)) return false;
    if (all) return true;
    if (flagged) return p.check && !p.check.ok;
    return p.check?.checker !== 'claude';
  });
  const missing = items.filter((p) => !fs.existsSync(p.file));
  console.log(JSON.stringify({ project: ctx.open, count: items.length, pictures: items }, null, 2));
  if (missing.length) {
    const keys = missing.map((p) => p.key);
    console.error(`Note: ${keys.length} picture file(s) aren't on this machine: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}`);
  }
}

async function record([file]) {
  if (!file) fail('Usage: node vision.mjs record <results.json>');
  const results = readJson(file);
  for (const r of Array.isArray(results) ? results : [results]) {
    const saved = await call('POST', '/api/image-check', { ...r, checker: 'claude' });
    const score = saved.score != null ? ` ${saved.score}%` : '';
    console.log(`${saved.ok ? 'passed' : 'flagged'}${score}  ${r.url}${saved.issues.length ? `  (${saved.issues.join(' ')})` : ''}`);
  }
}

/** The picture named by a `list` key. */
async function find(key) {
  if (!key) fail('Name a picture by its key from `list`, e.g. 63 or 63:s_ab12cd34');
  const ctx = await load();
  const p = pictures(ctx).find((x) => x.key === key);
  if (p) return { ctx, p };
  // A scene or shot that has no picture yet can still be generated.
  const [n, shot] = key.split(':');
  const s = ctx.sb.scenes[Number(n) - 1];
  if (!s || (shot && !(s.shots || []).some((x) => x.shot_id === shot))) fail(`No picture "${key}" in this project`);
  return { ctx, p: { key, scene_id: s.scene_id, shotId: shot || null } };
}

async function choose([key, url]) {
  const { ctx, p } = await find(key);
  const asset = ctx.sb.library.find((a) => a.variants?.some((v) => v.url === url));
  if (!asset) fail(`${url} isn't one of the variants of a library picture`);
  await call('POST', `/api/library/${asset.asset_id}/variant`, { url });
  console.log(`${p.label || key} now uses ${url}`);
}

async function regenerate([key, ...rest]) {
  const feedback = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--feedback' && rest[i + 1]) feedback.push(rest[++i]);
    else if (rest[i] === '--feedback-file' && rest[i + 1]) {
      const list = readJson(rest[++i]);
      feedback.push(...(Array.isArray(list) ? list : list.issues || []).map(String));
    }
  }
  const { p } = await find(key);
  const shotId = key.includes(':') ? key.split(':')[1] : null;
  const route = shotId ? `/api/scene/${p.scene_id}/shots/${shotId}/generate` : `/api/scene/${p.scene_id}/regenerate-image`;
  console.error(`Generating ${key}${feedback.length ? ` (avoiding: ${feedback.join(' ')})` : ''}…`);
  await call('POST', route, { feedback });
  const after = pictures(await load()).find((x) => x.key === key);
  console.log(JSON.stringify(after, null, 2));
}

const [command, ...args] = process.argv.slice(2);
const commands = { list, record, choose, regenerate };
if (!commands[command]) fail('Usage: node vision.mjs list | record | choose | regenerate (see the top of this file)');
commands[command](args).catch((err) => fail(err.message));
