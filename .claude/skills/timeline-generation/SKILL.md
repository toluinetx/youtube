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

- If the user wants story ideas, a premise, packaging (title, thumbnail) or a high-retention script
  rather than loading scenes they already have, that's the `storyboard` skill: it develops the story
  and hands the finished scene list back here. Storyboards from it carry `[open L1: …]`,
  `[close L1]` and `[interrupt: …]` tags in Notes: keep them as notes.
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
    them to notes, and ask. Lines a character speaks (dialogue, a voice on a tape or walkie) get
    that speaker's label in front of them, `{Eli}`, and `{Narrator}` before the narration that
    follows: `"{Eli} [playfully] Eli to Mom, over. {Narrator} Every Saturday it was pancakes…"`.
    Every label must be a name in `voices` (below) or `Narrator`; the labels aren't spoken. A
    character's own voice replaces tags that faked it (drop `[childlike tone]` from Eli's lines).
  - `sfx_prompt` ← SFX / Sound: **one** continuous background sound for **this scene only**, on top
    of its ambience (a child breathing, a heartbeat), written as in "Writing a sound prompt" below. If
    it just describes the place's room tone, it belongs in the place's Ambience instead: suggest moving
    it (see "Sound" in "Suggesting improvements").
  - `ambience` ← Ambience: the **name** of the place's ambience bed (from the Project's Ambience
    list). Neighbouring scenes with the same name play one continuous loop.
  - `sfx_layers` ← **event sounds** on top of it (SFX 2–4, or the separate sounds in one SFX line), at
    most 3, so **4 sounds per scene in total**. See "Splitting sound effects" below:
    `[{ "prompt": "…", "cue": "breaks", "start_sec": 2.8, "length_sec": 1.5, "volume": 1 }]`.
  - `shots` ← more pictures within the scene (Shot 2–4, e.g. "Shot 2 (at "tea", zoom in)"):
    `[{ "image_prompt": "…", "cue": "tea", "start_sec": 4.0, "motion": "zoom_in" }]`. Each shot's
    `motion` takes the same values as the scene's. The scene's `image_prompt` is shot 1; each shot cuts in at
    its `cue` (words of the narration, timed exactly once the voiceover is generated) or `start_sec`,
    and lasts until the next. At most 3, so **4 pictures per scene**. The narration runs across them.
    A shot marked *next frame* ("Shot 2 (at "word", still, next frame)") gets `"continues": true`: it's
    generated as the next moment of the picture before, same framing (template: *Motion without video*).
    A shot with its own references ("Shot 2 (at "word", zoom in) [References: Kitchen, Eli]") gets
    `"reference_names": ["Kitchen", "Eli"]`, used instead of the scene's (same rules as below). Give one
    to every shot that shows other characters than the scene's own image, or faces the other way.
  - `video_prompt` ← Video / Motion prompt: what should happen in a generated clip. Only when the
    user asks for video clips; otherwise suggest a flipbook instead (shots with `continues`).
  - `motion` ← Camera / Movement for this scene's still image: `none` (still), `zoom_in`,
    `zoom_out`, `kenburns`, `pan_right` (left → right), `pan_left`, `pan_down` (top → bottom),
    `pan_up`. Leave it out to use the project's setting.
  - `reference_names` ← References / Location: names from *Cast & locations* (or images already in
    the project's Library) for what the scene's own image shows: **every character in it, even just a
    hand or an arm** ("Nora's right hand only" → `"Nora"`), plus the place's plate for the direction the
    camera faces, e.g. `["Kitchen", "Nora"]`. Leave out characters the picture doesn't show: a reference
    the model gets is a person it draws, so an extra one becomes a second person in the frame. A name
    that only marks an absence or the camera's position doesn't count ("no Eli", "Eli's empty booster
    seat", "taken from Eli's booster seat", "at Nora's eye level").
  - `use_previous_scene` ← `false` for every scene when the project's reference model is a local
    ComfyUI workflow (`comfyui:…`, e.g. Qwen Image Edit): it copies the picture before too closely (its
    people and framing), so the scene's own references carry the continuity instead. Leave it out
    otherwise.
  - `title_text` ← Title / On-screen text / Title card / Chapter: big text over the scene's first
    3 s on export (max 80 characters), e.g. `"DAY 12"`. Also when the notes ask for a title card.
  - `shake` ← Shake / Camera shake: `"light"` or `"heavy"`.
  - **Ambience** list (Project) → the payload's top-level `ambience`: `[{ "name": "Bunker", "prompt":
    "…", "volume": 0.3 }]` (volume 0–2; the template's percent ÷ 100). A name the project already has
    is reused as it is.
  - **Music** (Project) → settings `music_prompt`, `music_length_sec` (10–600, default 180) and
    `music_model` (`music_v1` | `music_v2` | `music_v2_5`), plus `music_volume` (0–1) if given.
  - **Cast & locations** → the references payload (step 4): `{ "name", "prompt" }` each. Characters
    and locations both go in the `reference_names` of each scene and shot that shows them, not in every
    scene: leave `for_every_scene` out (it's only for something that's in every single picture). Write
    the prompts as described in "Cast & locations" below.
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
- **Sound prompts:** every `sfx_prompt` and layer `prompt` is **one** sound: split any that name two
  sources or two things happening at once ("keys jangling, sirens"), as in "Splitting sound effects".
  Expand any under ~20 words into a full prompt ("Writing a sound prompt"). Do both yourself and say
  how many you split and expanded.
- **Ambience:** every scene's `ambience` must be a name in the Ambience list (or already in the
  project); the import fails otherwise.

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
  shot/lighting description, and especially for prompts that don't say **where the camera is and which
  way it faces**, what is left / right / behind the subject, or **where the light source is** (in cars and
  rooms these come out with impossible geometry: gauges in a door, a driver who seems to sit in the back), for vague SFX (e.g. "spooky"), or for text-in-image requests, offer a
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
  on a name it can't find. A picture's references plus the style images must stay ≤ 14 (fewer for some
  models: about 3 for the first Nano Banana, 6 for the local Qwen Image Edit). Then go through **every
  picture** (each scene's image and each shot) and fix these yourself, saying how many you fixed:
  - a character its prompt shows (by name, or only their hands or arm) that isn't in its references
    (the shot's own, or else the scene's);
  - a character in its references that it doesn't show, e.g. the scene's image is Eli and its shot
    is Nora's eyes: give the shot its own `reference_names`;
  - a place with plates for several directions where the picture has the wrong one (see "Cast &
    locations").
- **Finishing (suggestions only):** titles over 80 characters, or full sentences as titles (suggest
  the key number or phrase); `shake` on more than about 1 in 10 scenes; captions on while the scenes
  already burn text into the images.
- **Video requests:** prefer a **flipbook** for motion: 3–4 frames as shots with `continues: true`,
  same framing, ~1.5–2 s each, `motion: "none"` on all but the last (template: *Motion without
  video*). Flag `video_prompt` lines and offer to turn each into a flipbook. If the user does want
  clips: a scene's video is made on demand in its **Video** tab (Gemini Omni, from
  `video_prompt` or else the image prompt; the scene's image becomes the first frame), never by the
  import. If a scene asks for real motion, keep the image prompt, put the action in `video_prompt`,
  and note "Generate video" (or the footage to import) in `notes`. A simple zoom or pan of a still
  is `motion`, no video needed. Say so.
- **Improvements (suggestions only):** after these checks, review the script as an editor would and
  suggest improvements to structure, timing and content. See "Suggesting improvements" below.
- **Cost:** with the checks, give the cost estimate (see "Estimating the cost").
- **Camera (suggestions only):** count the pictures (scene images and shots) per camera move. Flag
  a move used on more than ~40% of them, 4+ pictures in a row with the same move, and scenes that
  leave `motion` empty so everything falls back to the project default. Suggest a move per picture
  by what it does in the story, as in the template's *Vary the camera and the cut*.
- **Project settings** (title, format, style, motion, voice, voice model): map them to `title`,
  `aspect_ratio` (`16:9` | `9:16` | `1:1`), `style_prompt`, `motion` (same values as the scene field),
  `voice_id`, `tts_model` (`eleven_v4` | `eleven_v4_turbo` | `eleven_v3` | `eleven_multilingual_v2` |
  `eleven_turbo_v2_5` | `eleven_flash_v2_5`), and the finishing and camera lines: `motion_amount`
  (Camera move, percent, 1–40), `look` (`none` | `cold_bunker` | `teal_orange` | `bleach_bypass` |
  `warm_film` | `noir`), `vignette` and `grain` (0–1: the template's percent ÷ 100), `captions`
  (`off` | `words` | `lines`), `caption_position` (`bottom` | `center`), and `tts_params` for voice
  settings (`{ "stability": 0, "style": 0.3, "speed": 1 }`, only the keys given). Only the first three perform audio tags. For a voice given by name, run `timeline.mjs voices` and use the matching
  `voice_id`. Ask if no voice matches or several do. The template's **Speakers** list becomes
  `voices`: `[{ "name": "Nora", "voice_id": "…" }, { "name": "Eli", "voice_id": "…" }]`, the names
  exactly as the Voice lines' `{labels}` use them; the Narrator's voice is `voice_id`. If the style is repeated in every image prompt,
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
   - **Voice (story channels):** written the way it's told out loud: whole sentences joined with
     *and*, *so*, *then*, concrete objects, rules and procedures, show-don't-tell. A clipped line is
     for the few real blows, not every line; numbers only for the story's clock and its one or two
     rules, everything else said as what it means. No summarising lines.
   - **SFX:** concrete sounds for scenes that need them, split and timed as in "Splitting sound
     effects" below. For story and suspense videos plan **three layers** (template: *Sound in three
     layers*): a generated drone as the Music (`music_prompt`), an **ambience bed per location**
     (the payload's `ambience`, each scene's `ambience` naming its place; leave planned silences
     without one), and 1–2 precise event sounds (`sfx_layers`) timed to the words. Use `sfx_prompt`
     only for what one scene adds to its place. Put sound effects here, not as tags in the voice.
     **One sound per prompt**, each written in full as in "Writing a sound prompt".
   - **Camera:** a `motion` on every scene and every shot, chosen for the beat, and a new picture
     every 2–4 s on most lines (template: *Vary the camera and the cut*). Vary the rhythm: pairs of
     pictures for most narration, quick runs for action, single long holds only for the biggest beats.
   - **Motion:** for the moments where something happens (glass bursting, a crowd turning, eyes
     clouding), a **flipbook**: 3–4 frames of the same framing as shots with `continues: true`, each
     prompt "The same <shot>, same framing, a moment later: <what changed>", camera still until the last
     frame. No `video_prompt` unless the user asks for video clips.
   - **Title / Shake:** a `title_text` at chapter or day changes and for key numbers; `shake` for the
     few threat beats.
   - **References:** `reference_names` for the characters each picture shows and the plate its camera
     faces; a shot that shows someone else, or looks the other way, gets its own.
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
- **Character: a turnaround sheet**, so the person stays the same from every angle: *"Character
  turnaround sheet of Bucky, a man in his late thirties with a short dark beard, tired grey eyes and a
  scar over the left eyebrow, wearing a faded olive field jacket over a grey hoodie, cargo trousers and
  worn boots; the same man shown four times side by side: front view, three-quarter view, side profile
  and back view, full body, standing, neutral pose, plain light grey background, even soft light"*.
  One character per image, the whole outfit visible in every view.
- **Location: one plate per direction the scenes look in**, usually the main view and its reverse:
  *"Empty establishing shot of the bunker kitchen from the doorway: narrow concrete room, steel shelves
  of canned food on the left, a camping stove on a metal counter, a single caged bulb, a small periscope
  window high on the back wall; wide angle, eye level, no people"*, then *"Bunker kitchen, facing the
  door"* with `"based_on": ["Bunker kitchen"]` and a prompt that starts *"The same empty room as the
  reference, now seen from the opposite direction: the camera is at the back wall facing the door…"* and
  says where each thing from the first plate now appears (left and right swap when you turn around).
  `based_on` sends the first plate as the design, so the second is the same place, not a new one. Add a
  third only for a direction many scenes use (a car seen from outside, a top-down view). Each picture
  lists the plate for the direction its camera faces: "Car interior, facing back" for a shot from the
  windshield looking back, the forward plate for one from the back seat looking forward, and both only
  for a mirror shot or a side view where both directions show. Without the reverse plate, shots facing
  the other way mix the two directions: a dashboard drawn in a door, a driver who seems to sit in the
  back. Sending both to a shot that faces one way mixes them too (an extra seat in the middle of the car).

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
   change of place or time). When the beat is an action happening, suggest a **flipbook** of 3–4
   *next frames* (shots with `continues: true`) rather than a video clip.
3. **Merging.** Consecutive scenes that repeat the same picture or beat: suggest merging them.
4. **Pictures.** Recurring characters called by their reference name ("Eli", not "a man"), the same
   description each time; variety of framing between neighbouring scenes (wide / medium / close-up);
   continuity with the previous shot (lighting, props, time of day); **text in images**: short
   on-screen text ("GRID ONLINE") often comes out misspelled. Suggest checking it, or adding it as an
   overlay in the edit (note it in `notes`). Point out where only motion shows the action, and
   suggest a flipbook for it.
   **Camera:** see the Camera check above. Suggest the move per picture with its reason ("zoom out:
   he's alone in the field"), and alternate moves between neighbouring pictures.
5. **Narration.** Missing where the story needs explaining; too dense for the time; a line that says
   what the picture already shows. Write the suggested line, sized to the scene (Voice fit).
6. **Sound.** Split and timed as in "Splitting sound effects". A human sound (an exhale, a sigh)
   is better as an audio tag in the narration if it's the narrator's; as a sound effect if it's
   a character on screen and there's no narration. Scenes in one place whose `sfx_prompt` lines all
   describe the same room tone: suggest one **ambience** bed for the place instead (it plays without a
   break across the cuts), keeping only what a scene adds. A story with no music: suggest a
   `music_prompt` that fits the genre.
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
sounds (`sfx_layers`), each generated separately with its own start time and length. **Every prompt is
one sound.** Use this whenever you write or import a scene's SFX, including when the user gives one SFX
line that mixes several sounds ("Alert tones fading, a dog barking somewhere, sirens closer" is three
prompts: the sirens as the background, the alert tones and the dog as two layers). Show the split and
its timing for approval; keep what the user asked for in each sound and write it out in full (see
"Writing a sound prompt").

1. **Background → `sfx_prompt`:** the one sound that runs the whole scene (sirens getting closer, a
   child breathing, a heartbeat). It's generated at the scene's length. Leave it empty if there's none.
   The place's own room tone (a quiet kitchen, crickets, a fridge hum) is the Ambience's job: leave it
   out rather than adding it here.
2. **Each other sound → one layer** (an impact, a door, footsteps, a scream, a chime, glass breaking,
   a dog barking, distant sirens), at most 3. Beyond 4 sounds in a scene, drop the least important or
   move a continuous one into the place's Ambience; say which. Don't split one continuous sound into
   several layers, and don't merge two sounds into one prompt to save a layer.
3. **One source, one action per prompt:** *"a large plate glass shop window shattering…"*, not
   *"glass shattering and people screaming"*. A sound that is one thing changing over time is still one
   sound (*"an engine accelerating, then settling into steady road noise"*); two things that happen
   at the same time are two prompts.
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
8. **`volume`** (0–2, default 1) only to make an event clearly louder or quieter than the bed: the
   template's *volume 70%* is `0.7` (distant sirens or a far generator under a close sound).

### Writing a sound prompt

ElevenLabs makes what the prompt describes, so describe the sound the way a sound designer would brief
it. Aim for **25–60 words**, one sound, in this order:

1. **The source and what it does**, specific: *"A pair of steel police handcuffs set down on a hard
   kitchen countertop"*, not *"a clink"*; *"a cheap plastic toy walkie-talkie squelch beep"*, not *"a
   beep"*.
2. **What it sounds like:** the texture and pitch (*a bright metallic clink and a short rattle of the
   chain*, *a low, wet, guttural groan*, *a thin steady mechanical hum with a faint tape flutter*).
3. **How it moves in time:** the attack, how it builds or repeats, how it ends (*one crisp click*,
   *starting faint and slowly rising*, *repeated every two seconds*, *cut off cleanly*, *fading into
   silence*).
4. **Where it is:** the distance and the space (*recorded very close and dry*, *a few houses away*,
   *heard from inside the car through the glass*, *a soft outdoor echo off houses*, *small kitchen room
   reflection*).
5. **The mood**, briefly (*tense and building*, *quiet and intimate*, *relentless and eerie*).
6. **What to leave out:** always *no music*, and *no voices* (or *no words* for breathing, crying and
   screams); plus anything the model tends to add (*no echo*, *no thunder*, *no high frequencies*, *no
   traffic*).

Don't put the length in the prompt (that's `length_sec`), and don't ask for speech or melody.

> **Before:** "Running footsteps on concrete, keys jangling, sirens"
> **After** (three prompts):
> - Background: *Running footsteps on a concrete driveway, a woman's quick sneakers slapping the
>   ground in a panicked sprint with a child's lighter quicker steps beside her, close and urgent
>   outdoors, early morning, no voices, no music*
> - SFX 2 · at "keys" · 1.5 s: *A bunch of car keys jangling hard in a running woman's hand, bright
>   metallic rattling of several keys on a ring, close and fast, outdoors, no voices, no music*
> - SFX 3 · from 0 s · 7 s · volume 60%: *Emergency sirens wailing in the distance across a suburb, a
>   constant faraway rise and fall of tones under the action, thin and outdoors, no traffic, no
>   music, no voices*

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
   run `node .claude/skills/timeline-generation/timeline.mjs references <file>`. References are made in
   the listed order, so put each location's main plate before the plates `based_on` it. A `{ "new": … }`
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
  "settings": {
    "aspect_ratio": "16:9", "style_prompt": "cinematic documentary photograph, natural light",
    "music_prompt": "slow dark ambient drone, deep sub-bass hum, no drums, no vocals", "music_length_sec": 180
  },
  "ambience": [{ "name": "Kitchen", "prompt": "quiet kitchen room tone, a fridge humming, rain on the window, steady, no voices", "volume": 0.3 }],
  "scenes": [
    {
      "duration_sec": 7, "image_prompt": "…", "voiceover_text": "… Suddenly the glass breaks.", "ambience": "Kitchen",
      "sfx_layers": [{ "prompt": "single glass window shattering", "cue": "breaks", "start_sec": 3.2, "length_sec": 1.5 }],
      "shots": [
        { "image_prompt": "Close-up of the window glass cracking", "cue": "Suddenly", "start_sec": 1.8, "motion": "none", "reference_names": ["Kitchen"] },
        { "image_prompt": "The same close-up, same framing, a split second later: the glass shattering inward", "cue": "breaks", "start_sec": 3.2, "motion": "none", "continues": true }
      ],
      "motion": "zoom_in", "reference_names": ["Kitchen"], "title_text": "DAY 12", "shake": "light", "notes": "…"
    }
  ]
}
```

- `project`: `{ "new": "<title>" }` or `{ "id": "<existing id from projects>" }`.
- `mode`: `"append"` or `"replace"` (use `"append"` for a new or empty project).
- `settings`: optional, only the keys the user wants changed.
- `ambience`: optional, the ambience beds the scenes name.
- `scenes`: only the scene fields above (`duration_sec`, `image_prompt`, `voiceover_text`, `sfx_prompt`, `sfx_layers`,
  `shots`, `video_prompt`, `motion`, `reference_names`, `use_previous_scene`, `ambience`, `title_text`, `shake`, `notes`).
  Omit empty fields.
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
- the music and the ambience loops are generated with the rest by **Generate missing** (listed under
  "Whole video"), or one at a time in the **Music** tab, where each ambience can also be assigned to
  the selected scenes; ElevenLabs Music has no price in the estimate until one is set in the Usage panel
- any notes that need action (footage to import)
- the grade, vignette, grain, captions, titles and shake appear in the **exported** video (the live
  preview approximates the grade and shows titles; captions need the generated voiceover)
