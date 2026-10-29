import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_DIR, mediaUrlToPath } from './paths.js';

// Undo/redo keeps whole storyboard snapshots (compact JSON) in memory, separately for each project.
// Media files dropped from the storyboard are only deleted once no snapshot still refers to them,
// so undo can bring them back.

const LIMIT = 100;
// Repeated edits of the same thing (typing in one prompt, dragging a duration) within this window
// become a single undo step.
const COALESCE_MS = 4000;

const MEDIA_URL = /\/media\/[^"?#\s]+/g;
const mediaUrls = (json) => new Set(json.match(MEDIA_URL) || []);

const byProject = new Map();

/** The open project's history: undo / redo stacks of { json, label } (the state *before* each change). */
function current() {
  let h = byProject.get(PROJECT_DIR);
  if (!h) {
    const trashPath = path.join(PROJECT_DIR, '.trash.json');
    // Media URLs removed from the storyboard at some point that may be deletable.
    let trash = new Set();
    try {
      trash = new Set(JSON.parse(fs.readFileSync(trashPath, 'utf8')));
    } catch {
      // Nothing pending.
    }
    h = { undo: [], redo: [], last: null, trash, trashPath };
    byProject.set(PROJECT_DIR, h);
  }
  return h;
}

export function historyState() {
  const h = current();
  return { undo: h.undo.at(-1)?.label ?? null, redo: h.redo.at(-1)?.label ?? null };
}

/** Record a change from `before` to `after` (both compact JSON). */
export function recordChange(before, after, { label = 'Edit', key } = {}) {
  const h = current();
  const now = Date.now();
  const coalesce = key && h.last?.key === key && now - h.last.at < COALESCE_MS && h.undo.length;
  if (!coalesce) h.undo.push({ json: before, label });
  if (h.undo.length > LIMIT) h.undo.shift();
  h.redo.length = 0;
  h.last = key ? { key, at: now } : null;
  return collect(before, after);
}

/** Move one step from `from` to `to`; `now` is the storyboard now. Returns the { json, label } to restore, or null. */
function step(from, to, now) {
  const entry = from.pop();
  if (!entry) return null;
  to.push({ json: now, label: entry.label });
  current().last = null;
  return entry;
}

export const takeUndo = (now) => step(current().undo, current().redo, now);
export const takeRedo = (now) => step(current().redo, current().undo, now);

/**
 * Remember media that left the storyboard, then delete any trashed file nothing refers to any more
 * (neither the current storyboard nor any undo/redo step).
 */
export async function collect(before, after) {
  const h = current();
  let changed = false;
  if (before) {
    const kept = mediaUrls(after);
    for (const url of mediaUrls(before)) {
      if (!kept.has(url) && !h.trash.has(url)) {
        h.trash.add(url);
        changed = true;
      }
    }
  }
  if (!h.trash.size) return;
  const live = [after, ...h.undo.map((e) => e.json), ...h.redo.map((e) => e.json)].join('\n');
  for (const url of [...h.trash]) {
    if (live.includes(url)) continue;
    h.trash.delete(url);
    changed = true;
    const file = mediaUrlToPath(url);
    if (file) await fsp.rm(file, { force: true });
  }
  if (changed) await fsp.writeFile(h.trashPath, JSON.stringify([...h.trash])).catch(() => {});
}
