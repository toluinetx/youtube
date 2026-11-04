// Claude Code as the image checker: the editor runs the `claude` command-line tool on this machine
// (`claude -p`, signed in with the user's own account) to look at a generated picture and score how
// well it matches its brief. Nothing is sent anywhere else; Claude Code does the talking to Anthropic.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_DIR } from './paths.js';

const BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Math.max(30, Number(process.env.CLAUDE_CHECK_TIMEOUT_SEC) || 240) * 1000;
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CLAUDE_CHECK_CONCURRENCY) || 3));
const IS_WINDOWS = process.platform === 'win32';

/** A model name for `claude --model` from the setting ("claude" → the CLI's default, "claude:sonnet" → sonnet). */
export const isClaudeCheck = (model) => /^claude(?::|$)/.test(String(model || '').trim());
const cliModel = (model) => String(model || '').trim().replace(/^claude:?/, '') || null;

// ---- Scoring ----------------------------------------------------------------------------------------

/**
 * The most a picture can score with an issue of each type, however good it is otherwise: a viewer
 * forgives a soft background, not a third hand.
 */
export const SCORE_CAPS = {
  anatomy: 35, // a clear wrong count of arms, hands, fingers or legs; limbs attached to no one; merged or duplicated bodies or faces (not fingers that are merely soft)
  cast: 45, // more or fewer people than described, someone else's hands in a solo shot, the wrong or a missing main character
  text: 60, // garbled, misspelled or unwanted readable text
  content: 70, // a key prop or subject missing, night instead of day (or the reverse), something excluded that is prominent, a continuity fact broken
  minor: 100, // a small deviation a viewer might notice; costs points through the sub-scores only
};
const ISSUE_TYPES = Object.keys(SCORE_CAPS);
const WEIGHTS = { adherence: 0.45, logic: 0.35, quality: 0.2 };

/** The rubric Claude scores with (also in the vision-check skill, which uses the same caps). */
export const RUBRIC = `Score the picture on three sub-scores, each 0-100:
- adherence: how well it shows what the brief asks for: the subjects, how many people, key props, framing and camera position, time of day and light, and the things the brief excludes.
- logic: whether it makes physical and anatomical sense: every person has two arms, two hands and five fingers per hand, all attached to them; no merged or duplicated bodies or faces; objects work (a handcuff chain connects its two cuffs, a hand actually holds what it holds); light falls consistently.
- quality: technical quality: sharpness, no smeared or melted areas, no AI artefacts, no garbled text.

Then list every issue a viewer could notice, each as one short sentence an image model can act on (say what is wrong and where, e.g. "A second right hand reaches in from the left edge."), with a type:
- anatomy: a wrong count of arms, hands, fingers or legs; a limb attached to no one; merged or duplicated bodies or faces. Count the fingers of every hand that is in view: fewer than four fingers and a thumb is anatomy unless something plainly hides the rest. All five there but soft or blurred is minor. A torso that doesn't line up with the legs, or body parts that can't belong to one body, is anatomy too
- cast: more or fewer people than the brief describes; another person's hands or arms in a shot of a character described as alone; the wrong or a missing main character; the same character twice
- text: garbled, misspelled or unwanted readable text
- content: only a story-critical fact that is wrong: a key prop or main subject missing or plainly different; night instead of day or the reverse; something the brief excludes that is prominent; a Continuity fact broken so a viewer would notice (a prop in the wrong place or state, a character in the wrong seat or clothes, the bandage on the wrong arm)
- minor: any other deviation a viewer might notice, such as camera height or framing a little off, how far a blanket is pulled up, exactly where a lantern hangs or an object lies, a secondary detail of the setting, soft or indistinct fingers

Count the people and the hands you can see. Don't list matters of taste or details no viewer would notice. Be strict about hands and people: zoom in on every hand and count fingers.`;

/**
 * The overall score: the weighted sub-scores, capped by the worst issue (an extra hand caps it at 35).
 * Resolves `{ score, cap }`.
 */
export function overallScore({ adherence, logic, quality }, issues) {
  const clamp = (n) => Math.max(0, Math.min(100, Number.isFinite(Number(n)) ? Number(n) : 0));
  const weighted = WEIGHTS.adherence * clamp(adherence) + WEIGHTS.logic * clamp(logic) + WEIGHTS.quality * clamp(quality);
  const cap = Math.min(100, ...issues.map((i) => SCORE_CAPS[i.type] ?? 100));
  return { score: Math.round(Math.min(weighted, cap)), cap };
}

/**
 * Turn Claude's answer ({ adherence, logic, quality, people, hands, issues: [{ text, type }] }) into a
 * check record: { ok, score, scores, issues (worst first), issue_types, people, hands }.
 */
export function scoredCheck(answer, threshold) {
  const issues = (Array.isArray(answer.issues) ? answer.issues : [])
    .map((i) => (typeof i === 'string' ? { text: i, type: 'minor' } : { text: String(i?.text ?? ''), type: ISSUE_TYPES.includes(i?.type) ? i.type : 'minor' }))
    .filter((i) => i.text.trim())
    .sort((a, b) => SCORE_CAPS[a.type] - SCORE_CAPS[b.type])
    .slice(0, 6);
  const scores = Object.fromEntries(['adherence', 'logic', 'quality'].map((k) => [k, Math.round(Math.max(0, Math.min(100, Number(answer[k]) || 0)))]));
  const { score } = overallScore(scores, issues);
  const count = (n) => (Number.isFinite(Number(n)) && n !== null ? Number(n) : null);
  return {
    ok: score >= threshold,
    score,
    threshold,
    scores,
    issues: issues.map((i) => i.text.trim()),
    issue_types: issues.map((i) => i.type),
    people: count(answer.people),
    hands: count(answer.hands),
  };
}

// ---- Running Claude Code ----------------------------------------------------------------------------

let running = 0;
const waiting = [];
/** Run `fn` when one of the CONCURRENCY slots is free (each check is a separate Claude Code process). */
async function slot(fn) {
  if (running >= CONCURRENCY) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** cmd.exe needs arguments with spaces quoted when Node starts a .cmd shim through the shell. */
const quoteForShell = (a) => (IS_WINDOWS && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

/** Run `claude` with `args`, `input` on stdin; resolves with stdout. */
function runClaude(args, input, { cwd, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    // On Windows the npm install is a .cmd shim, which only starts through the shell.
    const child = spawn(BIN, IS_WINDOWS ? args.map(quoteForShell) : args, { cwd, shell: IS_WINDOWS, windowsHide: true, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude Code took more than ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? `Claude Code isn't installed here ("${BIN}" not found). Install it and sign in, or set CLAUDE_BIN in .env.` : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Claude Code exited with code ${code}: ${(err || out).trim().slice(-400)}`));
    });
    child.stdin.end(input ?? '');
  });
}

let statusCache = null;
/** Whether Claude Code can be run here: { ok, version } or { ok: false, error }. Cached for a minute. */
export async function claudeStatus() {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  const value = await runClaude(['--version'], '', { timeoutMs: 15_000 })
    .then((v) => ({ ok: true, version: v.trim() }))
    .catch((e) => ({ ok: false, error: e.message }));
  statusCache = { at: Date.now(), value };
  return value;
}

/** The first JSON object in `text` (Claude may wrap it in a code fence or a sentence). */
function firstJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`Claude Code didn't answer with JSON: ${text.trim().slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

const ANSWER = '"adherence": 0-100, "logic": 0-100, "quality": 0-100, "people": <number>, "hands": <number>, "issues": [{"text": "...", "type": "anatomy|cast|text|content|minor"}]';

/** A picture as a file Claude Code may read: { picture, temp } (temp: remove it afterwards). */
async function pictureFile({ file, buffer, ext }) {
  if (file) return { picture: file, temp: null };
  // Inside the project, so Claude Code is allowed to read it.
  const dir = path.join(PROJECT_DIR, 'media', '.checks');
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `check-${crypto.randomBytes(6).toString('hex')}.${ext || 'png'}`);
  await fs.writeFile(temp, buffer);
  return { picture: temp, temp };
}

/** One Claude Code run with read access to `pictures`. Resolves with { text, usd, model }. */
async function askClaude(prompt, pictures, model) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--max-turns', String(pictures.length + 3),
    '--strict-mcp-config',
    ...[...new Set(pictures.map((p) => path.dirname(p)))].flatMap((dir) => ['--add-dir', dir]),
    '--allowedTools', 'Read',
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task',
  ];
  const m = cliModel(model);
  if (m) args.push('--model', m);
  const out = await runClaude(args, prompt, { cwd: PROJECT_DIR, timeoutMs: TIMEOUT_MS * Math.max(1, Math.ceil(pictures.length / 2)) });
  let envelope;
  try {
    envelope = JSON.parse(out);
  } catch {
    throw new Error(`Unexpected output from Claude Code: ${out.trim().slice(0, 200)}`);
  }
  if (envelope.is_error || (envelope.subtype && envelope.subtype !== 'success')) {
    throw new Error(`Claude Code couldn't finish the check (${envelope.subtype || 'error'}): ${String(envelope.result || '').slice(0, 200)}`);
  }
  return { text: String(envelope.result || ''), usd: envelope.total_cost_usd ?? null, model: m || 'default' };
}

/**
 * Have Claude Code look at a picture (a file on disk, or a buffer + extension to write to a temporary
 * file) and score it against `brief`. Resolves with a check record (see scoredCheck) plus
 * { checker: 'claude', model, usage: { usd } }.
 */
export async function checkImageWithClaude({ file, buffer, ext, brief, model, threshold = 80 }) {
  return slot(async () => {
    const { picture, temp } = await pictureFile({ file, buffer, ext });
    try {
      const prompt = [
        'You check a picture generated for a video before it is used.',
        `Use the Read tool to look at the picture: ${picture}`,
        '',
        `The brief it was generated from:\n${brief}`,
        '',
        RUBRIC,
        '',
        'Answer with only this JSON object and nothing else:',
        `{${ANSWER}}`,
      ].join('\n');
      const { text, usd, model: used } = await askClaude(prompt, [picture], model);
      return { ...scoredCheck(firstJsonObject(text), threshold), checker: 'claude', model: used, usage: { usd } };
    } finally {
      if (temp) await fs.rm(temp, { force: true }).catch(() => {});
    }
  });
}

/**
 * Score several pictures in one Claude Code run, so they share its startup cost: `items` are
 * { file, buffer, ext, brief }. Resolves with { checks, usage: { usd } }: a check record per item, in
 * order. A picture the answer leaves out, or an answer that can't be read, is checked on its own; a run
 * that fails rejects, since checking one by one would fail the same way.
 */
export async function checkImagesWithClaude(items, { model, threshold = 80 }) {
  if (items.length === 1) {
    const { usage, ...check } = await checkImageWithClaude({ ...items[0], model, threshold });
    return { checks: [check], usage };
  }
  const answered = await slot(async () => {
    const files = await Promise.all(items.map(pictureFile));
    const pictures = files.map((f) => f.picture);
    try {
      const sameBrief = items.every((i) => i.brief === items[0].brief);
      const prompt = [
        `You check ${items.length} pictures generated for a video before they are used. Score each one on its own.`,
        'Use the Read tool to look at every picture:',
        ...pictures.map((p, i) => `Picture ${i + 1}: ${p}`),
        '',
        ...(sameBrief ? [`The brief they were all generated from:\n${items[0].brief}`] : items.map((it, i) => `The brief picture ${i + 1} was generated from:\n${it.brief}\n`)),
        '',
        RUBRIC,
        '',
        'Answer with only this JSON object and nothing else, with one entry per picture:',
        `{"pictures": [{"picture": <its number>, ${ANSWER}}]}`,
      ].join('\n');
      const { text, usd, model: used } = await askClaude(prompt, pictures, model);
      let entries = [];
      try {
        entries = firstJsonObject(text).pictures;
      } catch (err) {
        console.warn(`Couldn't read the batch check: ${err.message}`);
      }
      const byNumber = new Map((Array.isArray(entries) ? entries : []).map((e) => [Number(e?.picture), e]));
      const checks = items.map((_, i) => (byNumber.has(i + 1) ? { ...scoredCheck(byNumber.get(i + 1), threshold), checker: 'claude', model: used } : null));
      return { checks, usd };
    } finally {
      await Promise.all(files.map((f) => (f.temp ? fs.rm(f.temp, { force: true }).catch(() => {}) : null)));
    }
  });
  let usd = answered.usd;
  const checks = await Promise.all(answered.checks.map(async (check, i) => {
    if (check) return check;
    const { usage, ...single } = await checkImageWithClaude({ ...items[i], model, threshold });
    usd = (usd ?? 0) + (usage.usd ?? 0);
    return single;
  }));
  return { checks, usage: { usd } };
}
