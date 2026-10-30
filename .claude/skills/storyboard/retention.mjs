#!/usr/bin/env node
// Retention check for a storyboard in the timeline-generation template format.
//
//   node retention.mjs <storyboard.md> [--json]
//
// It reads the scenes ("### Scene 3 · 0:21–0:28" or "### Scene 3 · 7s") and their fields (Image, Voice,
// SFX 2–4, Shot 2–4, Video, Title, Shake, Notes), plus these tags in Notes:
//   [open L1: what is knocking?]   a question the viewer now wants answered
//   [close L1]                     …and where it's answered
//   [interrupt: radio cuts out]    a pattern interrupt the fields don't show
// Then it reports the hook timing, the gaps between pattern interrupts and picture changes, dead air,
// narration that won't fit, and the open-loop ledger (see playbook.md). Times are estimates: 2.5 words
// a second, as in the editor.
import fs from 'node:fs';

const WORDS_PER_SEC = 2.5;
const LIMITS = { interruptGap: 90, pictureCalm: 8, deadAir: 8, noOpenLoop: 15, hookLoop: 30, moveShare: 0.4, moveRun: 4 };

// Camera moves as the template writes them ("Camera: zoom in", "Shot 2 (at "tea", pan left → right)").
const MOVES = ['still', 'zoom in', 'zoom out', 'pan left → right', 'pan right → left', 'pan top → bottom', 'pan bottom → top', 'ken burns'];
// A shot's cue words are quoted, so they're left out ("at "still counting", zoom in" is a zoom in).
const moveOf = (text) => {
  const t = text.replace(/["“'][^"”']*["”']/g, ' ').toLowerCase();
  return MOVES.find((m) => t.includes(m)) ?? null;
};

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node retention.mjs <storyboard.md> [--json]');
  process.exit(1);
}
let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (err) {
  console.error(`ERROR: Could not read ${file}: ${err.message}`);
  process.exit(1);
}

// ---- Parse -------------------------------------------------------------------------------------

const clock = (s) => {
  const parts = s.trim().split(':').map(Number);
  return parts.reduce((t, p) => t * 60 + p, 0);
};
// Audio tags ([whispers]) and speaker labels ({Eli}) aren't spoken.
const withoutTags = (t) => t.replace(/\[[^\]\n]{1,60}\]|\{[^{}\n]{1,40}\}/g, ' ');
const words = (t) => withoutTags(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

function parseScenes(md) {
  const scenes = [];
  let scene = null;
  let field = null;
  for (const line of md.split('\n')) {
    const head = /^#{2,4}\s+Scene\s+(\d+)\s*[·\-–—:]\s*(.*)$/i.exec(line);
    if (head) {
      scene = { n: Number(head[1]), timing: head[2].trim(), fields: [] };
      scenes.push(scene);
      field = null;
      continue;
    }
    if (!scene) continue;
    if (/^#{1,3}\s/.test(line) || /^---\s*$/.test(line)) {
      // A new section ends the scene list part this scene belongs to.
      if (!/^#{2,4}\s+Scene/i.test(line)) scene = null;
      field = null;
      continue;
    }
    const f = /^\s*-\s+\*\*([^*]+?)\*\*\s*(.*)$/.exec(line);
    if (f) {
      // "SFX 2 (at "breaks", 1.5s):" → key "sfx 2", meta "at "breaks", 1.5s".
      const raw = f[1].replace(/:\s*$/, '');
      const meta = /\(([^)]*)\)/.exec(raw)?.[1] || '';
      const key = raw.replace(/\([^)]*\)/, '').replace(/:$/, '').trim().toLowerCase();
      field = { key, meta, value: f[2].replace(/^:\s*/, '').trim() };
      scene.fields.push(field);
    } else if (field && line.trim() && !/^\s*>/.test(line)) {
      field.value += ` ${line.trim()}`;
    }
  }
  return scenes;
}

const scenes = parseScenes(text);
if (!scenes.length) {
  console.error('ERROR: No scenes found. Scenes are "### Scene 1 · 0:00–0:07" headings with "- **Image:** …" fields.');
  process.exit(1);
}

// Timing: "m:ss–m:ss" ranges, or a length ("7s"); otherwise right after the previous scene.
let cursor = 0;
for (const s of scenes) {
  const range = /(\d+:\d{1,2}(?:\.\d+)?)\s*[–—-]\s*(\d+:\d{1,2}(?:\.\d+)?)/.exec(s.timing);
  const length = /(\d+(?:\.\d+)?)\s*s\b/.exec(s.timing);
  if (range) {
    s.start = clock(range[1]);
    s.end = clock(range[2]);
  } else {
    s.start = cursor;
    s.end = cursor + (length ? Number(length[1]) : 5);
  }
  cursor = s.end;
  const get = (k) => s.fields.filter((f) => f.key === k || f.key.startsWith(`${k} `));
  s.get = get;
  s.voice = get('voice').map((f) => f.value).join(' ').trim();
  s.notes = get('notes').map((f) => f.value).join(' ');
}
const total = scenes.at(-1).end;

/** Seconds into the scene that a field's "(at "word")" or "(from 4s)" points to. */
function fieldTime(s, meta) {
  const from = /from\s+(\d+(?:\.\d+)?)\s*s/i.exec(meta);
  if (from) return Math.min(s.end - s.start, Number(from[1]));
  const cue = /at\s+["“']([^"”']+)["”']/i.exec(meta);
  if (cue) {
    const spoken = words(s.voice).map(norm);
    const target = words(cue[1]).map(norm);
    for (let i = 0; i + target.length <= spoken.length; i++) {
      if (target.every((t, k) => spoken[i + k] === t)) return i / WORDS_PER_SEC;
    }
  }
  return 0;
}

// ---- Events ------------------------------------------------------------------------------------

const interrupts = []; // { t, kind, scene }
const pictures = []; // times a new picture appears
const moves = []; // { t, move (null = the project's default), scene } per picture
const loops = new Map(); // id → { id, label, open, close, openScene, closeScene }
const warnings = [];
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

for (const s of scenes) {
  const has = (k) => s.get(k).some((f) => f.value);
  const camera = s.get('camera').map((f) => f.value).join(' ');
  if (has('image') || has('video')) {
    pictures.push(s.start);
    if (has('image') && !has('video')) moves.push({ t: s.start, move: moveOf(camera), scene: s.n });
  }
  for (const shot of s.get('shot').filter((f) => f.value)) {
    const t = s.start + fieldTime(s, shot.meta);
    pictures.push(t);
    moves.push({ t, move: moveOf(shot.meta), scene: s.n });
  }
  if (has('title')) interrupts.push({ t: s.start, kind: 'title card', scene: s.n });
  if (has('shake')) interrupts.push({ t: s.start, kind: 'shake', scene: s.n });
  if (has('video')) interrupts.push({ t: s.start, kind: 'video clip', scene: s.n });
  if (s.get('shot').some((f) => /next frame/i.test(f.meta))) interrupts.push({ t: s.start, kind: 'flipbook', scene: s.n });
  for (const sfx of s.get('sfx').filter((f) => /^sfx\s*[2-4]/.test(f.key) && f.value)) {
    interrupts.push({ t: s.start + fieldTime(s, sfx.meta), kind: 'sound event', scene: s.n });
  }
  for (const m of s.notes.matchAll(/\[interrupt:?\s*([^\]]*)\]/gi)) {
    interrupts.push({ t: s.start, kind: m[1].trim() || 'interrupt', scene: s.n });
  }
  for (const m of s.notes.matchAll(/\[open\s+([\w-]+)\s*:?\s*([^\]]*)\]/gi)) {
    const id = m[1].toUpperCase();
    if (loops.has(id)) warnings.push(`Loop ${id} is opened twice (scene ${loops.get(id).openScene} and ${s.n}). Give each loop its own id.`);
    else loops.set(id, { id, label: m[2].trim(), open: s.start, openScene: s.n, close: null, closeScene: null });
  }
  for (const m of s.notes.matchAll(/\[close\s+([\w-]+)\s*\]/gi)) {
    const id = m[1].toUpperCase();
    const loop = loops.get(id);
    if (!loop) warnings.push(`Scene ${s.n} closes loop ${id}, which was never opened.`);
    else if (loop.close != null) warnings.push(`Loop ${id} is closed twice (scenes ${loop.closeScene} and ${s.n}).`);
    else Object.assign(loop, { close: s.end, closeScene: s.n });
  }
}

// ---- Checks ------------------------------------------------------------------------------------

// Hook.
const first5 = scenes.filter((s) => s.start < 5);
if (!first5.some((s) => s.get('image').some((f) => f.value) || s.get('video').some((f) => f.value))) {
  warnings.push('Nothing on screen in the first 5 s: the opening picture should confirm the title/thumbnail promise.');
}
const hookVoice = scenes.filter((s) => s.start < 30).map((s) => s.voice).join(' ');
const friction = /\b(welcome( back)?|subscribe|hey (guys|everyone)|in (this|today'?s) video|before we (start|begin)|let'?s get (started|into it)|my channel)\b/i.exec(hookVoice);
if (friction) warnings.push(`The first 30 s say "${friction[0]}": cut the intro talk and start in the story.`);
const firstLoop = [...loops.values()].sort((a, b) => a.open - b.open)[0];
if (!firstLoop) warnings.push('No [open Lx: …] tags in Notes, so open loops can\'t be checked. Tag where each question opens and closes.');
else if (firstLoop.open > LIMITS.hookLoop) {
  warnings.push(`The first open loop (${firstLoop.id}) starts at ${fmt(firstLoop.open)}: plant the central question in the first 30 s.`);
}

// Loop ledger: unclosed loops, and stretches where no question is open.
for (const loop of loops.values()) {
  if (loop.close == null) warnings.push(`Loop ${loop.id} ("${loop.label}") is never closed: pay it off, or make it a deliberate final cliffhanger.`);
}
if (firstLoop) {
  const lastBeat = total - 30; // the ending may close everything
  for (let t = firstLoop.open; t < lastBeat; t += 1) {
    const open = [...loops.values()].some((l) => l.open <= t && (l.close == null || l.close > t));
    if (open) continue;
    let end = t;
    while (end < lastBeat && ![...loops.values()].some((l) => l.open <= end && (l.close == null || l.close > end))) end += 1;
    if (end - t > LIMITS.noOpenLoop) warnings.push(`No open question from ${fmt(t)} to ${fmt(end)} (${end - t} s): open a new loop before closing the last one.`);
    t = end;
  }
}

// Pattern interrupts.
interrupts.sort((a, b) => a.t - b.t);
const marks = [0, ...interrupts.map((i) => i.t), total];
for (let i = 1; i < marks.length; i++) {
  const gap = marks[i] - marks[i - 1];
  if (gap > LIMITS.interruptGap) {
    warnings.push(`No pattern interrupt from ${fmt(marks[i - 1])} to ${fmt(marks[i])} (${Math.round(gap)} s): add a title card, a sound event, silence, a close-up or a shake.`);
  }
}
const kinds = Object.entries(interrupts.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
if (interrupts.length >= 6 && kinds[0][1] / interrupts.length > 0.6) {
  warnings.push(`${Math.round((kinds[0][1] / interrupts.length) * 100)}% of the pattern interrupts are ${kinds[0][0]}s: vary them so they keep working.`);
}

// Pictures.
pictures.sort((a, b) => a - b);
const pics = [...pictures, total];
let longHolds = 0;
for (let i = 1; i < pics.length; i++) {
  const hold = pics[i] - pics[i - 1];
  if (hold > LIMITS.pictureCalm) {
    longHolds++;
    if (longHolds <= 5) warnings.push(`One picture holds ${hold.toFixed(1)} s from ${fmt(pics[i - 1])}: add a shot (a close-up of an object or a reaction) or shorten it.`);
  }
}
if (longHolds > 5) warnings.push(`…and ${longHolds - 5} more pictures held longer than ${LIMITS.pictureCalm} s.`);

// Camera moves: one default on everything, or the same move again and again, reads as a slideshow.
moves.sort((a, b) => a.t - b.t);
const moveCounts = Object.entries(moves.reduce((m, p) => ({ ...m, [p.move ?? 'project default']: (m[p.move ?? 'project default'] || 0) + 1 }), {}))
  .sort((a, b) => b[1] - a[1]);
if (moves.length >= 10) {
  const unset = moves.filter((p) => !p.move).length;
  if (unset) warnings.push(`${unset} of ${moves.length} pictures have no Camera / shot move, so they all get the project's default: give each the move its beat calls for.`);
  const [top, n] = moveCounts.find(([m]) => m !== 'project default') ?? [];
  if (top && n / moves.length > LIMITS.moveShare) {
    warnings.push(`${Math.round((n / moves.length) * 100)}% of the pictures use "${top}": vary the camera (no move on more than ${LIMITS.moveShare * 100}%).`);
  }
  const runs = [];
  for (let i = 0; i < moves.length; ) {
    let j = i;
    while (j + 1 < moves.length && moves[j + 1].move === moves[i].move) j++;
    if (moves[i].move && moves[i].move !== 'still' && j - i + 1 >= LIMITS.moveRun) runs.push(`${j - i + 1}× "${moves[i].move}" from ${fmt(moves[i].t)} (scene ${moves[i].scene})`);
    i = j + 1;
  }
  if (runs.length) warnings.push(`Same camera move on ${LIMITS.moveRun}+ pictures in a row: ${runs.slice(0, 4).join('; ')}${runs.length > 4 ? ` and ${runs.length - 4} more` : ''}. Alternate moves between neighbouring pictures.`);
}

// Voice: lines that won't fit, and dead air.
let silentFrom = null;
for (const s of scenes) {
  const n = words(s.voice).length;
  const needed = n / WORDS_PER_SEC + (s.voice.match(/\[(pause|long pause|sighs?|laughs?|gasps?|exhales?|inhales?)[^\]]*\]/gi) || []).length * 0.7;
  if (needed > s.end - s.start - 0.3 && n) {
    warnings.push(`Scene ${s.n}: ${n} words need ~${needed.toFixed(1)} s but the scene is ${(s.end - s.start).toFixed(1)} s.`);
  } else if (n && s.end - s.start - needed > LIMITS.deadAir) {
    warnings.push(`Scene ${s.n}: ~${Math.round(s.end - s.start - needed)} s without narration after its ${n} words: fine if it's a planned silence, otherwise add lines or shorten it.`);
  }
  if (!n) silentFrom ??= s.start;
  if (n || s === scenes.at(-1)) {
    const until = n ? s.start : s.end;
    if (silentFrom != null && until - silentFrom > LIMITS.deadAir) {
      warnings.push(`No narration from ${fmt(silentFrom)} to ${fmt(until)} (${Math.round(until - silentFrom)} s): fine if it's a planned silence, otherwise add a line.`);
    }
    silentFrom = null;
  }
}

// Narration style: stacked fragments ("Keys. Bag. Eli.") and numbers used as stats read choppy and
// listy when they're on most lines. Spoken lines (dialogue in quotes) count like the rest.
const NUMBER_WORDS = /\b(?:\d[\d.,]*|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/gi;
const voiced = scenes.filter((s) => words(s.voice).length);
// An ellipsis inside a sentence is a beat, not its end.
const sentencesOf = (t) => withoutTags(t).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => words(x).length);
const allSentences = voiced.flatMap((s) => sentencesOf(s.voice));
const fragments = allSentences.filter((x) => words(x).length <= 4);
if (allSentences.length >= 20 && fragments.length / allSentences.length > 0.2) {
  const choppy = voiced.filter((s) => sentencesOf(s.voice).filter((x) => words(x).length <= 4).length >= 2).map((s) => s.n);
  warnings.push(
    `${fragments.length} of ${allSentences.length} narration sentences are 4 words or fewer (${Math.round((fragments.length / allSentences.length) * 100)}%): ` +
      'it reads choppy. Join them into spoken sentences and keep a clipped line for the few real blows' +
      (choppy.length ? `. Most in scene${choppy.length > 1 ? 's' : ''} ${choppy.slice(0, 12).join(', ')}${choppy.length > 12 ? ', …' : ''}.` : '.'),
  );
}
const numbered = voiced.map((s) => ({ n: s.n, count: (withoutTags(s.voice).match(NUMBER_WORDS) || []).length })).filter((x) => x.count);
if (voiced.length >= 10 && numbered.length / voiced.length > 0.3) {
  const heavy = numbered.filter((x) => x.count >= 2).map((x) => x.n);
  warnings.push(
    `${numbered.length} of ${voiced.length} narration lines have a number: keep the story's clock and its one or two rules, ` +
      'and say the rest as what it means ("the needle was already low", not "three-eighths of a tank")' +
      (heavy.length ? `. Two or more in scene${heavy.length > 1 ? 's' : ''} ${heavy.slice(0, 12).join(', ')}${heavy.length > 12 ? ', …' : ''}.` : '.'),
  );
}

// ---- Report ------------------------------------------------------------------------------------

const loopList = [...loops.values()].sort((a, b) => a.open - b.open);
const report = {
  scenes: scenes.length,
  length_sec: total,
  pictures: pictures.length,
  avg_picture_sec: Math.round((total / Math.max(1, pictures.length)) * 10) / 10,
  words: scenes.reduce((n, s) => n + words(s.voice).length, 0),
  interrupts: interrupts.length,
  interrupt_kinds: Object.fromEntries(kinds),
  camera_moves: Object.fromEntries(moveCounts),
  loops: loopList.map((l) => ({ id: l.id, label: l.label, open: fmt(l.open), close: l.close == null ? null : fmt(l.close) })),
  warnings,
};

if (flag === '--json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Retention check: ${file}`);
  console.log(`  ${report.scenes} scenes · ${fmt(total)} · ${report.words} words · ${report.pictures} pictures (one every ${report.avg_picture_sec} s)`);
  if (moves.length) console.log(`  camera: ${moveCounts.map(([m, n]) => `${n} ${m}`).join(', ')}`);
  console.log(`  ${report.interrupts} pattern interrupts: ${kinds.map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
  console.log(`  ${loopList.length} open loops:`);
  for (const l of loopList) console.log(`    ${l.id}  ${fmt(l.open)} → ${l.close == null ? 'never closed' : fmt(l.close)}  ${l.label}`);
  console.log(warnings.length ? `\n${warnings.length} warning(s):` : '\nNo warnings.');
  for (const w of warnings) console.log(`  - ${w}`);
}
