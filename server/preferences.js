import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR } from './paths.js';

// Preferences that belong to the user rather than to one video, e.g. starred voices and models.
// Stored next to the projects so every project shares them.

const PREFS_PATH = path.join(PROJECTS_DIR, '.preferences.json');

/** Lists that can hold starred ids: image models (also used for reference models), video models, voice models, voices, sound models. */
export const STAR_LISTS = ['image_model', 'video_model', 'tts_model', 'voice', 'sfx_model'];

export async function readPreferences() {
  let prefs = {};
  try {
    prefs = JSON.parse(await fs.readFile(PREFS_PATH, 'utf8'));
  } catch {
    // No preferences yet (or unreadable): start empty.
  }
  const starred = Object.fromEntries(STAR_LISTS.map((list) => [list, Array.isArray(prefs.starred?.[list]) ? prefs.starred[list] : []]));
  return { starred };
}

let chain = Promise.resolve();

/** Star or unstar `id` in `list`. Resolves with all preferences. */
export function setStarred(list, id, starred) {
  if (!STAR_LISTS.includes(list)) throw Object.assign(new Error(`list must be one of ${STAR_LISTS.join(', ')}`), { status: 400 });
  if (typeof id !== 'string' || !id.trim() || id.length > 200) throw Object.assign(new Error('id must be a non-empty string'), { status: 400 });
  const run = chain.then(async () => {
    const prefs = await readPreferences();
    const ids = prefs.starred[list].filter((x) => x !== id);
    prefs.starred[list] = starred ? [...ids, id] : ids;
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    await fs.writeFile(PREFS_PATH, JSON.stringify(prefs, null, 2) + '\n');
    return prefs;
  });
  chain = run.catch(() => {});
  return run;
}
