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
  for (const s of scenes) for (const a of ASSETS) if (s[a.prompt]?.trim() && !a.has(s)) n++;
  return n;
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

export function isTyping(e) {
  const el = e.target;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
