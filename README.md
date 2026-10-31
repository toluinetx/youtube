# AI Video Editor

A local web app for building YouTube videos out of scenes. Each scene has a visual (an image generated
with Replicate or the Gemini API, a Gemini Omni video clip, or your own image or video clip), a voiceover (ElevenLabs text-to-speech or your
own recording) and an optional sound effect (ElevenLabs or your own file). Add background music for the
whole video (generated with ElevenLabs Music, or your own track) and a looping ambience per location,
edit everything on a timeline, regenerate or replace just the pieces that look or sound
wrong, and export a single MP4 with FFmpeg.

```
┌───────────────────────────── Browser (http://localhost:5173) ─────────────────────────────┐
│  Preview player (live / rendered)            │  Inspector: prompts, voiceover, SFX,      │
│  Timeline: Image · Voice · SFX tracks        │  [Generate / Regenerate] buttons, project │
└──────────────────────────────────────┬────────────────────────────────────────────────────┘
                                       │ REST
┌──────────────────────────────────────▼──── Express API (http://localhost:3001) ───────────┐
│  projects/<id>/storyboard.json   Replicate API   ElevenLabs API   FFmpeg (bundled via npm)│
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

## Setup

Requires Node.js 22+. FFmpeg ships with the npm dependencies, so you don't need to install it.

```bash
npm install
cp .env.example .env       # then paste your REPLICATE_API_TOKEN and ELEVENLABS_API_KEY (GEMINI_API_KEY optional)
npm run dev                # API on :3001, editor on http://localhost:5173
```

The top bar shows a green dot for each service that is configured. Restart `npm run dev` after editing `.env`.

## Projects

Each video is a **project**. Click the project title in the top bar to switch projects or start a new one.
Every project has its own scenes, library, music, undo history and exports. The editor reloads
when you switch, and every open tab follows. Switching waits until running generations, uploads and
exports have finished.

## Building a timeline with Claude Code (`timeline-generation` skill)

If you use [Claude Code](https://claude.com/claude-code) in this repository, the `timeline-generation` skill
turns a detailed scene list into scenes on the timeline, with exact timings and image, voiceover and sound
prompts, ready for you to review and generate.

1. Start the editor (`npm run dev`).
2. Fill in [`.claude/skills/timeline-generation/template.md`](.claude/skills/timeline-generation/template.md).
   It explains how to write image, voice and sound prompts that generate well. You can also ask Claude
   for the template, or give it scenes in your own format.
3. Ask Claude to use it, e.g. *"use timeline-generation with my-scenes.md"*. Claude checks the timings
   (gaps, overlaps, voiceover that won't fit) and suggests prompt improvements. It then asks **which
   project** (new or existing) and, if that project has scenes, whether to **add or replace** them. It
   asks this every time.
4. The scenes appear in the open editor straight away, with nothing generated yet. Review them, then
   use **Generate missing** or each scene's Generate buttons. <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undoes the
   whole import.

The skill goes through the editor's API (`POST /api/scenes/import`), never by editing files, so the
editor stays in sync and undo works.

**Story development (`storyboard` skill).** Before any scenes exist, ask Claude for story ideas (*"use storyboard: zombie
survival, 12 minutes"*). It works like a head writer, stopping for your choice at each step:
1. Premises scored for click appeal.
2. Title and thumbnail pairs, with a thumbnail image prompt.
3. A story bible: protagonist, dependent, anchor objects, resource math, threat ladder, central mystery and twist.
4. A retention map: a 30-second hook, open loops, escalating episodes, pattern interrupts every 45–90 s, and a peak
   ending.
5. The full script in the timeline template format, audited with
   `node .claude/skills/storyboard/retention.mjs <file>` (hook timing, open-loop ledger, interrupt gaps, picture
   holds, dead air).

It then hands the script to `timeline-generation`. The psychology behind each rule is in
[`.claude/skills/storyboard/playbook.md`](.claude/skills/storyboard/playbook.md).

**Picture checks with Claude (`vision-check` skill).** Besides the editor's own Claude check and its *Check with
Claude* button (see *People and hands* below), you can review pictures with Claude in a Claude Code conversation: *"/vision-check 63-74"* checks those scenes' pictures and every variant
against their image prompts (extra or missing hands and people, a missing subject, night instead of day) and records
the verdicts in the editor, where failures show the usual warning under the picture. Add `--fix` to have it pick a
passing variant or regenerate failures (up to `--retries N`, default 2), telling the image model what was wrong.
It runs on the machine that hosts the editor, since it reads the picture files. Unattended, from the repository root
(PowerShell, cmd or bash):
`claude -p "/vision-check --flagged --fix" --allowedTools "Read" "Write" "Agent" "Bash(node .claude/skills/vision-check/vision.mjs:*)" "PowerShell(node .claude/skills/vision-check/vision.mjs:*)"`.
It uses `POST /api/image-check` to record a verdict and passes `{ "feedback": [...] }` to the regenerate routes.

**Story-channel production.** The template's *Writing like a director* and *Presets* (e.g. **survival horror**) set
up the whole pipeline in one go:
- A **Cast & locations** list. Once you approve it and its estimated cost, Claude generates a turnaround sheet per
  character (front, three-quarter, side and back) and empty master plates per key place from the directions the
  scenes look in, the reverse view generated from the first so it's the same place (`timeline.mjs references`). They go into the library as
  references, so faces, clothes and room layouts stay the same in every scene.
- A **three-layer sound plan**: a generated drone as the music, an ambience loop per location that plays on across the
  cuts, and precise event sounds timed to words.
- **Camera moves chosen per picture** (not one default on everything), and 2–3 pictures per narration line where it
  helps. `retention.mjs` flags a move used too often or repeated 4 times in a row.
- **Micro-motion** video prompts.
- **Finishing**: grade, vignette, grain, captions, on-screen titles and shake.

**Audio tags.** The template includes ElevenLabs' audio tags (`[whispers]`, `[sighs]`, `[excited]`, `[pause]`, …)
and the rules Claude follows to place them when it writes narration from a story. Tags are performed only by the
**Eleven v4**, **v4 Turbo** and **v3** voice models (Project panel on the left → Voice model). Other models read them out loud,
and the scene sidebar warns you when that would happen.

## Workflow

1. **Write the script.** Click **Import script** and paste your narration. Each paragraph becomes a scene.
   You can add image and sound prompts inline:

   ```
   Below two hundred meters, sunlight disappears.
   [image: a submarine descending into dark blue water]
   [sfx: deep underwater ambience, muffled bubbles]

   Here, nearly ninety percent of creatures make their own light.
   [image: glowing jellyfish in pitch black water]
   ```

2. **Set the look.** On the **Project** tab, pick the format (16:9 or 9:16 Shorts), image model, a style
   prompt that is appended to every image prompt, the voice and the camera motion. Every model and voice
   picker is searchable: star the ones you use (stars are shared by all projects) and type
   `owner/model` (Replicate) or `gemini:model` to use one that isn't listed. The ⚙ button next to a model
   shows its settings (seed, steps, quality, stability, speed, …) with their defaults; only what you change
   is sent. Image settings are saved per model. The same pickers sit next to each Generate button in the scene
   sidebar; they change the setting for every scene.
3. **Generate everything.** **Generate missing** first opens a review dialog listing every image, shot, voiceover
   and sound effect that has a prompt but no file yet, each with its model and estimated cost, plus a video clip for
   each scene that asks for one (a video prompt, or "Generate video" in its notes; these start unticked). Untick what
   you don't want, change the models, voice or style on the left (they're the project's settings), and click
   **Generate**. Video clips are made last, so each starts from its scene's new image. If a voiceover runs longer than
   its scene, the scene is lengthened so the narration isn't cut off.
   **People and hands.** Image models sometimes add a second person or a third hand. Every image prompt gets a short
   guardrail (only the people the scene describes, two hands each), and each new picture can be checked by a vision
   model, chosen on the Project tab under Images (*Checked by*):
   - **Gemini** (needs a Gemini API key) looks for extra hands or people and a missing subject.
   - **Claude Code (this machine)** runs the `claude` command on the editor's computer (install
     [Claude Code](https://claude.com/claude-code) and sign in once). It scores each picture 0–100% for adherence,
     logic and quality, and the worst problem caps the score: an extra or missing hand or finger at 35%, an extra or
     missing person at 45%, garbled text at 60%, a missing prop or night instead of day at 70%. Anything under the
     **pass mark** (80% by default) fails.

   A failed picture goes back to the image model (your local Qwen, for example), told what was wrong, up to 2 more
   times by default. With several variants per image, every variant is checked, and with **All variants must pass**
   (on by default) only the failed ones are made again, told what they got wrong, until every variant passes or the
   retries run out; turned off, it stops as soon as one passes. The best ones of all passes are kept, best first, with
   their scores on the variant strip. If problems remain,
   the scene shows a warning under its image. Each retry costs another image (nothing with a local model).

   **Check with Claude.** Each picture (and each shot) also has a **Check with Claude** button, whichever checker the
   project uses: Claude scores the picture in use and its other variants. If enough of them pass (all of them, with
   *All variants must pass*), the best is used; if not, the passing ones are kept and the image model makes only the
   missing ones, told what the failed ones got wrong, and Claude scores those, pass after pass. The button needs Claude Code on the machine that runs the editor's server. Settings in `.env`:
   `CLAUDE_BIN` (path to `claude` if it isn't on the PATH), `CLAUDE_CHECK_CONCURRENCY` (pictures checked at once,
   default 3), `CLAUDE_CHECK_TIMEOUT_SEC` (default 240).
4. **Review and fix.** Press <kbd>Space</kbd> to play. Click a scene on the timeline, edit its prompt in the
   sidebar and click **Regenerate**. Only that asset is regenerated. Hover between two scenes on the Image track and click
   **+** to insert a blank scene there, or click the **+** box after the last scene. Drag a scene's right edge to change its length,
   or drag the scene itself to move it (<kbd>Esc</kbd> cancels). Each scene has a **Notes** box for reminders
   (footage to import, text to add). A scene's **Visual** has two tabs: **Image** (references, prompt,
   and the camera motion: still, zoom in / out, or a pan in any direction, overriding the project's) and **Video**
   (a clip from Gemini Omni using the video prompt, or the image prompt if that's empty, starting from the scene's
   image if it has one). Every generated image, clip, voiceover and sound effect is also added to the library, so
   earlier takes stay available (and usable as references). Notes are never sent to the generators and show as a marker on the timeline. <kbd>Shift</kbd>-click selects a range of scenes and
   <kbd>Ctrl/⌘</kbd>-click adds or removes one; dragging, duplicating or deleting then applies to all of them.
5. **Export.** **Export video** renders `projects/<id>/exports/final_output.mp4` and opens it in the
   **Rendered MP4** tab. Each scene is cached as its own clip, so re-exporting after a small change only
   re-renders the scenes you touched.

   **Finishing** (Project tab → Finishing) is applied to every scene on export:
   - a **colour grade**: cold bunker, teal & orange, bleach bypass, warm film or noir;
   - a **vignette** and **film grain**;
   - burned-in **captions** from the voiceover, either word by word with the spoken word highlighted, or subtitle lines,
     timed from the generated narration.

   Each scene can also have an **on-screen title** (e.g. "DAY 12", shown big for its first 3 seconds) and **camera
   shake** (light or heavy) for tense moments, in its sidebar under Finishing. **How far it moves** (Project tab → Images)
   sets how far zooms and pans travel: 4–6% is a slow cinematic push. The live preview approximates the grade and
   vignette and shows titles. Captions use the bundled Inter font (`server/fonts`, SIL Open Font License).

**Spending.** The **$** button at the top right shows this month's API spending (all projects). Click it for every
generation the editor has run, by project and period, with the usage each provider reported: Gemini tokens,
ElevenLabs credits, Replicate run time. Costs are that usage times an editable price table. Gemini and fixed-price
Replicate models are filled in from the providers' price lists; set the rest yourself. The log is
`projects/.usage.jsonl`.

## Library: your own media

The **Library** sidebar on the left holds every file you upload, grouped into **Videos**, **Images** and
**Sounds**. Uploading only adds files to the library; nothing goes on the reel until you put it there.

- **Add files:** click **Upload** in the library, or drag files from your computer onto it. Files dropped on an
  empty part of the timeline also just go to the library.
- **Use them:** drag an item from the library onto the timeline:

  | Drop onto | Result |
  | --- | --- |
  | Between scenes (an image or video) | A new scene is inserted there; a "New scene" marker shows where |
  | A scene's Image clip | Replaces that scene's image or video |
  | A scene's Voice / SFX clip | Uses the sound (or a video's soundtrack) as voiceover / sound effect |
  | The Music row | Sets the background music |

  The clip under the pointer turns white if the item fits there and red if it doesn't. Without dragging,
  you can use **+** on an image or video to add it to the end, or the music-note button on a sound.
  The **Upload** buttons in the scene sidebar upload into the library and use the file in that slot.
- **Manage:** badges show which items are in use (×2 = used twice). Click ▶ to preview sounds. Deleting an
  item that's in use asks first and removes it from the reel too. Replacing or removing media on a scene
  never deletes the library file.
- Formats: images png, jpg, webp, bmp; video mp4, mov, webm, mkv, m4v, avi; audio mp3, wav, m4a, aac, ogg, flac, opus.
- A scene's visual is an image **or** a video: adding one replaces the other.
- Video clips: the scene length is set to the clip length (or longer if the voiceover needs it). Use **Start at** to
  trim the beginning and **Clip audio** to set or mute the clip's own sound. If the scene is longer than the clip,
  the last frame is held. Clips are scaled and center-cropped to the project format.
- Background music loops if it's shorter than the video, fades in and out, and (by default) is automatically
  lowered while the voiceover plays. That ducking is applied in the export only, not in the live preview.

## Music and ambience

The **Music** tab (right sidebar) holds the sound that runs under the scenes:

- **Background music:** one track for the whole video. Write a prompt and click **Generate music** (ElevenLabs
  Music, always instrumental, 10 s to 10 min; it loops if shorter than the video), or upload your own. Every take
  stays in the library.
- **Ambience:** a looping background sound per place, e.g. *Car at night* (engine idle, wind on the windows) or
  *Suburb morning* (birdsong, a far sprinkler). Each is generated as a seamless 30-second loop (ElevenLabs sound
  effects) or uploaded. Pick a scene's ambience in its **SFX** tab, or select scenes on the timeline and click
  **Use for selected scenes**. Neighbouring scenes with the same ambience play it as one continuous loop and it
  crossfades where the place changes; a scene with none is silent underneath (for planned silences). The
  **Ambience** row on the timeline shows where each one plays.

Both are listed under *Whole video* in **Generate missing**.

**Flipbooks instead of video clips.** To show something happening without a video clip, give a scene 3–4
pictures of the same framing, each a moment later: add shots and tick **Next frame of the picture before** on
each. The picture before is then sent to the image model as the same shot a moment earlier, so only the action
moves on. Keep their camera motion still (a zoom restarting on every frame jumps).

 A scene's own **SFX** still plays on top: use it
for what that moment adds (a heartbeat, a child breathing), not for the room tone the ambience already has.

## Local images with ComfyUI

Images can also come from a ComfyUI running on your own computer, for free. Each workflow in
`comfyui-workflows/` shows up in the image model picker as **Local · ComfyUI** (`comfyui-workflows/qwen-image.json`
is `comfyui:qwen-image`). The editor finds ComfyUI on port 8000 (ComfyUI Desktop) or 8188, or at `COMFYUI_URL`
in `.env`; the top bar shows whether it's running.

To add a workflow: in ComfyUI use **File → Export (API)** (turn on *Enable dev mode options* in Settings if it's
missing), save it in `comfyui-workflows/`, and replace the prompt text with `{{prompt}}`. The editor sets the
width and height of the `Empty…Latent…` node from the project format and a size in megapixels, and puts a random
seed in every `seed` input. An optional `"_editor"` entry names the workflow and adds settings to its ⚙ panel, each
pointing at the node inputs it sets (see `qwen-image.json`).

A workflow takes reference images when its `"_editor"` has a `"references"` entry: the most it takes, a `LoadImage`
node to copy, and the inputs each reference plugs into (`images.image_{n}` counts from 1, `{i}` from 0; see
`qwen-image-edit.json`). Each run uploads the references to ComfyUI's input folder and puts one `LoadImage` per
reference in place of the workflow's own. Such workflows are offered for **Model when references are used**; the
others for scenes without references.

Since local images are free, each scene or shot image is made in several **variants** (6 by default; set it in the
Project panel under Images, and tick *Also with paid models* to make variants with paid models too, at the price of
one image each). The library keeps them as one stacked item. Select a scene and the timeline shows its variants above
the tracks; click one to use it there and everywhere else that picture is used. With the image check on, each variant
is checked once rather than retried, and the first one shown is the first that passed (else the one with the fewest
problems).

## Reference images (consistent characters and places)

Give image generation reference pictures so a character, location or style stays the same from scene to scene.

- **For every scene:** Project panel (left) → *References for every scene*. Put your main character or setting here.
- **For one scene:** the *References* box in the scene sidebar. The "+ project refs" checkbox controls whether
  the project-wide ones are sent too.
- **Adding references:** drag an image from the library onto a References box, use **Add**, or drop a file from your
  computer (it goes into the library first). Dropping a **video** opens a frame picker: pause on the frame you want
  and click *Use this frame*. The snapshot is saved to the library at full resolution and used as the reference.
  You can also snapshot any video from the library (camera button on its tile), and **Save to library** a generated
  scene image to reuse a character you like.
- **Naming:** reference names go into the prompt ("Reference images, in order: 1) Maya, 2) Lab"), so rename them in
  the library (pencil button) and write prompts like "Maya walks into the lab".
- **Model:** scenes with references are generated with the *Model when references are used* (default
  `google/nano-banana`; also Nano Banana Pro, Seedream 4, FLUX.2 pro, FLUX Kontext pro, or any custom Replicate model).
  The app reads each model's input schema to find its image-input field (`image_input`, `input_images`,
  `input_image`, …) and how many images it accepts; extra references are skipped (scene ones are sent first).
  Scenes without references keep using the regular image model.
- References are sent as JPEGs scaled to at most 1024px.

Keyboard: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> previous/next scene · <kbd>Delete</kbd> delete scene ·
<kbd>Ctrl/⌘</kbd>+<kbd>D</kbd> duplicate scene · <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> extend the selection ·
<kbd>Ctrl/⌘</kbd>+<kbd>A</kbd> select all scenes · <kbd>Ctrl/⌘</kbd>+<kbd>C</kbd> / <kbd>V</kbd> copy a scene's prompts /
paste them over the selected scenes' prompts · <kbd>Esc</kbd> clear the selection · <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Y</kbd> or
<kbd>⇧⌘</kbd>+<kbd>Z</kbd> redo. Right-click a clip, the music row or a library item for more actions.

**Undo / redo** covers every change to the project: edits, deletes, generations, library changes and script
imports (up to 100 steps; typing in one field is merged into a single step). The history lives in the server's
memory, so it resets when the server restarts. Media files that leave the project are kept until no undo step
needs them, then deleted.

## Project files

```
projects/
  .active                  the project that's open
  secrets-of-the-deep-ocean/
    storyboard.json        ← the whole video: settings + scenes (re-read on every request)
    media/library/         your uploaded files (the Library)
    media/images|voiceover|sfx/   generated assets
    clips/                 per-scene render cache
    exports/final_output.mp4
  my-next-video/
    …
```

Hand edits to `storyboard.json` are picked up, but the open editor only shows them after a reload, and
undo history doesn't track them. Prefer the editor or the API.

Upgrading from a version with a single `project/` folder: it's moved into `projects/` automatically on
first start (so is a folder set with the old `PROJECT_DIR` setting). To keep projects elsewhere, set `PROJECTS_DIR` in `.env`.

A scene in `storyboard.json`:

```json
{
  "scene_id": 1,
  "image_prompt": "A lone research submarine descending into a dark blue ocean",
  "voiceover_text": "Below two hundred meters, sunlight disappears.",
  "sfx_prompt": "deep underwater ambience, muffled bubbles",
  "duration_sec": 7,
  "image_url": "/media/images/scene-1-1761700000000.png",
  "voiceover_url": "/media/voiceover/scene-1-1761700000000.mp3",
  "sfx_url": "/media/sfx/scene-1-1761700000000.mp3",
  "voiceover_duration_sec": 4.8,
  "sfx_duration_sec": 7
}
```

The library lives in the same file as a `library` array:

```json
{ "asset_id": "a_1f2e3d4c", "name": "drone shot.mp4", "type": "video", "url": "/media/library/video/asset-….mp4",
  "thumb_url": "/media/library/video/asset-….thumb.jpg", "duration_sec": 12.4, "has_audio": true }
```


## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/projects` | `{ open, projects: [{ id, title, scenes, duration_sec, aspect_ratio, tts_model, updated_at, open }] }` |
| POST | `/api/projects` | create a project: `{ "title", "open"? }` |
| POST | `/api/projects/:id/open` | switch the editor to another project (409 while a job, upload or generation is running) |
| GET | `/api/events` | server-sent events `{ type: "storyboard" \| "project", project, label, origin }` on every change |
| GET | `/api/storyboard` | settings + all scenes of the open project |
| PUT | `/api/settings` | update project settings |
| PUT | `/api/scene/:id` | update `image_prompt`, `voiceover_text`, `sfx_prompt`, `duration_sec`, `video_start_sec`, `video_volume`, `reference_asset_ids`, `use_global_references`, `motion`, `shots`, `shake`, `title_text`, `ambience_id`, `notes` |
| POST | `/api/scenes` | add a blank scene: at `index`, after `after_id`, or at the end |
| POST | `/api/scene/:id/duplicate` | copy a scene's prompts |
| DELETE | `/api/scene/:id` | delete a scene (its media is deleted once no undo step needs it) |
| POST | `/api/scenes/duplicate` | copy several scenes' prompts: `{ "ids": [2, 3] }`; the copies go after the last one |
| POST | `/api/scenes/paste-prompts` | replace several scenes' prompts: `{ "ids": [2, 3], "prompts": { "image_prompt", "voiceover_text", "sfx_prompt" } }` |
| POST | `/api/scenes/delete` | delete several scenes: `{ "ids": [2, 3] }` |
| POST | `/api/scenes/reorder` | `{ "order": [3, 1, 2] }` |
| POST | `/api/scenes/import` | exact-timing import: `{ "mode": "append" \| "replace", "scenes": [{ "duration_sec", "image_prompt"?, "voiceover_text"?, "sfx_prompt"?, "shots"?, "motion"?, "reference_names"?, "ambience"? (a bed's name), "title_text"?, "shake"?, "notes"? }], "settings"?, "ambience"?: [{ "name", "prompt", "volume"? }] }` (one undo step) |
| POST | `/api/references/generate` | generate a reference image into the library: `{ "name", "prompt", "for_every_scene"?, "based_on"? }` (`based_on`: library images by name it's drawn from, for another angle of the same place or person; replaces a same-named one as the reference) |
| POST | `/api/scenes/import-script` | `{ "script": "...", "mode": "append" \| "replace" }` |
| POST | `/api/scene/:id/regenerate-image` | Replicate |
| POST | `/api/scene/:id/regenerate-audio` | ElevenLabs text-to-speech |
| POST | `/api/scene/:id/regenerate-sfx` | ElevenLabs sound effects |
| GET | `/api/library` | all library assets |
| POST | `/api/library` | upload a file into the library (raw body, original name in `X-Filename`) |
| DELETE | `/api/library/:assetId` | delete an asset; 409 if in use (on the reel or as a reference) unless `?force=1` |
| PATCH | `/api/library/:assetId` | rename: `{ "name" }` |
| POST | `/api/library/:assetId/snapshot` | save a video frame as a new image asset: `{ "time_sec" }` |
| POST | `/api/scene/:id/save-to-library` | copy a scene's generated image into the library |
| GET | `/api/model-info?model=owner/name` | how many reference images a Replicate model accepts |
| POST | `/api/scene/:id/use-asset` | `{ "asset_id", "slot": "image" | "voiceover" | "sfx" }` |
| POST | `/api/scenes/from-asset` | new scene from an image/video asset: `{ "asset_id", "index"? }` |
| PUT / DELETE | `/api/music` | set background music `{ "asset_id" }` / remove it |
| POST | `/api/music/generate` | generate the background music from the settings' `music_prompt`, `music_model`, `music_length_sec` (ElevenLabs Music) |
| POST | `/api/ambience` | add an ambience bed `{ "name"?, "prompt"?, "volume"? }`. The ambience routes answer `{ ambience, scenes: [{ scene_id, ambience_id }] }` |
| PUT / DELETE | `/api/ambience/:id` | edit a bed's `name`, `prompt`, `volume` / delete it (its scenes get none) |
| POST | `/api/ambience/assign` | play a bed under scenes: `{ "ambience_id" \| null, "ids": [2, 3] }` |
| POST | `/api/ambience/:id/generate` | generate the bed's 30 s loop (ElevenLabs sound effects) |
| POST | `/api/ambience/:id/use-asset` | use a library sound as the bed's loop: `{ "asset_id" }` |
| DELETE | `/api/scene/:id/media/:slot` | remove a scene's image/video, voiceover or SFX |
| POST | `/api/generate-missing/plan` | what Generate missing would make, with models and estimated costs: `{ "settings"? }` (unsaved changes to price with) |
| POST | `/api/generate-missing` | background job: `{ "items": [plan item ids] }`, or `{ "kinds"? }` for every missing image/voiceover/sfx |
| POST | `/api/export` | background job: FFmpeg render to `final_output.mp4` |
| GET | `/api/job` | progress of the current background job |
| GET | `/api/voices` | your ElevenLabs voices |
| POST | `/api/undo`, `/api/redo` | step through the history: `{ storyboard, label }`, or `{ storyboard: null }` if there's nothing to do. Every API response carries the next steps' labels in an `X-History` header |

Every response also names the open project in `X-Project`. A change sent with an `X-Project` header for a
project that is no longer open is refused with 409, so it can't land in the wrong project.

## Production build

```bash
npm run build && npm start   # serves the built UI and API together on http://localhost:3001
```
