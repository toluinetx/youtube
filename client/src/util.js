export function formatTime(sec, precise = false) {
  const s = Math.max(0, sec || 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${(precise ? rest.toFixed(1) : Math.floor(rest).toString()).padStart(precise ? 4 : 2, '0')}`;
}

export function sceneStarts(scenes) {
  let t = 0;
  return scenes.map((s) => {
    const start = t;
    t += Number(s.duration_sec) || 0;
    return start;
  });
}

export function sceneIndexAt(starts, scenes, time) {
  for (let i = scenes.length - 1; i >= 0; i--) if (time >= starts[i]) return i;
  return 0;
}

export const ASSETS = [
  { kind: 'image', has: (s) => s.image_url || s.video_url, prompt: 'image_prompt', label: 'Image' },
  { kind: 'voiceover', has: (s) => s.voiceover_url, prompt: 'voiceover_text', label: 'Voiceover' },
  { kind: 'sfx', has: (s) => s.sfx_url, prompt: 'sfx_prompt', label: 'Sound effect' },
];

export function countMissing(scenes) {
  let n = 0;
  for (const s of scenes) {
    for (const a of ASSETS) if (s[a.prompt]?.trim() && !a.has(s)) n++;
    for (const l of s.sfx_layers || []) if (l.prompt?.trim() && !l.url) n++;
    for (const shot of s.shots || []) if (shot.image_prompt?.trim() && !shot.image_url) n++;
  }
  return n;
}

/** Whether a scene asks for a video clip and has none yet (as the server's Generate missing plan sees it). */
export const wantsVideo = (s) => Boolean((s.video_prompt?.trim() || /generate (a )?video/i.test(s.notes || '')) && !s.video_url);

/** A new, empty extra sound effect layer (the server keeps the id). */
export const newSfxLayer = () => ({
  layer_id: `l_${Math.random().toString(36).slice(2, 10)}`,
  prompt: '',
  url: null,
  duration_sec: null,
  volume: 1,
  start_sec: 0,
  length_sec: null,
  cue: null,
  source_name: null,
});

/** At most this many pictures per scene: its own image plus extra shots (keep in sync with the server). */
export const MAX_SHOTS = 4;

/** A new extra shot of a scene, starting at `startSec` (the server keeps the id). */
export const newShot = (startSec) => ({
  shot_id: `s_${Math.random().toString(36).slice(2, 10)}`,
  image_prompt: '',
  image_url: null,
  motion: null,
  start_sec: startSec,
  cue: null,
  source_name: null,
});

/**
 * The scene's pictures in the order they're shown: [{ shot (null = the scene's own), start, end }].
 * Extra shots without a picture, or starting outside the scene, are skipped. Keep in sync with
 * sceneTimeline in server/storyboard.js.
 */
export function sceneTimeline(scene) {
  const extra = (scene.shots || [])
    .filter((s) => s.image_url && s.start_sec > 0 && s.start_sec < scene.duration_sec)
    .sort((a, b) => a.start_sec - b.start_sec);
  const starts = [0, ...extra.map((s) => s.start_sec)];
  return [null, ...extra].map((shot, k) => ({ shot, start: starts[k], end: starts[k + 1] ?? scene.duration_sec }));
}

// Syncing sound effects and shots to words of the narration. Keep in sync with cueTime in server/storyboard.js.
const WORDS_PER_SEC_SPOKEN = 2.5;
const PAUSE_TAG_SEC = 0.7;
const normalizeWord = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
const spokenWords = (text) => text.replace(/\[[^\]\n]{1,60}\]/g, ' ').split(/\s+/).map(normalizeWord).filter(Boolean);

function findCue(words, cue) {
  const target = spokenWords(cue);
  if (!target.length) return -1;
  for (let i = 0; i + target.length <= words.length; i++) if (target.every((t, k) => words[i + k] === t)) return i;
  return -1;
}

/**
 * When a cue (words of the narration) is spoken, in seconds into the scene, and whether that's exact
 * (from the generated voiceover's word timings) or estimated from the text. Null if it isn't said.
 */
export function cueTime(scene, cue) {
  if (!cue?.trim()) return null;
  const timed = scene.voiceover_url && scene.voiceover_words?.length ? scene.voiceover_words : null;
  if (timed) {
    const i = findCue(timed.map((w) => normalizeWord(w.text)), cue);
    return i === -1 ? null : { sec: timed[i].start, exact: true };
  }
  const text = scene.voiceover_text || '';
  const i = findCue(spokenWords(text), cue);
  if (i === -1) return null;
  let count = 0;
  let pauses = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('[')) {
      if (/pause|sigh|laugh|chuckle|gasp|exhale|inhale|breath|hesitat/i.test(token)) pauses++;
      continue;
    }
    if (normalizeWord(token)) {
      if (count === i) break;
      count++;
    }
  }
  return { sec: Math.round((i / WORDS_PER_SEC_SPOKEN + pauses * PAUSE_TAG_SEC) * 10) / 10, exact: false };
}

// Keep in sync with EXTENSIONS in server/uploads.js
const EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'],
};

export const ACCEPT = Object.fromEntries(Object.entries(EXTENSIONS).map(([k, exts]) => [k, exts.map((e) => '.' + e).join(',')]));
ACCEPT.visual = `${ACCEPT.image},${ACCEPT.video}`;
ACCEPT.sound = `${ACCEPT.audio},${ACCEPT.video}`;

ACCEPT.all = `${ACCEPT.visual},${ACCEPT.audio}`;

/** Asset types each slot accepts (keep in sync with SLOT_TYPES in server/uploads.js). */
export const SLOT_TYPES = { image: ['image', 'video'], voiceover: ['audio', 'video'], sfx: ['audio', 'video'], music: ['audio', 'video'] };

export function assetFits(asset, slot) {
  return Boolean(asset && SLOT_TYPES[slot]?.includes(asset.type) && (slot === 'image' || asset.has_audio));
}

/** Drag-and-drop MIME type for library assets dragged within the app. */
export const ASSET_MIME = 'application/x-reel-asset';

export const ASPECT = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 };

/** Camera motion for still images (keep in sync with MOTIONS in server/storyboard.js). */
export const MOTIONS = [
  ['kenburns', 'Ken Burns (zoom in / out, alternating)'],
  ['none', 'Still'],
  ['zoom_in', 'Slow zoom in'],
  ['zoom_out', 'Slow zoom out'],
  ['pan_right', 'Pan left → right'],
  ['pan_left', 'Pan right → left'],
  ['pan_down', 'Pan top → bottom'],
  ['pan_up', 'Pan bottom → top'],
];
export const motionLabel = (id) => MOTIONS.find(([m]) => m === id)?.[1] ?? id;

// Keep in sync with server/ffmpeg.js.
const KENBURNS_ZOOM = 0.12;
const PAN_ZOOM = 0.15;

/** The motion a scene's image gets: its own, else the project's, with Ken Burns resolved to a zoom direction. */
export function sceneMotion(scene, settings, index) {
  const motion = scene.motion || settings.motion || 'none';
  if (motion === 'kenburns') return index % 2 === 0 ? 'zoom_in' : 'zoom_out';
  return motion;
}

/** CSS transform for `motion` at `progress` (0–1 through the scene), matching the exported video. */
export function motionTransform(motion, progress) {
  // Panning: zoomed in by PAN_ZOOM, sliding from one edge of the image to the other.
  const edge = (PAN_ZOOM / 2) * 100;
  const pan = (axis, from) => `translate${axis}(${from * edge * (1 - 2 * progress)}%) scale(${1 + PAN_ZOOM})`;
  switch (motion) {
    case 'zoom_in': return `scale(${1 + KENBURNS_ZOOM * progress})`;
    case 'zoom_out': return `scale(${1 + KENBURNS_ZOOM * (1 - progress)})`;
    case 'pan_right': return pan('X', 1);
    case 'pan_left': return pan('X', -1);
    case 'pan_down': return pan('Y', 1);
    case 'pan_up': return pan('Y', -1);
    default: return 'none';
  }
}

/** ElevenLabs audio tags in voiceover text, e.g. [whispers]. Only these voice models perform them; others read them aloud. */
export const AUDIO_TAG = /\[[^\]\n]{1,60}\]/g;
export const AUDIO_TAG_MODELS = ['eleven_v4', 'eleven_v4_turbo', 'eleven_v3'];

export function isTyping(e) {
  const el = e.target;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * One line about a finished "Generate missing" job, and whether it fell short: "Generated 12 of 30.
 * ElevenLabs ran out of credits at scene 8 (14 items skipped)."
 */
export function describeGeneration(result = {}) {
  const { generated = 0, failed = 0, total = generated + failed, out_of_credits: outOfCredits = [] } = result;
  const parts = [total && generated < total ? `Generated ${generated} of ${total}.` : `Generated ${generated} asset(s).`];
  for (const s of outOfCredits) {
    parts.push(`${s.provider} ${s.reason === 'account' ? 'refused the API key' : 'ran out of credits'} at scene ${s.scene}${s.skipped ? ` (${s.skipped} more item${s.skipped > 1 ? 's' : ''} skipped)` : ''}.`);
  }
  const otherFailures = failed - outOfCredits.length;
  if (otherFailures > 0) parts.push(`${otherFailures} failed (see warnings).`);
  if (outOfCredits.length) parts.push(`${outOfCredits.some((s) => s.reason !== 'account') ? 'Top up' : 'Fix the key'}, then Generate missing again to finish.`);
  return { text: parts.join(' '), ok: generated === total, outOfCredits: outOfCredits.length > 0 };
}
