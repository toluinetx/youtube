import { useCallback, useEffect, useMemo, useState } from 'react';
import { AUDIO_TAG, shotNumbers, withoutSpeakers } from './util.js';

/**
 * The Review Wizard's data. Claude Code writes the open project's exports/review.json, which is polled:
 *
 *   { id, handled_until?, comments: [{ scene_id, text }],
 *     items: [{ key, scene_id, note?, current?, options: [url, ...] }] }
 *
 * comments are open items to show on a scene. items are pictures waiting for a choice (the bell); key
 * is the picture as the editor labels it ("45.2"), current the one in the film now, and numbers follow
 * the order of options. A new id starts a new round of choices. handled_until (ms) is when Claude Code
 * took the last pasted prompt: requests made before it are done, so they drop out of the wizard.
 *
 * What the user decides stays in this browser until they clear it: requests (regenerate this, because
 * of that) and decisions on items. Both go into one prompt to paste into Claude Code.
 */

const POLL_MS = 15000;
const EMPTY = { id: null, comments: [], items: [] };
const NOTHING = { requests: [], decisions: {}, reviewId: null };

/** What the voice says, without speaker labels and delivery tags. */
export const spoken = (text) => withoutSpeakers(text || '').replace(AUDIO_TAG, ' ').replace(/\s+/g, ' ').trim();

/** A scene's pictures, labelled as the editor labels them: "45", "45.2", … */
export function scenePictures(scene, number) {
  const numbers = shotNumbers(scene);
  const shots = [...(scene.shots || [])].sort((a, b) => numbers.get(a.shot_id) - numbers.get(b.shot_id));
  return [
    { key: `${number}`, url: scene.image_url, shot_id: null },
    ...shots.map((s) => ({ key: `${number}.${numbers.get(s.shot_id)}`, url: s.image_url, shot_id: s.shot_id })),
  ];
}

/** A scene's sound effects: the main one and its layers, those with a prompt or a file. */
export function sceneSounds(scene) {
  return [
    { layer_id: null, url: scene.sfx_url, prompt: scene.sfx_prompt },
    ...(scene.sfx_layers || []).map((l) => ({ layer_id: l.layer_id, url: l.url, prompt: l.prompt })),
  ].filter((s) => s.url || s.prompt?.trim());
}

export const requestId = (kind, sceneId, part) => `${kind}:${sceneId}:${part ?? ''}`;

function decisionLine(item, decision) {
  if (decision.type === 'accept') return `- ${item.key}: use #${decision.number}`;
  if (decision.type === 'keep') return `- ${item.key}: keep the current picture`;
  return `- ${item.key}: discard all and regenerate 20 new variants. Why: ${decision.why}`;
}

/** The text to paste into Claude Code: every request and decision so far ('' if there are none). */
export function reviewPrompt(review, requests, decisions) {
  const of = (kind) => requests.filter((r) => r.kind === kind).map((r) => `- ${r.label} (scene id ${r.scene_id}): ${r.why}`);
  const picks = review.items.filter((item) => decisions[item.key]).map((item) => decisionLine(item, decisions[item.key]));
  const section = (title, lines) => (lines.length ? [title, ...lines] : []);
  const body = [
    ...section('Images (regenerate 20 variants of each, unchecked, and put them in the Review Wizard):', of('image')),
    ...section('Voiceover (regenerate once):', of('voiceover')),
    ...section('Sound effects (regenerate once):', of('sfx')),
    ...section(`Picks from ${review.id}:`, picks),
  ];
  return body.length ? ['Apply my review.', ...body, 'Then re-export both copies.'].join('\n') : '';
}

/** The review file and the user's requests and decisions, for the open project (null until it's known). */
export function useReview(project) {
  const [review, setReview] = useState(EMPTY);
  const [state, setState] = useState(NOTHING);

  useEffect(() => {
    if (!project) return undefined;
    setState({ ...NOTHING, ...JSON.parse(localStorage.getItem(`review:${project}`) || '{}') });
    let last = null;
    const load = async () => {
      const res = await fetch('/exports/review.json', { cache: 'no-store' }).catch(() => null);
      const text = res?.ok ? await res.text() : null;
      if (text === last) return;
      last = text;
      setReview(text ? { ...EMPTY, ...JSON.parse(text) } : EMPTY);
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [project]);

  const update = useCallback(
    (change) =>
      setState((s) => {
        const next = { ...s, ...change(s) };
        localStorage.setItem(`review:${project}`, JSON.stringify(next));
        return next;
      }),
    [project],
  );

  // Decisions belong to one round of choices.
  const decisions = useMemo(() => (state.reviewId === review.id ? state.decisions : {}), [state, review.id]);
  const pending = useMemo(() => review.items.filter((item) => !decisions[item.key]), [review, decisions]);
  const requests = useMemo(() => state.requests.filter((r) => (r.at || 0) > (review.handled_until || 0)), [state.requests, review.handled_until]);
  const prompt = useMemo(() => reviewPrompt(review, requests, decisions), [review, requests, decisions]);

  return {
    review,
    requests,
    decisions,
    pending,
    prompt,
    addRequest: (request) => update((s) => ({ requests: [...s.requests.filter((r) => r.id !== request.id), { ...request, at: Date.now() }] })),
    removeRequest: (id) => update((s) => ({ requests: s.requests.filter((r) => r.id !== id) })),
    decide: (key, decision) => update(() => ({ reviewId: review.id, decisions: { ...decisions, [key]: decision } })),
    clear: () => update(() => ({ requests: [], decisions: {}, reviewId: review.id })),
  };
}
