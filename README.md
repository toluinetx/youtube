# AI Video Editor

A local web app for building YouTube videos out of scenes. Each scene has a visual (an image generated
with Replicate / FLUX, or your own image or video clip), a voiceover (ElevenLabs text-to-speech or your
own recording) and an optional sound effect (ElevenLabs or your own file). Add background music for the
whole video, edit everything on a timeline, regenerate or replace just the pieces that look or sound
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
cp .env.example .env       # then paste your REPLICATE_API_TOKEN and ELEVENLABS_API_KEY
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

**Audio tags.** The template includes ElevenLabs' audio tags (`[whispers]`, `[sighs]`, `[excited]`, `[pause]`, …)
and the rules Claude follows to place them when it writes narration from a story. Tags are performed only by the
**Eleven v4**, **v4 Turbo** and **v3** voice models (Project tab → Voice model). Other models read them out loud,
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
   prompt that is appended to every image prompt, the voice and the camera motion.
3. **Generate everything.** **Generate missing** creates every image, voiceover and SFX that has a prompt but
   no file yet. If a voiceover runs longer than its scene, the scene is lengthened so the narration isn't cut off.
4. **Review and fix.** Press <kbd>Space</kbd> to play. Click a scene on the timeline, edit its prompt in the
   sidebar and click **Regenerate**. Only that asset is regenerated. Hover between two scenes on the Image track and click
   **+** to insert a blank scene there, or click the **+** box after the last scene. Drag a scene's right edge to change its length,
   or drag the scene itself to move it (<kbd>Esc</kbd> cancels). Each scene has a **Notes** box for reminders
   (footage to import, text to add). Notes are never sent to the generators and show as a marker on the timeline. <kbd>Shift</kbd>-click selects a range of scenes and
   <kbd>Ctrl/⌘</kbd>-click adds or removes one; dragging, duplicating or deleting then applies to all of them.
5. **Export.** **Export video** renders `projects/<id>/exports/final_output.mp4` and opens it in the
   **Rendered MP4** tab. Each scene is cached as its own clip, so re-exporting after a small change only
   re-renders the scenes you touched.

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

## Reference images (consistent characters and places)

Give image generation reference pictures so a character, location or style stays the same from scene to scene.

- **For every scene:** Project tab → *References for every scene*. Put your main character or setting here.
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
| PUT | `/api/scene/:id` | update `image_prompt`, `voiceover_text`, `sfx_prompt`, `duration_sec`, `video_start_sec`, `video_volume`, `reference_asset_ids`, `use_global_references`, `notes` |
| POST | `/api/scenes` | add a blank scene: at `index`, after `after_id`, or at the end |
| POST | `/api/scene/:id/duplicate` | copy a scene's prompts |
| DELETE | `/api/scene/:id` | delete a scene (its media is deleted once no undo step needs it) |
| POST | `/api/scenes/duplicate` | copy several scenes' prompts: `{ "ids": [2, 3] }`; the copies go after the last one |
| POST | `/api/scenes/paste-prompts` | replace several scenes' prompts: `{ "ids": [2, 3], "prompts": { "image_prompt", "voiceover_text", "sfx_prompt" } }` |
| POST | `/api/scenes/delete` | delete several scenes: `{ "ids": [2, 3] }` |
| POST | `/api/scenes/reorder` | `{ "order": [3, 1, 2] }` |
| POST | `/api/scenes/import` | exact-timing import: `{ "mode": "append" \| "replace", "scenes": [{ "duration_sec", "image_prompt"?, "voiceover_text"?, "sfx_prompt"?, "notes"? }], "settings"? }` (one undo step) |
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
| DELETE | `/api/scene/:id/media/:slot` | remove a scene's image/video, voiceover or SFX |
| POST | `/api/generate-missing` | background job |
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
