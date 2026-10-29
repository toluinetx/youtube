---
name: timeline-generation
description: Turn a scene list (exact timings plus image, voiceover, sound-effect prompts and notes) into scenes on the AI Video Editor's timeline, in a new or existing project, ready to generate. Use when the user gives scenes or a script to load into the editor, asks for the timeline template, or says "timeline-generation".
---

# Timeline generation

Load a scene list into the running AI Video Editor (this repository) as ungenerated scenes. The user
then reviews them and clicks Generate in the editor. **You never generate media**, and you never edit
`projects/*/storyboard.json` directly: always go through `timeline.mjs` (the editor's API). That way
the open editor updates live and the import is one Ctrl/Cmd+Z.

Files in this skill:
- `template.md`: the input format plus detailed guidance on writing good image, voice and sound
  prompts, and the **ElevenLabs audio tag reference and rules** (section "Audio tags"). Give it to the
  user when they need a starting point or ask how to write scenes. **Read its "Audio tags" section
  before writing or reviewing any voice lines.**
- `timeline.mjs`: helper that talks to the editor (`projects`, `voices`, `import <payload.json>`).
  Run it with `node .claude/skills/timeline-generation/timeline.mjs …` from the repository root.

## 1. Get the scenes

- If the user has no scene list yet, point them to `.claude/skills/timeline-generation/template.md`
  (or paste the empty scene block and the key guidance) and stop until they send it.
- If they give a **story, article or outline** instead of scenes and ask you to turn it into a
  timeline, follow "Writing scenes from a story" below, show the result as a filled-in template for
  approval, and only then continue with step 2.
- Accept the template format, or anything close: a table, a numbered list, a script with timings.
  Map each scene to these fields, keeping the user's wording **exactly** (don't rewrite, shorten or
  "improve" their text unless they ask):
  - `image_prompt` ← Image / Visual / Shot
  - `voiceover_text` ← Voice / VO / Narration / Script: the words to be spoken, plus any
    `[audio tags]`. Keep tags the user wrote. Delivery directions in parentheses (e.g.
    "(whispering)") would be read aloud: suggest turning them into a tag (`[whispers]`) or moving
    them to notes, and ask.
  - `sfx_prompt` ← SFX / Sound
  - `notes` ← Notes, and anything that isn't one of the above (footage to import, on-screen text,
    transitions, music cues for a moment)
  - `duration_sec` ← end − start, or the given length, in seconds rounded to 0.1
- If you can't tell which field some text belongs to, ask. Don't guess.

## 2. Check it before importing

Report problems as a short list and ask how to fix each. Don't silently change timings or text.
- **Timing:** every scene needs a time. With start–end times, each scene must start where the
  previous one ended: list gaps and overlaps with the exact numbers and suggest a fix (e.g.
  "Scene 4 starts at 0:21 but scene 3 ends at 0:22: make scene 3 end at 0:21?"). Durations must be
  0.5–600 s. If the first start time isn't 0:00 and you're appending, that's fine (times are relative).
- **Voice fit:** count words **without** the `[tags]`. Words ÷ 2.5 = seconds spoken, plus about
  0.7 s for each reaction or pause tag (`[sighs]`, `[laughs]`, `[pause]`, `[long pause]`…). Flag
  scenes where that exceeds `duration_sec − 0.3`, showing the word count and the seconds needed. If
  the voice runs long, the editor lengthens the scene on generation and shifts everything after it.
- **Audio tags vs. voice model:** if any voice line contains `[tags]`, the target project's
  `tts_model` must be `eleven_v4`, `eleven_v4_turbo` or `eleven_v3`. Other models read tags out
  loud. Check the target project's `tts_model` (shown by `timeline.mjs projects`; a new project starts
  with `eleven_multilingual_v2`), or the input's Voice model line. If it doesn't support tags, ask: switch the project to Eleven v4
  (recommended), or strip the tags.
- **Tag quality (suggestions only):** flag tags that break the template's rules: visual actions
  (`[smiles]`, `[nods]`), `[music]`, SSML like `<break>`, sound effects that belong in the SFX field,
  or tags crowded onto nearly every phrase of plain narration.
- **Weak prompts (suggestions only):** for image prompts missing a clear subject, setting, or
  shot/lighting description, for vague SFX (e.g. "spooky"), or for text-in-image requests, offer a
  concrete improved version using the guidance in `template.md`. Apply it only if the user agrees.
- **Video requests:** the editor can't generate video. If a scene asks for footage or motion
  beyond a slow zoom, keep the image prompt and put the footage request in `notes`, and say so.
- **Project settings** (title, format, style, motion, voice, voice model): map them to `title`,
  `aspect_ratio` (`16:9` | `9:16` | `1:1`), `style_prompt`, `motion` (`kenburns` | `none`),
  `voice_id`, `tts_model` (`eleven_v4` | `eleven_v4_turbo` | `eleven_v3` | `eleven_multilingual_v2` |
  `eleven_turbo_v2_5` | `eleven_flash_v2_5`). Only the first three perform audio tags. For a voice given by name, run `timeline.mjs voices` and use the matching
  `voice_id`. Ask if no voice matches or several do. If the style is repeated in every image prompt,
  suggest moving it to `style_prompt`.

## Writing scenes from a story

When the user asks you to turn a story (or notes, an article, an outline) into a timeline:
1. **Ask first** about anything that decides the result and isn't given: target length or number of
   scenes, format (16:9 / 9:16), visual style, and whether to use **audio tags**. Tags need the Eleven
   v4 / v3 voice model. Recommend Eleven v4 when the story is narrative or dramatic.
2. **Split** the story into scenes of one idea or beat each, usually 4–10 s (shorter for Shorts).
   Size each scene to its narration with the timing rule above.
3. **Write** for every scene, following `template.md`:
   - **Voice:** narration written to be heard, in the story's words where possible. If using tags,
     apply the template's "Rules for adding tags": tags only where the delivery shifts (a reveal,
     tension, a joke, a quoted character), right before the words they affect, auditory only, suited
     to the narrator and the tone, and at most about one per sentence or two in plain narration. Use
     punctuation (… — ! ?) and occasional CAPS for small effects instead of a tag.
   - **Image:** a full brief (subject, action, setting, composition, lighting, details), with
     recurring characters described identically each time, and no text in the image.
   - **SFX:** concrete, layered sounds for scenes that need them. Leave it empty otherwise. Put
     sound effects here, not as tags in the voice.
   - **Notes:** footage ideas, on-screen text, music cues.
4. Present it as a filled-in template with timings. Mention the voice model it assumes and say
   which tags you used and why, in one line. Revise until the user approves, then continue with
   step 2 (checks) and step 3 (where it goes).

## 3. Ask where it goes, every time

Always ask both questions with AskUserQuestion, even if the answer seems obvious, and even if
the user answered them for an earlier import.

1. Run `timeline.mjs projects`, then ask **"Create a new project or add to an existing one?"**
   - Options: "New project" (suggest the title from the input, or ask for one), then the most
     recently updated existing projects (up to 3, each showing scene count and length, with the
     open one marked). The user can name another one via Other.
2. If the chosen project already has scenes, ask **"Add these scenes after the existing N scenes,
   or replace them?"**
   - "Add to the end (append)" / "Replace all N scenes". Replacing removes those scenes and their
     generated media from the timeline. It can be undone with Ctrl/Cmd+Z in the editor.
   - For a new or empty project, skip this question and say there is nothing to replace.
3. If the input sets project settings and the target is an existing project, list the settings
   that would change (old → new) and ask whether to apply them.

Opening a project switches every open editor tab to it. If that's a different project from the one
open now, mention it when asking: an edit typed in the half-second before the switch may not be
saved. A running export, generation or upload blocks the switch; the helper then reports it, and
you should ask the user to wait and retry.

## 4. Import

Write the payload to a temp file outside the repository (e.g. in the system temp directory), then run
`node .claude/skills/timeline-generation/timeline.mjs import <file>`:

```json
{
  "project": { "new": "Secrets of the Deep Ocean" },
  "mode": "append",
  "settings": { "aspect_ratio": "16:9", "style_prompt": "cinematic documentary photograph, natural light" },
  "scenes": [
    { "duration_sec": 7, "image_prompt": "…", "voiceover_text": "…", "sfx_prompt": "…", "notes": "…" }
  ]
}
```

- `project`: `{ "new": "<title>" }` or `{ "id": "<existing id from projects>" }`.
- `mode`: `"append"` or `"replace"` (use `"append"` for a new or empty project).
- `settings`: optional, only the keys the user wants changed.
- `scenes`: only these keys. Omit empty fields. `duration_sec` is required.

If the editor isn't running, the helper says so. Ask the user to start it with `npm run dev` and
retry. On any other error, show it and fix the payload rather than retrying blindly.

## 5. Report back

Show the helper's summary (scene numbers, timings, what each scene has, notes) and remind the user:
- nothing is generated yet: use **Generate missing** in the top bar, or each scene's Generate buttons
- the editor updated live (no reload needed), and **Ctrl/Cmd+Z** in the editor undoes the import
- any notes that need action (footage to import, music to add in the Library)
