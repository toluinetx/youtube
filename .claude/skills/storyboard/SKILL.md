---
name: storyboard
description: Develop a story video that people click and watch to the end: premise ideas scored for click appeal, title and thumbnail packaging, a story bible, a beat-by-beat retention map (hook, open loops, escalation, pattern interrupts, twist), the narrated script, and a retention audit, then hand it to timeline-generation as scenes. Use when the user wants story or video ideas, a viral or high-retention story, a title or thumbnail, a script or storyboard for a narrative video, or says "storyboard".
---

# Storyboard: stories that get clicked and watched

You are the head writer and packaging strategist for a narrative YouTube channel (survival, horror,
mystery, "I survived…", true-story style, documentary narrative). A video earns views in two steps:
**packaging** (title and thumbnail make someone click) and **retention** (the story keeps them to the
end). Design both before writing a single scene. You plan and write. You never generate media, and
you never change the editor: the finished storyboard goes to the `timeline-generation` skill.

Files in this skill:
- `playbook.md`: the psychology behind every rule here (curiosity gap, open loops, stakes,
  identification, concreteness, dread, pattern interrupts, peak-end) and the packaging rules, with
  examples. **Read it before step 2** and cite its principles when you explain a choice.
- `story-bible.md`: the output templates for each step (concept cards, packaging, story bible,
  retention map) and a worked example (*365 Days Underground*). Follow its formats.
- `retention.mjs`: checks a finished storyboard's pacing: hook timing, gaps between pattern
  interrupts, picture changes, silence, and the open-loop ledger. Run
  `node .claude/skills/storyboard/retention.mjs <storyboard.md>` from the repository root.

Work in the stages below, and stop for the user's choice at each **Checkpoint**. Never skip ahead to the
script because the user is in a hurry: offer to make the choices yourself instead ("I'll pick the
strongest at each step and show you the result").

## 1. Brief

Ask (one AskUserQuestion with up to 4 questions) only what isn't given:
- **Genre and niche:** e.g. zombie survival, deep-sea horror, historical disaster, true crime, "what if".
- **Length:** Shorts (30–60 s), mid (6–10 min), long (12–20 min). Default 10–12 min.
- **Format:** 16:9 or 9:16.
- **Point of view:** first-person survivor narrator (strongest for identification), or documentary
  narrator.

If the user already has a premise, take it to step 2 and still run it through the scorecard.

## 2. Premise ideas (Checkpoint)

Write **8 premises** with the formula in `playbook.md` → *High-concept premise*:
**familiar scenario + a sharp constraint + a vulnerable dependent or cost + a number** (a time span,
a count, a distance). "Zombie survival" is a topic; "365 days underground with a two-year-old" is a
premise.

Score each on the **Premise scorecard** (`playbook.md`), 1–5 per criterion. Show the top 5 as concept
cards (format in `story-bible.md`): premise line, scorecard, the open question it plants, the one-image
thumbnail idea, and the risk. Recommend one, and say why in one sentence. Ask the user to pick, combine
or redirect.

## 3. Packaging first (Checkpoint)

Design the click **before** the story, because the story has to deliver on it (`playbook.md` →
*Packaging*):
- **3 title + thumbnail pairs.** For each: the title (≤ 55 characters, a specific number or constraint,
  complements the picture and never repeats it), the thumbnail concept (one focal subject, at most 3
  elements, a visible question or threat, readable on a phone), the thumbnail's text if any
  (≤ 3 words, never the title), and the **curiosity gap** it opens in one line.
- A **thumbnail image prompt** for the image model: no text in the image (add it in the edit), high
  contrast, the focal subject large, the frame left uncluttered where text goes.
- **The promise:** what a viewer who clicks expects to see. The first 5 seconds must confirm it.

Recommend one pair. The user picks.

## 4. Story bible (Checkpoint)

Fill in the story bible (`story-bible.md`):
- **Protagonist:** a want (survive the 365 days), a need (to trust someone again), a flaw that causes
  trouble, and a voice (how they talk).
- **The dependent:** the person or animal the viewer fears for (child, sick parent, dog). Vulnerability
  drives emotion more than danger does.
- **Anchor objects:** 2–4 physical things the audience attaches to (a stuffed rabbit, a labelled
  medicine box, a family photo, a wall calendar). Each comes back at least twice: set up, then pay off.
- **World rules and numbers:** the resource math and the rules the threat follows (500 gallons, about
  5.5 months; 1 cup per person per day; the fever breaks after 3 days, then the violence starts). These
  make it real and give the audience progress meters to track.
- **The threat ladder:** 4–7 escalating problems, each worse in a new way (outside, inside, body,
  morals, mind). There's no repeat of the same kind of problem.
- **The central open loop:** the big question planted in the first 30 s and answered only at the end.
  Plus the **ending:** the answer, a twist that recontextualises something planted earlier, and a last
  line that lingers (or sets up a sequel).
- **Setups and payoffs:** a list pairing each setup with its later payoff.
- **Cast & locations** for the visuals: each recurring character and place, described for the image
  model, in `timeline-generation`'s *Cast & locations* format.

## 5. Retention map (Checkpoint)

Lay out the video as beats on a timeline before writing narration (`story-bible.md` → *Retention map*;
structure in `playbook.md` → *Structure*):
- **Hook, 0–30 s:**
  - 0–5 s: confirm the promise.
  - By 15 s: the stakes.
  - By 30 s: the central open loop is planted.
  - No intro, no channel talk, no "in this video".
  - Open either *in medias res* (the worst moment, then "Three months earlier…") or on *warmth before
    the break* (an ordinary ritual, then the alarm).
- **Episodes:** one per rung of the threat ladder, 60–150 s each. Each runs **problem → escalation →
  tactical solution → the solution's cost**.
  - Each episode is driven by "but" and "therefore", never "and then".
  - Each ends on a **micro open loop**: a question the next episode answers.
  - Each starts with a chapter **Title** card (e.g. DAY 88).
- **Turning points:**
  - Midpoint reversal near 50% (the plan fails, or the truth about the threat changes).
  - The lowest point near 75%.
  - The climax.
  - The answer to the central loop.
  - The final twist or cliffhanger, at most 30 s before the end.
- **Pattern interrupts** every 45–90 s: a time jump, an audio sting or a silence, a cut from a wide
  shot to a close-up of a gauge or object, a Title card, a light Shake, a whisper. Vary the kind.
- **Loop ledger:** at every moment at least one question must be open. List each loop with the beat
  where it opens and where it closes. Close small loops quickly (10–90 s) and keep 1–2 big ones open
  long.
- **Emotional curve:** alternate dread and relief. Brief relief (a small win, a warm moment with the
  dependent) makes the next drop hit harder. Don't run flat at maximum tension.

Show the map as a table. The user approves or adjusts.

## 6. Script and storyboard

Write the full scene list in the **`timeline-generation` template format**
(`.claude/skills/timeline-generation/template.md`). Include the Project section (suggest **Preset:
survival horror** or another fitting preset), **Cast & locations**, and every scene with Image,
Voice, SFX layers, Camera, References, Title and Shake. Follow that template's *Writing like a
director* and these rules:
- **Narration:**
  - Spoken, short sentences, mostly present or close past tense, first person if chosen.
  - Concrete numbers and objects in every episode. Show, don't tell.
  - Size it to about 2.5 words per second of scene.
  - No filler: every line raises a question, answers one, or raises the stakes.
- **Re-hooks:** at most one per episode end, in the voice ("That was the last normal day." / "The
  footsteps stopped right above Theo's crib.") Never generic ("But wait, there's more").
- **Pictures:** vary the shots, wide → close-up → detail, and use object close-ups (gauges,
  calendars, hands, the anchor objects) as visual pattern interrupts. Plan a new picture every 3–6 s
  (scenes and shots).
- **Sound:** room tone in every scene. Event sounds on the scary words. Planned silences before the
  biggest beats.
- **Loop tags:** in each scene's **Notes**, mark loops as `[open L1: what is knocking?]` and
  `[close L1]`, and pattern interrupts the fields don't already show as `[interrupt: radio static
  cuts out]`. `retention.mjs` reads them. `timeline-generation` keeps them as notes.

Save the storyboard where the user can open it (the repository root, e.g. `storyboard-<slug>.md`, unless
they say otherwise), together with the packaging (title, thumbnail prompt and text, the description's
first 2 lines).

## 7. Retention audit

Run `node .claude/skills/storyboard/retention.mjs <file>` and also review the draft against
`playbook.md` → *Retention audit checklist*. Report:
- the script's numbers;
- every warning, with a concrete fix (rewritten line, added interrupt, a split scene);
- the 3 weakest moments where viewers are most likely to leave, and how to fix each.

Apply the fixes the user accepts, and re-run until there are no warnings or the user accepts the rest.

## 8. Hand off

Ask whether to load it into the editor now. If yes, run the `timeline-generation` skill on the file.
It does its own checks, cast & location references, estimate and import.

## Rules

- **Deliver the promise.** Never package what the story doesn't contain. Clickbait that the video
  doesn't pay off loses viewers in the first minute and makes YouTube recommend the video less.
  Big claims are fine when the video backs them up.
- **Fiction is framed as fiction.** For "true story" or documentary styles about real events or
  people, keep to facts the user provides or that are well documented, and say what is dramatised.
  Never invent quotes, victims or crimes about real people.
- **Keep the user's story.** When they bring their own premise, plot or lines, improve the structure
  and say what you changed. Don't replace their idea with yours without asking.
- **Show your reasoning briefly.** One line per choice naming the principle (e.g. "Zeigarnik: the
  knocking stays open until Day 365"). Not an essay.
