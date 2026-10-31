---
name: continuity
description: Keep characters, props and places consistent across an AI Video Editor project with its continuity bible - what each looks like, where it sits (the boy's seat in the car, the handcuffs on the wheel), how it changes as the story goes on, and its reference images. Build or update the bible from the story, audit every image prompt against it for contradictions, fix them, and set up reference views. Use when the user mentions continuity, consistency between shots, a prop or character that keeps changing, where something is in a scene, or reference images for objects or characters.
---

# Continuity

The editor keeps a **continuity bible** per project (left panel → **Continuity**): characters, props
and places, each with:

- **Words that mean it** in an image prompt (its name always counts). Choose them so they don't
  match other things: "cuff" alone also matches "the cuff of his rain jacket"; "key" matches car keys.
- **How it looks and where it is**, the same in every picture. Write placement in the world's terms
  (behind the front passenger seat, left wrist, top of the steering wheel rim) and, for places seen
  from several directions, how that shows on screen ("facing back from the windshield, the booster seat
  is on the LEFT of the frame").
- **Changes as the story goes on**: from a scene on, until the next change ("from scene 80: one cuff on
  her left wrist, the other on the top of the steering wheel rim").
- **Reference views**: a character turnaround and a face close-up; a prop sheet (front, side, back, a
  key detail) and the prop in use; a plate per camera direction for a place, plus a top-down layout.
- **Attach**: send its first reference image with every picture it's in. On for props; off for
  characters and places, which scenes already pick as references (the right plate for the direction).

When a picture is generated, every entry its prompt names (minus the picture's "left out" ones, plus
its "added by hand" ones) adds a **Continuity** block to the prompt: its description and its state at
that point in the story. The image check (Gemini or Claude) scores against the same block, so a prop in
the wrong place fails as a `content` issue. A flash-forward scene (a cold open) points its **story
time** at the scene it shows, so it gets that scene's states.

Everything goes through `continuity.mjs` (the editor's API), from the repository root, in PowerShell,
cmd or bash:

```
node .claude/skills/continuity/continuity.mjs bible
node .claude/skills/continuity/continuity.mjs pictures [which] [--entry NAME]
node .claude/skills/continuity/continuity.mjs save <bible.json>
node .claude/skills/continuity/continuity.mjs prompt <picture> <file.txt>
node .claude/skills/continuity/continuity.mjs include|exclude|reset <picture> <entry>
node .claude/skills/continuity/continuity.mjs story-time <scene> <scene|->
node .claude/skills/continuity/continuity.mjs generate <entry> <view>
```

Pictures are named as the editor labels them: `63` for scene 63's own picture, `63.2` for its next one.
Write JSON and text files with the Write tool to the system temp folder (`$env:TEMP` in PowerShell,
`/tmp` elsewhere), never into the repository.

## Building or updating the bible

1. Read the story (the storyboard `.md` in the repository root if there is one) and `pictures` for
   the whole project.
2. List every character, prop and place that appears in more than one picture and has to look the same
   or sit in the same place. Props that the plot turns on (a key, a walkie-talkie, a bandage that gets
   worse) matter most.
3. For each, write the description, the words that mean it, the changes by scene, and the reference
   views (reuse library images that already exist: set the view's `asset_id`). Use `bible` first and keep
   existing `entry_id`, `view_id` and `state_id` values, so nothing that points at them breaks.
4. Show the user the list (names, the facts that matter, the changes) before saving it with `save`.
5. Check where each entry is detected (`pictures --entry NAME`): leave it out (`exclude`) of pictures that
   name it without showing it ("Eli's empty booster seat", "No Nora", a shot from Eli's point of view).
6. Set `story-time` for flash-forwards and flashbacks.

## Auditing the prompts

Go through `pictures` (in batches; subagents for a long project, each returning a list of findings)
and look for:

- Prompts that contradict the bible or its state at that point: the cuffs at nine o'clock when the bible
  says the top of the rim, the booster seat on the wrong side **for that camera direction**, a prop in the
  wrong hand, a bandage that is clean after it was soaked.
- Prompts that contradict each other where the bible says nothing yet: then the bible is missing a fact.
  Ask the user which is right, add it, and fix the prompts.
- Pictures that need an entry the prompt doesn't name (a close-up of her wrist without the word
  "handcuff"): `include` it.

Report each finding with the picture, the clashing sentence and the fix. Prompt wording that describes
where something is **in the frame** ("at the lower edge of the frame") is fine; only the world fact
must match. Apply fixes with `prompt` when the user agrees (or asked for fixes), changing only the
clashing words. A changed prompt leaves its picture out of date: list the pictures to regenerate.

## Reference views

Generating a view costs one image with the project's image model (free with a local model) and is
checked like any picture. Generate with the user's go-ahead: `generate <entry> <view>`, or the
**Generate** buttons in the Continuity tab. Generate a view's `based_on` views first (the turnaround
before the face close-up), so the later ones copy the earlier design.
