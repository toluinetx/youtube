---
name: timeline-generation
description: Turn a scene list (exact timings plus image, voiceover, sound-effect prompts and notes) into scenes on the AI Video Editor's timeline, in a new or existing project, ready to generate. Use when the user gives scenes or a script to load into the editor, asks for the timeline template, or says "timeline-generation".
---

# Timeline generation

Load a scene list into the running AI Video Editor (this repository) as ungenerated scenes. The user
then reviews them and clicks Generate in the editor. **You never generate media**, with one exception:
the *Cast & locations* reference images (step 4), and only after the user approves the list and its
cost. You never edit `projects/*/storyboard.json` directly: always go through `timeline.mjs` (the
editor's API). That way the open editor updates live and the import is one Ctrl/Cmd+Z.

Files in this skill:
- `template.md`: the input format plus detailed guidance on writing good image, voice and sound
  prompts, and the **ElevenLabs audio tag reference and rules** (section "Audio tags"). Give it to the
  user when they need a starting point or ask how to write scenes. **Read its "Audio tags" section
  before writing or reviewing any voice lines.**
- `timeline.mjs`: helper that talks to the editor (`projects`, `voices`, `import <payload.json>`,
  `estimate <payload.json>`, `references <payload.json>`). Run it with
  `node .claude/skills/timeline-generation/timeline.mjs …` from the repository root.

The template's **Writing like a director** and **Presets** sections set the bar for story videos
(survival, horror, documentary). Read them before writing or reviewing scenes.

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
  - `sfx_prompt` ← SFX / Sound: the scene's **background**: the ambience or room tone that runs the
    whole scene.
  - `sfx_layers` ← **event sounds** on top of it (SFX 2–4, or the separate sounds in one SFX line), at
    most 3, so **4 sounds per scene in total**. See "Splitting sound effects" below:
    `[{ "prompt": "…", "cue": "breaks", "start_sec": 2.8, "length_sec": 1.5, "volume": 1 }]`.
  - `shots` ← more pictures within the scene (Shot 2–4): `[{ "image_prompt": "…", "cue": "tea",
    "start_sec": 4.0, "motion": "zoom_in" }]`. The scene's `image_prompt` is shot 1; each shot cuts in at
    its `cue` (words of the narration, timed exactly once the voiceover is generated) or `start_sec`,
    and lasts until the next. At most 3, so **4 pictures per scene**. The narration runs across them.
  - `video_prompt` ← Video / Motion prompt: what should happen in a generated clip (action, camera
    movement). Empty means the image prompt is used.
  - `motion` ← Camera / Movement for this scene's still image: `none` (still), `zoom_in`,
    `zoom_out`, `kenburns`, `pan_right` (left → right), `pan_left`, `pan_down` (top → bottom),
    `pan_up`. Leave it out to use the project's setting.
  - `reference_names` ← References / Location: names from *Cast & locations* (or images already in
    the project's Library) this scene uses as its own references, e.g. `["Kitchen"]`. Every-scene
    characters don't need listing.
  - `title_text` ← Title / On-screen text / Title card / Chapter: big text over the scene's first
    3 s on export (max 80 characters), e.g. `"DAY 12"`. Also when the notes ask for a title card.
  - `shake` ← Shake / Camera shake: `"light"` or `"heavy"`.
  - **Cast & locations** → the references payload (step 4): `{ "name", "prompt", "for_every_scene" }`
    each. Characters are `for_every_scene: true` unless marked *(only where named)*; locations are
    `false` and go in the scenes' `reference_names`. Write the prompts as described in "Cast &
    locations" below.
  - `notes` ← Notes, and anything that isn't one of the above (footage to import, on-screen text,
    transitions, music cues for a moment)
  - `duration_sec` ← end − start, or the given length, in seconds rounded to 0.1
- If you can't tell which field some text belongs to, ask. Don't guess.
- **Preset:** if the input names one (e.g. "survival horror"), fill in every Project line it leaves
  blank from the template's *Presets*, and say which lines you filled.

## 2. Check it before importing

- **Sound effects and shots:** at most 4 sounds (background + 3 layers) and 4 pictures (the scene's
  image + 3 shots) per scene. Every `cue` must appear in that scene's `voiceover_text`; every layer must
  fit in the scene (`start_sec + length_sec ≤ duration_sec`); every shot must cut in after 0 and before
  the scene ends, at least ~1.5 s after the one before. Report problems with the numbers.

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
- **People and hands (suggestions only):** image models often add an extra person or an extra hand.
  Flag image prompts (scene and shots) that show people without saying how many and who: a character
  who should be alone without "alone, the only person in the frame"; a hand close-up without whose
  hands and how many ("both of Eli's hands (two hands)"); two or more characters without "two people:
  … and …"; a crowd or background figures with no place that keeps them out of the main subject's space
  ("outside, beyond the window glass"); several actions by one character's hands at once. Offer the
  reworded prompt, keeping the user's wording otherwise.
- **References:** every `reference_names` entry must be in *Cast & locations* or already in the
  project's Library (`timeline.mjs projects` doesn't list the library; if unsure, ask). The import fails
  on a name it can't find. A scene's own references plus the every-scene ones must stay ≤ 14 (fewer
  for some models: about 3 for the first Nano Banana). Flag scenes that name a character from the cast
  without it being an every-scene reference or in their `reference_names`.
- **Finishing (suggestions only):** titles over 80 characters, or full sentences as titles (suggest
  the key number or phrase); `shake` on more than about 1 in 10 scenes; captions on while the scenes
  already burn text into the images.
- **Video requests:** a scene's video is made on demand in its **Video** tab (Gemini Omni, from
  `video_prompt` or else the image prompt; the scene's image becomes the first frame), never by the
  import. If a scene asks for real motion, keep the image prompt, put the action in `video_prompt`,
  and note "Generate video" (or the footage to import) in `notes`. A simple zoom or pan of a still
  is `motion`, no video needed. Say so.
- **Improvements (suggestions only):** after these checks, review the script as an editor would and
  suggest improvements to structure, timing and content. See "Suggesting improvements" below.
- **Cost:** with the checks, give the cost estimate (see "Estimating the cost").
- **Project settings** (title, format, style, motion, voice, voice model): map them to `title`,
  `aspect_ratio` (`16:9` | `9:16` | `1:1`), `style_prompt`, `motion` (same values as the scene field),
  `voice_id`, `tts_model` (`eleven_v4` | `eleven_v4_turbo` | `eleven_v3` | `eleven_multilingual_v2` |
  `eleven_turbo_v2_5` | `eleven_flash_v2_5`), and the finishing and camera lines: `motion_amount`
  (Camera move, percent, 1–40), `look` (`none` | `cold_bunker` | `teal_orange` | `bleach_bypass` |
  `warm_film` | `noir`), `vignette` and `grain` (0–1: the template's percent ÷ 100), `captions`
  (`off` | `words` | `lines`), `caption_position` (`bottom` | `center`), and `tts_params` for voice
  settings (`{ "stability": 0, "style": 0.3, "speed": 1 }`, only the keys given). Only the first three perform audio tags. For a voice given by name, run `timeline.mjs voices` and use the matching
  `voice_id`. Ask if no voice matches or several do. If the style is repeated in every image prompt,
  suggest moving it to `style_prompt`.

## Writing scenes from a story

When the user asks you to turn a story (or notes, an article, an outline) into a timeline:
1. **Ask first** about anything that decides the result and isn't given: target length or number of
   scenes, format (16:9 / 9:16), visual style (offer a preset when the genre fits, e.g. *survival
   horror*), and whether to use **audio tags**. Tags need the Eleven v4 / v3 voice model. Recommend
   Eleven v4 when the story is narrative or dramatic.
2. **Cast & locations first.** List the recurring characters (2+ scenes) and places (3+ scenes) with
   a full description each, as in the template's *Cast & locations*. Every scene prompt then calls
   them by exactly these names.
3. **Split** the story into scenes of one idea or beat each, usually 4–10 s (shorter for Shorts).
   Size each scene to its narration with the timing rule above.
4. **Write** for every scene, following `template.md` and its *Writing like a director*:
   - **Voice:** narration written to be heard, in the story's words where possible. If using tags,
     apply the template's "Rules for adding tags": tags only where the delivery shifts (a reveal,
     tension, a joke, a quoted character), right before the words they affect, auditory only, suited
     to the narrator and the tone, and at most about one per sentence or two in plain narration. Use
     punctuation (… — ! ?) and occasional CAPS for small effects instead of a tag.
   - **Image:** a full brief (subject, action, setting, composition, lighting, details), with
     recurring characters described identically each time, and no text in the image. State who is
     in the frame and how many ("Eli, alone, the only person in the car"; "both of Eli's hands (two
     hands)"), as in "People and hands" above.
   - **Voice (story channels):** written like a screenplay: concrete numbers, rules and procedures,
     show-don't-tell, short sentences. No summarising lines.
   - **SFX:** concrete sounds for scenes that need them, split and timed as in "Splitting sound
     effects" below. For story and suspense videos plan **three layers** (template: *Sound in three
     layers*): suggest a drone as the Music, give every scene a room tone (`sfx_prompt`) and 1–2
     precise event sounds (`sfx_layers`) timed to the words. Put sound effects here, not as tags in
     the voice.
   - **Video:** for the few scenes that deserve a clip, a **micro-motion** `video_prompt`: characters
     nearly still, only the air and light moving (dust, breath, flicker, rain), at most one slow
     camera move, "no cuts".
   - **Title / Shake:** a `title_text` at chapter or day changes and for key numbers; `shake` for the
     few threat beats.
   - **References:** `reference_names` for the location the scene is in.
   - **Notes:** footage ideas, music cues.
   Apply "Suggesting improvements" to your own draft before showing it: pacing, two-shot beats,
   framing variety.
5. Present it as a filled-in template with timings, *Cast & locations* first. Mention the voice model it assumes and say
   which tags you used and why, in one line. End it with the **cost estimate** (see "Estimating the
   cost" below). Revise until the user approves, then continue with step 2 (checks) and step 3 (where
   it goes). Re-run the estimate after a revision that adds or removes pictures, voice or sounds.

## Cast & locations

Reference images keep characters and places the same across every picture: the editor sends them
with each scene, and the image model copies them. Write each reference's `prompt` so it makes a
clean reference, in the project's style (the editor adds `style_prompt` itself):
- **Character:** *"Character reference sheet of Bucky, a man in his late thirties with a short dark
  beard, tired grey eyes and a scar over the left eyebrow, wearing a faded olive field jacket over a
  grey hoodie, cargo trousers and worn boots; full body, standing, neutral pose, facing the camera,
  plain light grey background, even soft light"*. One character per image, the whole outfit visible.
- **Location:** *"Empty establishing shot of the bunker kitchen: narrow concrete room, steel shelves
  of canned food on the left, a camping stove on a metal counter, a single caged bulb, a small
  periscope window high on the back wall; wide angle, eye level, no people"*. The layout and light
  sources that scenes will show from other angles; no people.

Name each exactly as the scenes do. Show the list with the rest of the template for approval.

## Estimating the cost

Every time you present a filled-in template (one you wrote, or the user's after your suggestions are
applied), estimate what generating it will cost. Write the scenes as an import payload (step 5's
format), plus the `references` list if there is one, to a temp file outside the repository and run
`node .claude/skills/timeline-generation/timeline.mjs estimate <file>`. It doesn't need the editor running.
- Set `project` to the target if you know it (`{ "id": … }` uses that project's models and
  references). Otherwise use `{ "new": "…" }`, which prices the new-project defaults. Say which.
- Put the input's project settings (voice model and so on) in `settings`, as for the import.
- Show the user its result briefly: the cast & location references (generated in step 4), the
  total for **Generate missing**, the ElevenLabs credits, the
  split (images / voice / sound), the optional video clips priced separately, and any model it has no
  price for. Per-scene costs only if the user asks, or if one scene stands out.
- It's an estimate of **one generation per item**: each regenerate costs that item again. The prices
  are the editor's own (the Usage panel), so if it reports a model with no price, tell the user to set
  one there rather than guessing a number yourself.
- If the estimate looks high, say what drives it (e.g. a 4K image size, many shots, a pricier image
  model, video clips) and what would make it cheaper. Suggest; don't change the template.

## Suggesting improvements

Every time you check scenes (given by the user or written by you), also review them as a video editor
would and suggest changes that would make the video better. **Suggest, never apply:** the user's script
is theirs. Apply only the suggestions they accept, exactly as shown.

Look for:
1. **Pacing.** A still image holds attention for about 3–6 s. Flag a scene longer than ~7 s whose
   image doesn't change, especially without narration, and suggest cutting it (give the new length)
   or splitting it. Tense or action beats want short scenes (2–4 s); calm or reflective beats can
   breathe (5–8 s) if the picture moves (`motion`) or the narration carries it. Flag runs of scenes with
   the same length or rhythm, and scenes too short for their narration (see Voice fit).
2. **More than one picture.** When an action has two or three distinct beats (a reveal, then a
   reaction; a cause, then its effect), or a wide view and a close detail, suggest **shots**: extra
   pictures within the same scene, so the narration isn't cut. Give each shot's image prompt and when
   it cuts in: a `cue` word when the narration mentions what it shows ("cut to the mug on *tea*"),
   otherwise a time. Keep each shot on screen for at least ~1.5 s, and at most 4 pictures per scene.
   Suggest **two scenes** instead only when the narration itself divides there (a new paragraph, a
   change of place or time) or one part needs its own video clip.
3. **Merging.** Consecutive scenes that repeat the same picture or beat: suggest merging them.
4. **Pictures.** Recurring characters called by their reference name ("Eli", not "a man"), the same
   description each time; variety of framing between neighbouring scenes (wide / medium / close-up);
   continuity with the previous shot (lighting, props, time of day); **text in images**: short
   on-screen text ("GRID ONLINE") often comes out misspelled. Suggest checking it, or adding it as an
   overlay in the edit (note it in `notes`). Point out where a camera `motion` suits the beat (slow
   zoom in for tension or relief, a pan to reveal a space) or where only a video clip shows the action.
5. **Narration.** Missing where the story needs explaining; too dense for the time; a line that says
   what the picture already shows. Write the suggested line, sized to the scene (Voice fit).
6. **Sound.** Split and timed as in "Splitting sound effects". A human sound (an exhale, a sigh)
   is better as an audio tag in the narration if it's the narrator's; as a sound effect if it's
   a character on screen and there's no narration.
7. **Structure.** Over the whole script: acts or beats that run long, a climax that comes too late, a
   jump the viewer can't follow, an ending that drags.

8. **Finishing.** A title card where a chapter, day or key number changes; shake on a threat beat
   that has none (or off where it's overused); a slower camera move (`motion_amount` 4–6) for
   suspense; a grade, vignette and captions if the project has none and the genre wants them.
9. **Consistency.** A recurring character or place without a *Cast & locations* entry; a scene in a
   known location that doesn't list it in References.

Present them as a numbered list grouped by scene, each with the reason and the exact change, then ask
which to apply (all, some by number, or none). Keep it to the ones that matter: a handful per scene at
most, and none for a scene that's fine. For example:

> **Scene 19 (3:00–3:10) · Power Restored & Relief**
> 1. **Two shots, and shorter (10 s → 8 s).** The beat has two parts: the console turning blue (the
>    cause) and Eli relaxing (the effect). One still for 10 s with no narration drags.
>    - Shot 1 · 0–3 s: *Close-up of the train cab's digital dashboard switching to calm cyan blue,
>      displaying "GRID ONLINE", soft warm cabin light around it.* Sound: gentle steam hiss at 0.5 s, 1.5 s.
>    - Shot 2 · from 3 s: *Eli sits back in the driver's seat of the cozy train cab, taking a slow sip of
>      tea from a metal mug, eyes half closed, relaxed, cyan glow of the console on his face.*
>      Camera: slow zoom in. Sound: long exhale at 5 s, 2 s.
>    - Background for the whole scene: calm ambient train hum.
> 2. **"Man" → "Eli"**, so his reference keeps him the same.
> 3. **"GRID ONLINE" is text in the image.** Check the spelling after generating, or add it as an
>    on-screen title in the edit instead (I'd note that).
> 4. **No narration** for 8–10 s after a tense act. Fine as a breather. Or add a short line, e.g.
>    *"[exhales] For the first time tonight… the grid holds."* (8 words + 1 tag ≈ 4 s).

## Splitting sound effects

The editor plays up to 4 sounds per scene at once: one background (`sfx_prompt`) and up to 3 event
sounds (`sfx_layers`), each generated separately with its own start time and length. Use this whenever
you write or import a scene's SFX, including when the user gives one SFX line that mixes several sounds
(e.g. "rain, thunder, glass breaking"). Show the split and its timing for approval; don't change the
user's sound descriptions beyond splitting them.

1. **Background → `sfx_prompt`:** what runs the whole scene (rain, engine hum, crowd murmur, room
   tone). One continuous sound bed; it's generated at the scene's length. Leave it empty if there's none.
2. **Each distinct event → one layer** (impacts, doors, footsteps, a scream, a chime, glass breaking),
   at most 3. Merge or drop the least important ones beyond that; say which. Don't split one continuous
   sound into several layers.
3. **Write each layer as a single event:** *"single glass window shattering, shards falling on a metal
   floor"*, not a whole soundscape.
4. **Size it with `length_sec`** (0.5–30), to the sound, never to the scene:
   - hits, impacts, clicks, a gunshot, a door slam, glass breaking: 1–2 s
   - short actions (a door opening, a sword drawn, a single chime, a gasp of wind): 2–3 s
   - movements and short sequences (footsteps across a room, a car passing, a power-down): 3–6 s
   - something building or lasting (an alarm, a rising rumble): up to the rest of the scene
   Make sure `start_sec + length_sec` fits in the scene (it's cut off at the scene's end otherwise).
5. **Time it to the narration with `cue`:** when the voiceover mentions the event, set `cue` to the
   exact word(s) of `voiceover_text` it should land on: the word of the action itself, e.g.
   "Suddenly the glass **breaks**" → `"cue": "breaks"`. Copy the word as written (punctuation and case
   don't matter); use two or three words if the word occurs more than once before it, e.g. `"glass
   breaks"`. The editor times it from the text now and **moves it to the exact moment the word is
   spoken when the voiceover is generated** (it gets word timings from ElevenLabs).
6. **Also set `start_sec`** as your estimate, so the plan you show has times: count the spoken words
   before the cue (not tags), ÷ 2.5, plus 0.7 s for each `[pause]`, `[long pause]` or reaction tag
   (`[sighs]`, `[gasps]`, `[laughs]`…) before it. Round to 0.1 s.
7. **Events not in the narration** (only in the action or image): no `cue`; set `start_sec` from where
   the action happens in the scene, e.g. at the cut (0) or after a line ends.
8. **`volume`** (0–2, default 1) only to make an event clearly louder or quieter than the bed.

Show the plan per scene, e.g.:

> Scene 4 · 10 s · "Then the lights die. [pause] Red. Something on this train has gone very wrong."
> - Background: low electrical hum, train wheels on rails (whole scene)
> - SFX 2: heavy electrical power-down thunk · at "die" (~1.2 s) · 1.5 s
> - SFX 3: high-pitched digital alarm chime, repeating · at "Red" (~2.3 s) · 4 s

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

## 4. Generate the cast & location references (only if there are any)

Only after the user approved the template **and** its estimate (which lists the references):
1. Ask once more with AskUserQuestion: "Generate N reference images now (~$X)?" Options: "Generate
   them" / "Skip: I'll add my own images to the Library with these names".
2. Write `{ "project": …, "settings": { …the project settings… }, "references": [ … ] }` to a temp
   file (the same `project` as the import; settings first so they're made in the video's style) and
   run `node .claude/skills/timeline-generation/timeline.mjs references <file>`. A `{ "new": … }`
   project is created here; the output gives its id: use `{ "id": … }` for the import, not `new`
   again (that would make a second project).
3. Show the result per reference, including any image-check problem, and ask the user to look at them
   in the editor's Library (regenerate or replace one there, keeping its name) before you import. A
   second run with the same name replaces it as the reference and keeps the old one as "(earlier)".

## 5. Import

Write the payload to a temp file outside the repository (e.g. in the system temp directory), then run
`node .claude/skills/timeline-generation/timeline.mjs import <file>`:

```json
{
  "project": { "new": "Secrets of the Deep Ocean" },
  "mode": "append",
  "settings": { "aspect_ratio": "16:9", "style_prompt": "cinematic documentary photograph, natural light" },
  "scenes": [
    {
      "duration_sec": 7, "image_prompt": "…", "voiceover_text": "… Suddenly the glass breaks.", "sfx_prompt": "…",
      "sfx_layers": [{ "prompt": "single glass window shattering", "cue": "breaks", "start_sec": 3.2, "length_sec": 1.5 }],
      "shots": [{ "image_prompt": "Close-up of the window glass shattering inward", "cue": "breaks", "start_sec": 3.2 }],
      "motion": "pan_right", "reference_names": ["Kitchen"], "title_text": "DAY 12", "shake": "light", "notes": "…"
    }
  ]
}
```

- `project`: `{ "new": "<title>" }` or `{ "id": "<existing id from projects>" }`.
- `mode`: `"append"` or `"replace"` (use `"append"` for a new or empty project).
- `settings`: optional, only the keys the user wants changed.
- `scenes`: only the scene fields above (`duration_sec`, `image_prompt`, `voiceover_text`, `sfx_prompt`, `sfx_layers`,
  `shots`, `video_prompt`, `motion`, `reference_names`, `title_text`, `shake`, `notes`). Omit empty fields.
  `duration_sec` is required.

If the editor isn't running, the helper says so. Ask the user to start it with `npm run dev` and
retry. On any other error, show it and fix the payload rather than retrying blindly.

## 6. Report back

Show the helper's summary (scene numbers, timings, what each scene has, notes) and remind the user:
- images are checked as they're generated: if one still has problems after its retries (an extra
  hand, an extra person), the scene shows a warning under its image saying what. Fix the prompt and
  regenerate. Guardrails and the check are on the Project tab (Images); the check needs a Gemini key
- nothing is generated yet: **Generate missing** in the top bar opens a review dialog (tick items, pick models,
  see costs; suggested video clips start unticked), or use each scene's Generate buttons
- the editor updated live (no reload needed), and **Ctrl/Cmd+Z** in the editor undoes the import
- any notes that need action (footage to import, music to add in the Library: for suspense, the
  drone bed)
- the grade, vignette, grain, captions, titles and shake appear in the **exported** video (the live
  preview approximates the grade and shows titles; captions need the generated voiceover)
