---
name: vision-check
description: Check the AI Video Editor's generated pictures with Claude's own vision instead of Gemini - extra or missing hands and people, a missing subject, the wrong time of day - record the verdicts in the editor, pick the best variant, and regenerate failures with the problems spelled out. Use when the user asks to check, review or fix the pictures, images or shots of a project, or says "vision check" or "vision-check".
---

# Vision check

The editor can check each new picture with a Gemini vision model (Project tab → Images → "Check each
image"). This skill does the same job with **you** as the vision model: you look at every picture
with the Read tool, compare it with its image prompt, and record the verdict in the editor, where it
shows up exactly like Gemini's (an amber warning under the picture when it fails). Then, if asked, you
pick the best variant or regenerate the picture, telling the image model what was wrong.

Everything goes through `vision.mjs` (the editor's API), run from the repository root:

```
node .claude/skills/vision-check/vision.mjs list [which] [--all | --flagged] [--ids]
node .claude/skills/vision-check/vision.mjs record <results.json>
node .claude/skills/vision-check/vision.mjs choose <picture> <url>
node .claude/skills/vision-check/vision.mjs regenerate <picture> [--feedback-file <problems.json>]
```

The same commands work in PowerShell, cmd and bash (forward slashes are fine on Windows).

- `which`: scene numbers **as the editor shows them** (`3`, `63-74,83`); with `--ids`, scene ids.
- `list` prints JSON: one entry per picture (a scene's own image is shot 1; its extra shots follow)
  with `key` (`63`, or `63:s_ab12cd34` for a shot), `label`, `prompt` (the brief), `narration`,
  `url`, `file` (the PNG on disk), `check` (the current verdict, if any) and `variants` (every
  picture made in the same generation, the one in use included, or null).
  By default it lists only pictures **you** haven't checked yet; `--flagged` lists those whose last
  check failed (Gemini's or yours); `--all` lists everything.
- `record` saves verdicts: `[{ "url": "...", "issues": [...], "people": 1, "hands": 2, "attempts": 1 }]`.
  An empty `issues` list means it passed. Write the file with the Write tool to the system temp folder
  (`$env:TEMP` in PowerShell, `/tmp` on macOS and Linux), not the repo.
- `choose` switches a picture to another of its variants (one undo step in the editor).
- `regenerate` makes a new picture (or a new set of variants), adding "An earlier attempt was
  rejected for: …" with the problems in `--feedback-file` (a JSON list of up to 5 short sentences, written
  with the Write tool like the results file) to the prompt, and prints the
  picture's new entry. It can take minutes. It costs whatever an image costs with the scene's model:
  free with a local ComfyUI model, paid with Replicate or Gemini (`reference_model` is used whenever the
  scene has references).

## Arguments

`/vision-check [scenes] [--fix] [--retries N] [--flagged | --all]`

- No scenes: the whole project. Scene numbers as in the editor.
- Without `--fix`: **check only**. Record verdicts and report; don't choose or regenerate anything.
- `--fix` (or the user asks to fix, regenerate or "make them pass"): choose passing variants and
  regenerate failures, up to `--retries` new generations per picture (default 2, at most 5).
- If the user didn't say, check only, then offer to fix.

## 1. Before you start

- The editor must be running (`npm run dev`). If `vision.mjs` says it isn't, tell the user.
- Run `list`. If it reports picture files that aren't on this machine, you're not on the machine
  the pictures were generated on: say so and stop.
- If the project's own Gemini check is on, both checks run on new pictures. That's harmless, but
  mention that they can untick "Check each image" in the Project tab if they only want yours. Don't
  change project settings yourself.

## 2. Look at each picture

For each picture, **Read its `file`** (and each variant's `file`), then judge it against its
`prompt`. Use the narration only to understand the scene. Look for **clear mistakes only**:

- **Anatomy:** a person with extra or missing arms, hands or fingers; hands or limbs not attached to
  anyone; merged or duplicated bodies or faces.
- **Cast:** more or fewer people than the prompt describes (a character described as alone with
  another person, or someone else's hands or arms in the frame), or the same character shown twice.
  Remember that "one hand" or "her left hand only" counts too.
- **Contradictions:** something the prompt clearly asks for that's missing or plainly different: a
  key prop (handcuffs, the walkie-talkie, the dictaphone), the wrong character, **night instead of day
  or the reverse**, a prop or person the prompt explicitly excludes that is prominent.
- **Text:** garbled or misspelled text, or readable text the prompt says shouldn't be there.

Don't judge style, taste, lighting quality or composition, and don't flag details a viewer wouldn't
notice (a slightly different shade, a hand that's left instead of right when it reads fine). Count
the people and the hands you can see. Write each issue as one short sentence an image model can act
on ("A second hand reaches in from the right edge.", not "hands wrong").

Be honest in both directions: a picture that's fine passes even if an earlier check flagged it, and
a picture that a viewer would find wrong fails even if Gemini passed it.

## 3. Record, then fix (only with `--fix`)

1. Record every verdict you made (every variant you looked at) with `record`, in one file per batch.
2. For each picture, decide:
   - The picture in use passed: done.
   - Another variant passed: `choose` the first one that passed. Prefer one that also keeps continuity
     with the neighbouring pictures (same people, clothes, place).
   - Nothing passed: `choose` the variant with the fewest issues (if it isn't the one in use), then
     `regenerate` with that variant's issues in a `--feedback-file`. Read the new picture (and its new
     variants), record verdicts with `"attempts"` set to the generation number (2, 3, …), and repeat
     until one passes or the retries run out.
3. A picture that still fails after the retries is a prompt problem, not bad luck. Don't edit the
   prompt yourself; in the report, suggest a concrete change (name who is in the frame and how many
   hands, cut a long "no …" list the model keeps ignoring, move a hard-to-draw detail into its own shot).

## 4. Many pictures: batch with subagents

Each picture you Read costs context, and a scene can have 6 variants. With more than about 10
pictures, split the `list` output into batches of 5–8 pictures and give each batch to a subagent
(Agent tool), several at once. Give each one: the picture entries (key, label, prompt, file and
variant files), the criteria in step 2 verbatim, and the instruction to Read every file and return
**only** JSON: `[{ "key": "...", "url": "...", "issues": [...], "people": n, "hands": n }]`, one entry per
file. You then record the results and do the fixing yourself, so choices stay consistent.

## 5. Report back

A short summary: how many pictures you checked, passed, chose a variant for, regenerated, and how
many still fail. Then a table of the ones that still fail (scene/shot, the issues, and your suggested
prompt change). The warnings are also visible in the editor under each picture.

## Running it unattended on the editor's machine

Claude Code can run this on the machine that hosts the editor, without anyone at the keyboard:

```powershell
cd C:\path\to\youtube
claude -p "/vision-check 63-74 --fix" --allowedTools "Read" "Write" "Agent" "Bash(node .claude/skills/vision-check/vision.mjs:*)" "PowerShell(node .claude/skills/vision-check/vision.mjs:*)"
```

Run it from the repository root while the editor is running. Both shell rules are listed because
Claude Code on Windows runs commands through Git Bash or PowerShell, depending on the setup; the one
that doesn't apply is ignored. To split the command over several lines in PowerShell, end each line
with a backtick (`` ` ``), not a backslash. Windows Task Scheduler (or a script after a generation run) can run
the same command, e.g. `claude -p "/vision-check --flagged --fix" …`.
