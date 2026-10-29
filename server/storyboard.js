import crypto from 'node:crypto';
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
  // Extra inputs per image model, keyed by model id: { 'black-forest-labs/flux-dev': { guidance: 4 } }.
  // Inputs left out keep the model's defaults.
  image_params: {},
  // Video model for "Generate video" (Gemini Omni), and its settings keyed by model id like image_params.
  video_model: 'gemini:gemini-omni-1.1-flash',
  video_params: {},
  // Library image assets sent as references for every scene (characters, locations, art style).
  reference_asset_ids: [],
  style_prompt: 'cinematic lighting, highly detailed, 35mm photo',
  voice_id: 'JBFqnCBsd6RMkjVDRZzb', // ElevenLabs "George"
  tts_model: 'eleven_multilingual_v2',
  // Voice settings (stability, similarity_boost, style, use_speaker_boost, speed, seed). Unset = the voice's own.
  tts_params: {},
  sfx_model: 'eleven_text_to_sound_v2',
  sfx_params: {}, // prompt_influence, loop, auto_duration
  motion: 'kenburns', // camera motion for images, one of MOTIONS (scenes can override it)
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

/** Camera motion for still images. 'kenburns' alternates zooming in and out from scene to scene. */
export const MOTIONS = ['kenburns', 'none', 'zoom_in', 'zoom_out', 'pan_right', 'pan_left', 'pan_down', 'pan_up'];

/** The motion a scene's image gets: its own, else the project's, with Ken Burns resolved to a zoom direction. */
export function sceneMotion(scene, settings, index) {
  const motion = scene.motion || settings.motion || 'none';
  if (motion === 'kenburns') return index % 2 === 0 ? 'zoom_in' : 'zoom_out';
  return motion;
}

export const RESOLUTIONS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * An extra sound effect layered over a scene. It plays together with the scene's main sound effect
 * (sfx_*), starting `start_sec` into the scene, at `volume` times the project's sound effect volume.
 */
export function newSfxLayer(fields = {}) {
  return {
    layer_id: `l_${crypto.randomBytes(4).toString('hex')}`,
    prompt: '',
    url: null,
    duration_sec: null,
    volume: 1,
    start_sec: 0,
    // How long to generate it (seconds); null = until the end of the scene.
    length_sec: null,
    // Words of the narration it's synced to (e.g. "breaks"): start_sec then follows the moment they're
    // spoken (see syncCues). null = start_sec is set by hand.
    cue: null,
    source_name: null, // original filename when imported
    ...fields,
  };
}

/** Fields of a layer that edits may change; the rest (its audio) only changes by generating or importing. */
export const SFX_LAYER_EDITABLE = ['prompt', 'volume', 'start_sec', 'length_sec', 'cue'];

const WORDS_PER_SEC = 2.5;
const PAUSE_TAG_SEC = 0.7;
const normalizeWord = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

/** The words of `text`, normalized, without audio tags. */
function spokenWords(text) {
  return text.replace(/\[[^\]\n]{1,60}\]/g, ' ').split(/\s+/).map(normalizeWord).filter(Boolean);
}

/** Index of the first occurrence of `cue` (one or more words) in `words`, or -1. */
function findCue(words, cue) {
  const target = spokenWords(cue);
  if (!target.length) return -1;
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((t, k) => words[i + k] === t)) return i;
  }
  return -1;
}

/**
 * When a cue is spoken, in seconds into the scene: exact from the voiceover's word timings when there
 * are any, otherwise estimated from the text (2.5 words a second, plus 0.7 s per pause or reaction tag
 * before it). Null if the cue isn't in the narration. Keep in sync with client/src/util.js.
 */
export function cueTime(scene, cue) {
  if (!cue?.trim()) return null;
  const timed = scene.voiceover_url && scene.voiceover_words?.length ? scene.voiceover_words : null;
  if (timed) {
    const i = findCue(timed.map((w) => normalizeWord(w.text)), cue);
    return i === -1 ? null : timed[i].start;
  }
  const text = scene.voiceover_text || '';
  const i = findCue(spokenWords(text), cue);
  if (i === -1) return null;
  // Tags before the cue that add a pause.
  const before = text.split(/\s+/).filter(Boolean);
  let count = 0;
  let pauses = 0;
  for (const token of before) {
    if (/^\[/.test(token)) {
      if (/pause|sigh|laugh|chuckle|gasp|exhale|inhale|breath|hesitat/i.test(token)) pauses++;
      continue;
    }
    if (normalizeWord(token)) {
      if (count === i) break;
      count++;
    }
  }
  return Math.round((i / WORDS_PER_SEC + pauses * PAUSE_TAG_SEC) * 10) / 10;
}

/** Move every cued sound effect layer and shot of a scene to the moment its cue is spoken. */
export function syncCues(scene) {
  for (const item of [...(scene.sfx_layers || []), ...(scene.shots || [])]) {
    const t = cueTime(scene, item.cue);
    if (t != null) item.start_sec = Math.round(t * 100) / 100;
  }
  return scene;
}

/**
 * A further picture within a scene: it takes over from the one before at `start_sec` (or when its
 * `cue` is spoken) and lasts until the next one. The scene's own image is the first shot.
 */
export function newShot(fields = {}) {
  return {
    shot_id: `s_${crypto.randomBytes(4).toString('hex')}`,
    image_prompt: '',
    image_url: null,
    motion: null, // camera motion (one of MOTIONS); null = the project's
    start_sec: 0,
    cue: null, // words of the narration it cuts to on, like a sound effect's cue
    source_name: null, // original filename when imported
    ...fields,
  };
}

/** Fields of a shot that edits may change; its picture only changes by generating or importing. */
export const SHOT_EDITABLE = ['image_prompt', 'motion', 'start_sec', 'cue'];

/** At most this many pictures per scene (its own image plus extra shots). */
export const MAX_SHOTS = 4;

/**
 * The scene's pictures in the order they're shown, each with when it starts and ends:
 * [{ shot (null for the scene's own picture), start, end }]. Extra shots without a picture, or that
 * start after the scene ends, are skipped: the picture before them carries on.
 */
export function sceneTimeline(scene) {
  const extra = (scene.shots || [])
    .filter((s) => s.image_url && s.start_sec > 0 && s.start_sec < scene.duration_sec)
    .sort((a, b) => a.start_sec - b.start_sec);
  const starts = [0, ...extra.map((s) => s.start_sec)];
  return [null, ...extra].map((shot, k) => ({ shot, start: starts[k], end: starts[k + 1] ?? scene.duration_sec }));
}

export function newScene(id, fields = {}) {
  return {
    scene_id: id,
    image_prompt: '',
    voiceover_text: '',
    sfx_prompt: '',
    // What should happen in a generated video clip; empty = use the image prompt.
    video_prompt: '',
    duration_sec: 5,
    image_url: null,
    voiceover_url: null,
    sfx_url: null,
    voiceover_duration_sec: null,
    // Spoken words of a generated voiceover with their times: [{ text, start, end }] (for syncing sounds).
    voiceover_words: null,
    sfx_duration_sec: null,
    // More sound effects playing at the same time as the main one (see newSfxLayer).
    sfx_layers: [],
    // More pictures after the scene's own one, each from its own time (see newShot).
    shots: [],
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
    // Also send the previous scene's picture (a video's last shown frame), for continuity between shots.
    use_previous_scene: true,
    motion: null, // camera motion for the image (one of MOTIONS); null = the project's
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
