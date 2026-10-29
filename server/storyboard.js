import fs from 'node:fs/promises';
import { PROJECT_DIR, PROJECT_ID, STORYBOARD_PATH } from './paths.js';
import { collect, recordChange, takeRedo, takeUndo } from './history.js';
import { broadcast } from './events.js';

export const DEFAULT_SETTINGS = {
  title: 'Untitled video',
  aspect_ratio: '16:9', // 16:9 = regular YouTube, 9:16 = Shorts
  fps: 30,
  image_model: 'black-forest-labs/flux-schnell',
  // Used instead of image_model whenever a scene has reference images (must accept image inputs).
  reference_model: 'google/nano-banana',
  // Library image assets sent as references for every scene (characters, locations, art style).
  reference_asset_ids: [],
  style_prompt: 'cinematic lighting, highly detailed, 35mm photo',
  voice_id: 'JBFqnCBsd6RMkjVDRZzb', // ElevenLabs "George"
  tts_model: 'eleven_multilingual_v2',
  motion: 'kenburns', // 'kenburns' | 'none'
  sfx_volume: 0.35,
  // Background music for the whole video (imported file, looped and faded)
  music_url: null,
  music_name: null,
  music_duration_sec: null,
  music_volume: 0.15,
  music_ducking: true, // lower the music while there's voiceover
};

/** Settings managed by upload endpoints rather than PUT /api/settings. */
export const READONLY_SETTINGS = ['music_url', 'music_name', 'music_duration_sec'];

export const SCENE_TEXT_FIELDS = ['image_prompt', 'voiceover_text', 'sfx_prompt'];

export const RESOLUTIONS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export function newScene(id, fields = {}) {
  return {
    scene_id: id,
    image_prompt: '',
    voiceover_text: '',
    sfx_prompt: '',
    duration_sec: 5,
    image_url: null,
    voiceover_url: null,
    sfx_url: null,
    voiceover_duration_sec: null,
    sfx_duration_sec: null,
    // An imported video replaces the image as the scene's visual.
    video_url: null,
    video_thumb_url: null,
    video_duration_sec: null,
    video_has_audio: false,
    video_start_sec: 0, // trim: where in the clip the scene starts
    video_volume: 1, // volume of the clip's own audio
    // Original filenames of imported files, keyed by slot (image | voiceover | sfx)
    source_names: {},
    // Library image assets used as references when generating this scene's image
    reference_asset_ids: [],
    use_global_references: true, // also send the project-wide references
    // Free-form notes for the editor (e.g. "import the drone clip here"); never sent to a generator.
    notes: '',
    ...fields,
  };
}

export function nextSceneId(storyboard) {
  return storyboard.scenes.reduce((max, s) => Math.max(max, Number(s.scene_id) || 0), 0) + 1;
}

export const SEED_TITLE = 'Secrets of the Deep Ocean';

const SEED = {
  settings: { ...DEFAULT_SETTINGS, title: SEED_TITLE },
  scenes: [
    newScene(1, {
      image_prompt: 'A lone research submarine descending into a dark blue ocean, shafts of sunlight fading above',
      voiceover_text: 'Below two hundred meters, sunlight disappears. Welcome to the twilight zone of the ocean.',
      sfx_prompt: 'deep underwater ambience, muffled bubbles, low submarine hum',
      duration_sec: 7,
    }),
    newScene(2, {
      image_prompt: 'Bioluminescent jellyfish glowing in pitch black water, neon blue and purple light trails',
      voiceover_text: 'Here, nearly ninety percent of creatures make their own light.',
      sfx_prompt: 'soft ethereal underwater shimmer, gentle sonar pings',
      duration_sec: 6,
    }),
    newScene(3, {
      image_prompt: 'An anglerfish with a glowing lure in the abyss, dramatic macro shot',
      voiceover_text: 'Some use it to hunt. Others use it to hide. And a few, we still do not understand at all.',
      sfx_prompt: 'ominous deep rumble, distant whale call',
      duration_sec: 8,
    }),
  ],
};

function normalize(sb) {
  const settings = { ...DEFAULT_SETTINGS, ...(sb.settings || {}) };
  const scenes = (sb.scenes || []).map((s, i) => newScene(s.scene_id ?? i + 1, s));
  // Uploaded files: { asset_id, name, type: image|video|audio, url, thumb_url, duration_sec, has_audio, size_bytes, added_at }
  const library = Array.isArray(sb.library) ? sb.library : [];
  return { settings, scenes, library };
}

export async function readStoryboard() {
  try {
    return normalize(JSON.parse(await fs.readFile(STORYBOARD_PATH, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Could not read ${STORYBOARD_PATH}: ${err.message}`);
    const seed = normalize(structuredClone(SEED));
    await writeStoryboard(seed);
    return seed;
  }
}

async function writeStoryboard(sb) {
  await fs.mkdir(PROJECT_DIR, { recursive: true });
  const json = JSON.stringify(sb, null, 2) + '\n';
  const tmp = STORYBOARD_PATH + '.tmp';
  await fs.writeFile(tmp, json);
  try {
    await fs.rename(tmp, STORYBOARD_PATH);
  } catch {
    // Windows can refuse the rename while an editor holds the file open.
    await fs.writeFile(STORYBOARD_PATH, json);
    await fs.rm(tmp, { force: true });
  }
}

// Serialize read-modify-write cycles so concurrent requests never clobber each other.
let chain = Promise.resolve();

export function serialized(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

/**
 * Re-reads storyboard.json (so hand edits are picked up), lets `mutate` change it, then writes it back.
 * Resolves with whatever `mutate` returns, or the storyboard if it returns nothing.
 * The change becomes one undo step named `label`; consecutive changes with the same `key` are merged.
 */
export function updateStoryboard(mutate, history) {
  return serialized(async () => {
    const sb = await readStoryboard();
    const before = JSON.stringify(sb);
    const result = await mutate(sb);
    const after = JSON.stringify(sb);
    if (after !== before) {
      await writeStoryboard(sb);
      await recordChange(before, after, history);
      broadcast({ type: 'storyboard', project: PROJECT_ID, label: history?.label ?? 'Edit' });
    }
    return result === undefined ? sb : result;
  });
}

/** Step back (or forward) through the history. Resolves with { storyboard, label }, or null if there's nothing to do. */
function travel(take) {
  return serialized(async () => {
    const current = JSON.stringify(await readStoryboard());
    const entry = take(current);
    if (!entry) return null;
    const sb = normalize(JSON.parse(entry.json));
    await writeStoryboard(sb);
    await collect(current, entry.json);
    broadcast({ type: 'storyboard', project: PROJECT_ID, label: entry.label });
    return { storyboard: sb, label: entry.label };
  });
}

export const undo = () => travel(takeUndo);
export const redo = () => travel(takeRedo);

export function findScene(sb, id) {
  const scene = sb.scenes.find((s) => String(s.scene_id) === String(id));
  if (!scene) throw Object.assign(new Error(`Scene ${id} not found`), { status: 404 });
  return scene;
}
