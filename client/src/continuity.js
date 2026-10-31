// The same matching as server/continuity.js: an entry is in a picture when its prompt names it (its
// name or an alias, as whole words), plus the picture's include list, minus its exclude list.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mentions(entry, prompt) {
  return [entry.name, ...(entry.aliases || [])]
    .filter((w) => w && w.trim())
    .some((word) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(word.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(prompt || ''));
}

/** [{ entry, detected, included }] for one picture (`slot`: a scene or a shot). */
export function entriesFor(continuity = [], slot, prompt) {
  const include = new Set(slot?.continuity_include || []);
  const exclude = new Set(slot?.continuity_exclude || []);
  return continuity.map((entry) => {
    const detected = mentions(entry, prompt);
    return { entry, detected, included: (detected || include.has(entry.entry_id)) && !exclude.has(entry.entry_id) };
  });
}

/** How many pictures (scene images and shots) an entry is in. */
export function pictureCount(entry, scenes) {
  let n = 0;
  for (const s of scenes) {
    for (const slot of [s, ...(s.shots || [])]) {
      const hit = (mentions(entry, slot.image_prompt) || (slot.continuity_include || []).includes(entry.entry_id)) &&
        !(slot.continuity_exclude || []).includes(entry.entry_id);
      if (hit) n++;
    }
  }
  return n;
}

export const KIND_LABELS = { character: 'Character', prop: 'Prop', place: 'Place' };
