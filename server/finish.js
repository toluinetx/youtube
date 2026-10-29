import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Finishing applied to every scene clip on export: a colour grade ("look"), vignette, film grain,
// camera shake on tense scenes, and burned-in captions and on-screen titles. Each scene clip gets
// the same finishing, so the scenes still concatenate losslessly and unchanged ones stay cached.

/** The bundled caption font (SIL Open Font License, see fonts/OFL.txt), so captions look the same everywhere. */
export const FONT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts', 'Inter-ExtraBold.otf');
const FONT_NAME = 'Inter ExtraBold';

/**
 * Colour grades. Keep the ids and labels in sync with LOOKS in client/src/util.js (which also has the
 * CSS approximation the preview uses).
 */
export const LOOKS = {
  none: null,
  // Muted, desaturated blue-green shadows with warm lamp-lit highlights: bunkers, survival, horror.
  cold_bunker:
    'eq=contrast=1.08:saturation=0.72:gamma=0.97,' +
    'colorbalance=rs=-0.06:gs=0.02:bs=0.09:rm=-0.03:gm=0.03:bm=0:rh=0.07:gh=0.02:bh=-0.07',
  // Blockbuster teal shadows and orange skin tones.
  teal_orange: 'eq=contrast=1.07:saturation=1.05,colorbalance=rs=-0.09:gs=0.01:bs=0.1:rh=0.09:gh=0.02:bh=-0.09',
  // Low saturation, high contrast: war, grit, documentary.
  bleach_bypass: 'eq=contrast=1.22:saturation=0.5:gamma=0.96',
  // Soft warm film: nostalgia, cosy scenes.
  warm_film: 'eq=contrast=1.04:saturation=0.92,colorbalance=rm=0.05:gm=0.01:bm=-0.05:rh=0.03:bh=-0.03',
  // Black and white.
  noir: 'hue=s=0,eq=contrast=1.3:gamma=0.95',
};

/** Camera shake strength per scene: amplitude as a fraction of the frame width. */
export const SHAKES = { light: 0.004, heavy: 0.012 };

export const CAPTION_MODES = ['off', 'words', 'lines'];
export const CAPTION_POSITIONS = ['bottom', 'center'];

/**
 * Handheld-style shake: the frame is enlarged a little and the crop wanders on two mixed sine waves
 * per axis, so it never repeats visibly within a scene.
 */
function shakeFilter(kind, width, height) {
  const amp = SHAKES[kind];
  if (!amp) return null;
  const a = Math.max(2, Math.round(width * amp));
  const m = 2 * a;
  const wobble = (f1, p1, f2, p2) => `${m}+${a}*(0.6*sin(2*PI*${f1}*t+${p1})+0.4*sin(2*PI*${f2}*t+${p2}))`;
  return `scale=${width + 2 * m}:${height + 2 * m},crop=${width}:${height}:x='${wobble(1.3, 0, 3.7, 1.1)}':y='${wobble(1.7, 0.5, 4.3, 2.3)}'`;
}

/**
 * The video filters that finish a scene, in order (shake, grade, vignette, grain; captions are added
 * separately because they need a file), or '' for none. `vignette` and `grain` are 0–1.
 */
export function finishFilters({ look, vignette = 0, grain = 0, shake, width, height }) {
  const v = Math.min(1, Math.max(0, Number(vignette) || 0));
  const g = Math.min(1, Math.max(0, Number(grain) || 0));
  return [
    shakeFilter(shake, width, height),
    LOOKS[look] || null,
    v > 0 && `vignette=angle=${(0.2 + 0.5 * v).toFixed(3)}`,
    g > 0 && `noise=alls=${Math.round(4 + 20 * g)}:allf=t+u`,
  ]
    .filter(Boolean)
    .join(',');
}

// ---- Captions (ASS subtitles, rendered by libass) -------------------------------------------------

const WORDS_PER_SEC = 2.5;
const BREAK_AFTER = /[.!?;:,…—–-]["')\]]*$/;
const withoutTags = (text) => text.replace(/\[[^\]\n]{1,60}\]/g, ' ');

/**
 * The spoken words of a scene with their times (seconds into the scene): the voiceover's word timings
 * when it has them, otherwise its text spread evenly over the voiceover's length. Null without a voiceover.
 */
export function captionWords(scene) {
  if (!scene.voiceover_url) return null;
  if (scene.voiceover_words?.length) return scene.voiceover_words.filter((w) => w.text?.trim());
  const words = withoutTags(scene.voiceover_text || '').split(/\s+/).filter(Boolean);
  const total = scene.voiceover_duration_sec || words.length / WORDS_PER_SEC;
  const each = total / Math.max(1, words.length);
  return words.map((text, i) => ({ text, start: i * each, end: (i + 1) * each }));
}

/** Words grouped into what's on screen at once: up to `maxWords` and `maxChars`, broken after punctuation. */
function chunk(words, maxWords, maxChars) {
  const chunks = [];
  let current = [];
  for (const w of words) {
    const chars = [...current, w].map((x) => x.text).join(' ').length;
    if (current.length && (current.length >= maxWords || chars > maxChars)) {
      chunks.push(current);
      current = [];
    }
    current.push(w);
    if (BREAK_AFTER.test(w.text)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const assTime = (sec) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
// Braces start ASS override codes and a backslash starts an escape, so neither may reach the file.
const assText = (text) => text.replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\s+/g, ' ').trim();

const HIGHLIGHT = '&H003CC8FF'; // amber (ASS colours are &HAABBGGRR)

/**
 * An ASS subtitle file for one scene, or null when there's nothing to show. `mode` is 'words'
 * (a few words at a time, upper case, the word being spoken highlighted) or 'lines' (subtitle lines);
 * `title` is on-screen text (e.g. "DAY 12") shown big for the first seconds of the scene.
 */
export function captionsAss({ words, mode, position = 'bottom', title, width, height, duration }) {
  const events = [];
  const end = (t) => Math.min(duration, t);

  if (words?.length && (mode === 'words' || mode === 'lines')) {
    const byWord = mode === 'words';
    const chunks = byWord ? chunk(words, 3, 22) : chunk(words, 7, 38);
    chunks.forEach((c, k) => {
      const start = c[0].start;
      const until = end(Math.min(c.at(-1).end + 0.35, chunks[k + 1]?.[0].start ?? Infinity));
      if (start >= until) return;
      if (!byWord) {
        events.push(['Caption', start, until, assText(c.map((w) => w.text).join(' '))]);
        return;
      }
      const text = (i) =>
        c.map((w, j) => (j === i ? `{\\c${HIGHLIGHT}}${assText(w.text.toUpperCase())}{\\c&H00FFFFFF&}` : assText(w.text.toUpperCase()))).join(' ');
      c.forEach((w, i) => {
        const from = i === 0 ? start : w.start;
        const to = i < c.length - 1 ? Math.min(until, c[i + 1].start) : until;
        // The chunk pops in slightly when it appears.
        const pop = i === 0 ? '{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}' : '';
        if (to > from) events.push(['Caption', from, to, pop + text(i)]);
      });
    });
  }
  if (title?.trim()) {
    const from = Math.min(0.3, duration / 4);
    const to = Math.max(from + 0.5, Math.min(duration - 0.2, 3.3));
    events.push(['Title', from, end(to), `{\\fad(250,350)}${assText(title.toUpperCase())}`]);
  }
  if (!events.length) return null;

  const base = Math.min(width, height);
  const size = Math.round(base * 0.065);
  const titleSize = Math.round(base * 0.1);
  const center = position === 'center';
  const style = (name, fs, align, marginV, spacing) =>
    `Style: ${name},${FONT_NAME},${fs},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,${spacing},0,1,` +
    `${Math.max(2, Math.round(fs * 0.08))},${Math.round(fs * 0.04)},${align},${Math.round(width * 0.08)},${Math.round(width * 0.08)},${marginV},1`;
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ' +
      'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Caption', size, center ? 5 : 2, Math.round(height * (center ? 0 : 0.09)), 0),
    // Titles sit in the middle, or near the top when the captions are there.
    style('Title', titleSize, center ? 8 : 5, Math.round(height * 0.12), Math.round(titleSize * 0.08)),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events.map(([s, from, to, text]) => `Dialogue: ${s === 'Title' ? 1 : 0},${assTime(from)},${assTime(to)},${s},,0,0,0,,${text}`),
    '',
  ].join('\n');
}
