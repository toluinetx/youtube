// The continuity bible: what every character, prop and place looks like and where things are, kept
// in one place instead of scattered across the image prompts.
//
// storyboard.continuity = [{
//   entry_id, name, kind: 'character' | 'prop' | 'place',
//   aliases: words that mean it in an image prompt ("cuffs", "handcuff"); its name always counts,
//   description: how it looks and where it sits, the same in every picture,
//   states: [{ state_id, from_scene_id, text }]: how it is from that scene on (the bandage soaks
//           through, the cuffs move from her pocket to the wheel), until the next state,
//   views: [{ view_id, label, prompt, asset_id, based_on: [view_id] }]: its reference images (a
//          turnaround, a prop sheet, a plate per direction), generated into the library,
//   attach: send its first view as a reference image whenever it's in a picture (props: on),
// }]
//
// States follow the timeline; a flash-forward scene points at the scene it shows (continuity_at).
// When a picture is made, the entries its prompt mentions (plus or minus the picture's own
// continuity_include / continuity_exclude) add a "Continuity" block to the prompt and to the brief
// the image check scores against, and attached entries add their reference image.
import crypto from 'node:crypto';

export const KINDS = ['character', 'prop', 'place'];
const ATTACH_DEFAULT = { character: false, prop: true, place: false };
/** At most this many continuity reference images per picture (the scene's own references come first). */
export const MAX_CONTINUITY_REFS = 2;

const id = (prefix) => `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
const text = (v, max) => String(v ?? '').trim().slice(0, max);

export function newEntry(fields = {}) {
  const kind = KINDS.includes(fields.kind) ? fields.kind : 'prop';
  return {
    entry_id: typeof fields.entry_id === 'string' && /^c_[\w-]{1,24}$/.test(fields.entry_id) ? fields.entry_id : id('c'),
    name: text(fields.name, 80) || 'Untitled',
    kind,
    aliases: (Array.isArray(fields.aliases) ? fields.aliases : String(fields.aliases || '').split(','))
      .map((a) => text(a, 40))
      .filter(Boolean)
      .slice(0, 20),
    description: text(fields.description, 2000),
    states: (Array.isArray(fields.states) ? fields.states : [])
      .map((s) => ({
        state_id: typeof s?.state_id === 'string' && /^t_[\w-]{1,24}$/.test(s.state_id) ? s.state_id : id('t'),
        from_scene_id: s?.from_scene_id ?? null,
        text: text(s?.text, 1000),
      }))
      .filter((s) => s.text)
      .slice(0, 40),
    views: (Array.isArray(fields.views) ? fields.views : [])
      .map((v) => ({
        view_id: typeof v?.view_id === 'string' && /^v_[\w-]{1,24}$/.test(v.view_id) ? v.view_id : id('v'),
        label: text(v?.label, 80) || 'View',
        prompt: text(v?.prompt, 4000),
        asset_id: typeof v?.asset_id === 'string' ? v.asset_id : null,
        based_on: (Array.isArray(v?.based_on) ? v.based_on : []).map(String).slice(0, 4),
      }))
      .slice(0, 12),
    attach: typeof fields.attach === 'boolean' ? fields.attach : ATTACH_DEFAULT[kind],
  };
}

/** The bible as sent by the client, checked: entries in order, names unique. */
export function sanitizeContinuity(list) {
  if (!Array.isArray(list)) throw Object.assign(new Error('continuity must be a list of entries'), { status: 400 });
  const seen = new Set();
  return list.slice(0, 200).map((e) => {
    const entry = newEntry(e);
    const key = entry.name.toLowerCase();
    if (seen.has(key)) throw Object.assign(new Error(`Two continuity entries are called "${entry.name}"`), { status: 400 });
    seen.add(key);
    return entry;
  });
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `prompt` mentions the entry: its name or an alias as whole words, any case. */
function mentions(entry, prompt) {
  return [entry.name, ...entry.aliases].some((word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(word)}($|[^\\p{L}\\p{N}])`, 'iu').test(prompt));
}

/** The entry's state at `scene` (the latest state starting at or before it in timeline order), or null. */
export function stateAt(sb, entry, sceneId) {
  const order = new Map(sb.scenes.map((s, i) => [String(s.scene_id), i]));
  const here = order.get(String(sceneId));
  if (here === undefined) return null;
  let best = null;
  for (const s of entry.states) {
    const at = s.from_scene_id == null ? -1 : order.get(String(s.from_scene_id));
    if (at === undefined || at > here) continue;
    if (!best || at >= best.at) best = { at, state: s };
  }
  return best?.state ?? null;
}

/**
 * Continuity for one picture: `scene` (for its place in the story) and `slot` (the scene or one of its
 * shots, for its own include / exclude lists) with `prompt`. Resolves to
 * { entries: [{ entry_id, name, kind, detected, included, state }], text, referenceIds }:
 * `text` is the block to add to the prompt ('' if nothing applies) and `referenceIds` the library
 * images of attached entries (at most MAX_CONTINUITY_REFS).
 */
export function continuityFor(sb, scene, slot, prompt) {
  const include = new Set(slot?.continuity_include || []);
  const exclude = new Set(slot?.continuity_exclude || []);
  const byId = new Map(sb.library.map((a) => [a.asset_id, a]));
  // A flash-forward takes the states of the scene it shows (the cold open at Hour 37).
  const at = scene.continuity_at != null && sb.scenes.some((s) => String(s.scene_id) === String(scene.continuity_at)) ? scene.continuity_at : scene.scene_id;
  const entries = (sb.continuity || []).map((entry) => {
    const detected = mentions(entry, prompt || '');
    const included = (detected || include.has(entry.entry_id)) && !exclude.has(entry.entry_id);
    return { entry, detected, included, state: included ? stateAt(sb, entry, at) : null };
  });
  const used = entries.filter((e) => e.included);
  const lines = used.map(({ entry, state }) => {
    const parts = [entry.description, state && `Right now: ${state.text}`].filter(Boolean);
    return parts.length ? `- ${entry.name}: ${parts.join(' ')}` : null;
  }).filter(Boolean);
  const text = lines.length
    ? `Continuity (facts that hold across this video; follow them exactly, unless the description above shows one of them changing in this very picture):\n${lines.join('\n')}`
    : '';
  const referenceIds = used
    .filter(({ entry }) => entry.attach)
    .map(({ entry }) => entry.views.find((v) => v.asset_id && byId.get(v.asset_id)?.type === 'image')?.asset_id)
    .filter(Boolean)
    .slice(0, MAX_CONTINUITY_REFS);
  return {
    entries: entries.map(({ entry, detected, included, state }) => ({
      entry_id: entry.entry_id, name: entry.name, kind: entry.kind, detected, included, state: state?.text ?? null,
    })),
    text,
    referenceIds,
  };
}

/** The image prompt with its continuity block, as sent to the image model and the image check. */
export const withContinuity = (prompt, block) => (block ? `${prompt}\n\n${block}` : prompt);
