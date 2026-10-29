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
  prompts. Give it to the user when they need a starting point or ask how to write scenes.
- `timeline.mjs`: helper that talks to the editor (`projects`, `voices`, `import <payload.json>`).
  Run it with `node .claude/skills/timeline-generation/timeline.mjs …` from the repository root.

## 1. Get the scenes

- If the user has no scene list yet, point them to `.claude/skills/timeline-generation/template.md`
  (or paste the empty scene block and the key guidance) and stop until they send it.
- Accept the template format, or anything close: a table, a numbered list, a script with timings.
  Map each scene to these fields, keeping the user's wording **exactly** (don't rewrite, shorten or
  "improve" their text unless they ask):
  - `image_prompt` ← Image / Visual / Shot
  - `voiceover_text` ← Voice / VO / Narration / Script. Only the words to be spoken. Move delivery
    directions in parentheses (e.g. "(whispering)") to notes, unless the project uses `eleven_v3`
    and they're `[tags]`.
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
- **Voice fit:** words ÷ 2.5 = seconds spoken. Flag scenes where that exceeds `duration_sec − 0.3`,
  showing the word count and the seconds needed. If the voice runs long, the editor lengthens the
  scene on generation and shifts everything after it.
- **Weak prompts (suggestions only):** for image prompts missing a clear subject, setting, or
  shot/lighting description, for vague SFX (e.g. "spooky"), or for text-in-image requests, offer a
  concrete improved version using the guidance in `template.md`. Apply it only if the user agrees.
- **Video requests:** the editor can't generate video. If a scene asks for footage or motion
  beyond a slow zoom, keep the image prompt and put the footage request in `notes`, and say so.
- **Project settings** (title, format, style, motion, voice, voice model): map them to `title`,
  `aspect_ratio` (`16:9` | `9:16` | `1:1`), `style_prompt`, `motion` (`kenburns` | `none`),
  `voice_id`, `tts_model` (`eleven_multilingual_v2` | `eleven_v3` | `eleven_turbo_v2_5` |
  `eleven_flash_v2_5`). For a voice given by name, run `timeline.mjs voices` and use the matching
  `voice_id`. Ask if no voice matches or several do. If the style is repeated in every image prompt,
  suggest moving it to `style_prompt`.

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
