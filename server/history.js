import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_DIR, mediaUrlToPath } from './paths.js';

// Undo/redo keeps whole storyboard snapshots (compact JSON) in memory. Media files dropped from the
// storyboard are only deleted once no snapshot still refers to them, so undo can bring them back.

const LIMIT = 100;
// Repeated edits of the same thing (typing in one prompt, dragging a duration) within this window
// become a single undo step.
const COALESCE_MS = 4000;
const TRASH_PATH = path.join(PROJECT_DIR, '.trash.json');

const undoStack = []; // { json, label } — the state *before* each change
const redoStack = [];
let last = null; // { key, at } of the most recent change, for coalescing

const MEDIA_URL = /\/media\/[^"?#\s]+/g;
const mediaUrls = (json) => new Set(json.match(MEDIA_URL) || []);

/** Media URLs removed from the storyboard at some point that may be deletable. */
let trash = new Set();
try {
  trash = new Set(JSON.parse(fs.readFileSync(TRASH_PATH, 'utf8')));
} catch {
  // Nothing pending.
}

export function historyState() {
  return { undo: undoStack.at(-1)?.label ?? null, redo: redoStack.at(-1)?.label ?? null };
}

/** Record a change from `before` to `after` (both compact JSON). */
export function recordChange(before, after, { label = 'Edit', key } = {}) {
  const now = Date.now();
  const coalesce = key && last?.key === key && now - last.at < COALESCE_MS && undoStack.length;
  if (!coalesce) undoStack.push({ json: before, label });
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  last = key ? { key, at: now } : null;
  return collect(before, after);
}

/** Move one step from `from` to `to`; `current` is the storyboard now. Returns the { json, label } to restore, or null. */
function step(from, to, current) {
  const entry = from.pop();
  if (!entry) return null;
  to.push({ json: current, label: entry.label });
  last = null;
  return entry;
}

export const takeUndo = (current) => step(undoStack, redoStack, current);
export const takeRedo = (current) => step(redoStack, undoStack, current);

/**
 * Remember media that left the storyboard, then delete any trashed file nothing refers to any more
 * (neither the current storyboard nor any undo/redo step).
 */
export async function collect(before, after) {
  let changed = false;
  if (before) {
    const kept = mediaUrls(after);
    for (const url of mediaUrls(before)) {
      if (!kept.has(url) && !trash.has(url)) {
        trash.add(url);
        changed = true;
      }
    }
  }
  if (!trash.size) return;
  const live = [after, ...undoStack.map((e) => e.json), ...redoStack.map((e) => e.json)].join('\n');
  for (const url of [...trash]) {
    if (live.includes(url)) continue;
    trash.delete(url);
    changed = true;
    const file = mediaUrlToPath(url);
    if (file) await fsp.rm(file, { force: true });
  }
  if (changed) await fsp.writeFile(TRASH_PATH, JSON.stringify([...trash])).catch(() => {});
}
