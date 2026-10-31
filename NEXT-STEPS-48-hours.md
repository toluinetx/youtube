# Next steps: I Have 48 Hours Before I Turn

Everything below is to do in the editor on the machine you'll generate on. The story, prompts,
continuity bible and settings are all in the project (`projects/i-have-72-hours-before-i-turn/`); what's
left is generating media and checking it.

**Scene numbers in this guide are the ones the editor shows** (the number on each scene in the timeline
and at the top of the scene panel), not internal ids. A picture written `81.2` is scene 81's second
picture (its first extra shot).

---

## 0. Set up the other device (once)

1. **Get the code.** Clone or pull the repository, `main` branch, then in the repository folder:
   ```powershell
   npm install
   ```
2. **Copy the project's media from the old device.** Generated pictures, voiceovers, sounds and reference
   images are *not* in git (they're in `.gitignore`). Copy this folder from the old machine to the same
   place on the new one:
   ```
   projects\i-have-72-hours-before-i-turn\media\
   ```
   Without it, every picture, voiceover and reference image shows as missing and has to be generated
   again (the character sheets and car plates too, which the scenes use as references). With it, only the
   items listed below need redoing.
3. **Create `.env`** from `.env.example` and fill in:
   - `ELEVENLABS_API_KEY` (voiceovers, sounds, music).
   - `GEMINI_API_KEY`: optional now (images and the check run locally); still used for the video model if
     you make clips.
   - `COMFYUI_URL` only if ComfyUI isn't on port 8000 (Desktop) or 8188.
   - `CLAUDE_BIN` only if `claude` isn't on the PATH, e.g. `CLAUDE_BIN=C:/Users/<you>/.local/bin/claude.exe`.
4. **ComfyUI with Qwen Image 2.1.** Both workflows in `comfyui-workflows/` need these model files in
   ComfyUI's model folders:
   | Folder | File |
   |---|---|
   | `diffusion_models` | `qwen_image_2.1_int8_convrot.safetensors` |
   | `text_encoders` | `qwen3vl_8b_int8_convrot.safetensors` |
   | `text_encoders` | `qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors` (text to image) |
   | `text_encoders` | `qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors` (with references) |
   | `vae` | `qwen_image_2.1_vae_bf16.safetensors` |

   and a ComfyUI recent enough to have the Qwen Image 2.1 nodes (Text Encode Qwen Image 2.1, Qwen Image
   2.1 Cache, Generate Text, If/Else Switch, Save Image (Advanced)). Quick test: open
   `comfyui-workflows/qwen-image-edit.json` in ComfyUI and run it once; nothing should be red.
5. **Claude Code** (the picture checker): install it, then run `claude` once in a terminal and sign in.
   Check that `claude --version` works in PowerShell.
6. **Start the editor:**
   ```powershell
   npm run dev
   ```
   Open the address it prints (usually http://localhost:5173). In the top bar, **ComfyUI** and
   **ElevenLabs** should be green. On the **Project** tab under Images, "Checked by: Claude Code" should
   not say "isn't available here".

## 1. Check the project settings

**Project** tab → Images. These should already be set:

| Setting | Value |
|---|---|
| Image model | Qwen Image 2.1 (local) |
| Model when references are used | Qwen Image 2.1 Edit (local) |
| Check each image | on, retry up to **10** times, give up after **0** min (no limit) |
| Checked by | **Claude Code (this machine)**, pass mark **80%** |
| Variants | **6**, *All variants must pass* on |

What that means: Qwen makes 6 variants of each picture; Claude scores each (an extra hand caps the
score at 35%); the ones under 80% are redrawn, told what was wrong, until all 6 pass. It stops early
when two rounds in a row don't improve anything. For an overnight run, set "give up after" to 15 min so
one stubborn picture can't hold up the rest.

## 2. Review the continuity bible

**Continuity** tab (left panel, between Library and Project). 14 entries:

- **Characters:** Nora (eyes and skin change in steps from scene 1 to 100; the hoodie: zipped up for the
  chills from 47, over Eli as a blanket 51–58, back on from 59), Eli (under the hoodie 51–56).
- **Props:** Handcuffs (scrubs pocket from 8 → left wrist + **top of the steering wheel rim** from 81 → hoodie pocket
  from 109 → fence post from 112), Handcuff key (Eli's pocket from 81 → Nora's hand 108 → grass inside the fence
  113), Yellow walkie-talkie (Eli's), Blue walkie-talkie (Nora's; taped into her right hand from 111),
  Dictaphone, Bandage (fresh → soaked → dried → black veins → grey).
- **Places:** Corolla interior (left-hand drive; booster seat behind the front passenger seat; facing back
  it's on the LEFT of the frame, facing forward and in the mirror on the RIGHT), Farm barn, Fort Calder
  gate, Gas station, Farmhouse, Kitchen.

(The scene numbers in the tab's "From …" boxes are editor numbers too.)

Read each one: the descriptions and changes are added to every picture that names them, so a wrong fact
spreads everywhere. Fix anything that doesn't match how you see the story. Under any image prompt, the
**Continuity:** chips show what applies to that picture and **show text** shows exactly what's added.

Scenes 1–5 (the cold open) have **Story time** set to scenes 84 / 87, so they get Hour 37's states (cuffs on
the wheel, bandage with black veins).

## 3. Generate the missing reference views

In the Continuity tab, open each entry and click **Generate** on the views that have no picture yet, in
this order (a view "drawn from" another needs that one first):

1. **Handcuffs → Prop sheet**, then **Handcuffs → On the wheel**.
2. **Handcuff key → Prop sheet**.
3. **Yellow walkie-talkie → Prop sheet**.
4. **Blue walkie-talkie → Prop sheet**, then **Blue walkie-talkie → Taped in hand**.
5. **Dictaphone → Prop sheet**.
6. **Bandage → Stages** (for reference only; not sent with pictures).
7. **Nora → Face close-up**, **Eli → Face close-up** (drawn from their turnarounds).
8. **Corolla interior → Top-down layout** (drawn from both car plates).

Each is checked by Claude; its score shows under it. Regenerate any that fail or look wrong: the props
send their **first** view with every picture they're in, so the prop sheets must be right. (Do this
before step 4, so the regenerated scenes get the prop sheets.)

## 4. Regenerate the pictures whose prompts changed

The prompt or lighting of these changed since their pictures were made, so the pictures are out of date.
For each, select the scene and click **Regenerate Image** (and **Generate** on any of its shots):

| Scenes | Why |
|---|---|
| 4, 81, 87 | Cuffs: top of the wheel rim, chain wording |
| 62, 64–73 | Barn stay relit as a grey rainy midday (was night) |
| 77 | Tape-rewound scene: late-afternoon light (was dawn) |
| 94 | **New scene**: two of the dead walk past her window (no picture yet) |
| 95–99 | Hour 42 to the gate: night (was pre-dawn); scene 95 the car parked, not driving |

Shortcut: *Generate missing* in the top bar only makes what's missing. To batch these, click **Remove**
under each picture first; then *Generate missing* picks them all up (with their check passes).

Every regenerated picture also gets the continuity text and, for props, their prop sheet, and Claude
scores it against both.

## 5. Voiceovers and sounds

**Regenerate the voiceover** (Voice tab → Regenerate) for these scenes; their lines changed (48 hours, the
plot-hole fixes) and they still play the old audio:

> 1, 8, 10, 19, 20, 21, 23, 24, 25, 49, 50, 54, 59, 62, 63, 66, 71, 72, 77, 81, 84, 94, 95, 97, 111, 112, 113, 116

**Regenerate the sound effect** (SFX tab) for scenes **66, 77, 94**.

Then **trim the durations**: the new lines' scene lengths are estimates (a little long). Drag each
scene's right edge to just after its voiceover ends, or leave it if the pause works.

## 6. Check the older pictures against the bible

Pictures made before the continuity bible may break it (cuffs at the bottom of the wheel, the booster
seat on the wrong side). Two ways to find them:

- **In the editor:** select a scene and click **Check with Claude** under its picture. Under 80%, it
  switches to a passing variant or redraws only the failing ones. Start with the car scenes that show the
  cuffs or the booster seat.
- **In Claude Code** (from the repository folder, with the editor running):
  ```
  /vision-check --all
  ```
  scores every picture against its prompt *and* continuity facts and records the scores in the editor
  (checking only, unless you add `--fix`). Then `/vision-check --flagged --fix` fixes the failures.
  Unattended:
  ```powershell
  claude -p "/vision-check --flagged --fix" --allowedTools "Read" "Write" "Agent" "Bash(node .claude/skills/vision-check/vision.mjs:*)" "PowerShell(node .claude/skills/vision-check/vision.mjs:*)"
  ```

## 7. Audit the prompts (optional, whenever the story changes)

In Claude Code: *"use continuity: audit the prompts"*. It reads every prompt against the bible and lists
contradictions with fixes; it changes prompts only with your go-ahead. Changed prompts need their pictures
regenerated.

## 8. Final pass and export

1. Play it through (Space). Watch the cold open (1–5), the scraped knee and the cuffing at nightfall (79–81), the gate (100–115).
2. Read the full script in `storyboard-48-hours-before-i-turn.md` against what you hear.
3. **Export video** (top right).

---

## If something goes wrong

- **"Claude Code isn't available here"**: `claude --version` fails in PowerShell. Install or sign in, or
  set `CLAUDE_BIN` in `.env` to the full path of `claude.exe`, then restart `npm run dev`.
- **Checks are slow**: each check is a separate Claude Code run (10–30 s). `CLAUDE_CHECK_CONCURRENCY=4` in
  `.env` checks more at once; lowering variants to 3 halves the work.
- **A picture keeps failing** ("stopped when two passes in a row brought no improvement"): it's the prompt,
  not luck. Say who is in the frame and how many hands, cut long "no …" lists, or split a hard detail into
  its own shot. `show text` under the prompt shows the continuity facts it also has to follow.
- **Qwen copies a reference too closely** (the previous scene's framing, the prop sheet's grey background):
  untick **+ previous scene** for that scene, or turn on *Prompt enhancer* in the Qwen Edit model settings
  (slower, more VRAM).
- **An entry shows up in a picture it shouldn't** (the prompt names Eli but he isn't in the shot): click its
  chip under the image prompt to leave it out of that picture.
- **Prompts too long / drifting**: the Corolla entry is the longest; shorten its description first.
