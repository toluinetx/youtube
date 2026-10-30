# Timeline template

Copy this file, fill it in, and give it to Claude ("use timeline-generation with this"). Claude checks
it, asks which project to put it in (new or existing) and whether to add to or replace the scenes there,
then loads it into the editor. Nothing is generated until you click **Generate** in the editor, so
you can review every scene first. Claude also estimates what generating it will cost, using the prices
in the editor's Usage panel.

Delete the guidance in `>` quotes as you go, or leave it. Claude ignores it.

---

## Project

> Leave a line blank to keep the project's current setting.

- **Title:**
- **Format:** 16:9 (YouTube)
- **Visual style:**
  > Added to the end of **every** image prompt, so describe the look you want throughout and don't
  > repeat it in each scene. Name the medium, lighting, colour palette and finish. For example:
  > *"cinematic documentary photograph, natural light, muted teal and amber palette, shallow depth of
  > field, 35mm film grain"* or *"flat vector illustration, bold outlines, pastel palette, no
  > gradients"*. One consistent style is what makes a video look intentional.
- **Camera motion:** Ken Burns (alternating zoom) | still | zoom in | zoom out | pan left → right |
  pan right → left | pan top → bottom | pan bottom → top
  > The fallback for pictures that don't set their own. In a story video, give **every picture its
  > own move** (each scene's **Camera** and each shot's motion, below): one default on every
  > picture is what makes a slideshow look like a slideshow. Choose "still" for diagrams or text.
- **Camera move:** 12% (default)
  > How far every zoom or pan travels over a shot. **4–6%** is a slow cinematic push you barely
  > notice, which suits suspense and drama; 12% is a clear Ken Burns; 20%+ is energetic.
- **Preset:** none | survival horror
  > Fills in style, camera, finishing and voice settings in one go (see *Presets* at the end).
  > Lines you fill in yourself win over the preset.
- **Colour grade:** none | cold bunker | teal & orange | bleach bypass | warm film | noir
  > Applied to every scene on export so all pictures and clips share one filmic palette.
  > *Cold bunker*: muted, desaturated blue-green shadows with warm lamp-lit highlights (survival,
  > horror). *Teal & orange*: blockbuster. *Bleach bypass*: gritty, low colour (war, documentary).
  > *Warm film*: soft and nostalgic. *Noir*: black and white.
- **Vignette:** 0–100% · **Film grain:** 0–100%
  > Darker edges (claustrophobia, focus) and moving film grain, on export. 40–60% vignette and
  > 20–35% grain are subtle; leave at 0 for clean, bright videos.
- **Captions:** off | word by word | subtitle lines · **Position:** bottom | center
  > Burned in on export from the narration, timed to each spoken word. *Word by word* shows 1–3 bold
  > words at a time with the spoken one highlighted (the retention style of Shorts and story
  > channels); *subtitle lines* is classic subtitles. Center suits 9:16 Shorts.
- **Voice settings:** stability · style · speed
  > Optional, for how the narrator performs. Lower stability = more variation in delivery (tremors,
  > breathy, uneven pacing), higher = steadier and more uniform. With Eleven v4 / v3 stability is 0
  > (Creative), 0.5 (Natural) or 1 (Robust); with Multilingual v2 it's 0–1 (0.3 is expressive, 0.5
  > neutral). Style (0–1) exaggerates the voice's character. Speed 0.7–1.2.
- **Narrator voice:**
  > An ElevenLabs voice name from your account (e.g. "George") or a voice ID. It reads everything
  > that isn't marked as another speaker's.
- **Speakers:** Name: voice, one per character who speaks (e.g. *Nora: prqcFePeALHihEWRj5ll*,
  *Eli: XjGYkUkzth8BPs29fmcV*)
  > Optional. Each character's lines are then spoken in their own voice: in a scene's **Voice**,
  > put `{Name}` in front of what they say and `{Narrator}` where the narration picks up again. A
  > child's own voice beats `[childlike tone]` on the narrator.
- **Voice model:** Eleven v4 (recommended; audio tags) | Eleven v4 Turbo (faster; audio tags) |
  Eleven v3 (audio tags) | Multilingual v2 (app default; **no** audio tags) | Turbo v2.5 | Flash v2.5
  > Choose **Eleven v4** if the voice lines use audio tags like `[whispers]` (see *Audio tags* below).
  > Other models read tags out loud.
- **Music:** a prompt · length 30–600 s · model Music v1 | v2 | v2.5
  > One instrumental track under the **whole video**, generated with ElevenLabs Music (Music tab →
  > Background music, or **Generate missing**). It loops if shorter than the video and is lowered
  > automatically while the narrator speaks. Describe instruments, texture, tempo and mood, and say
  > what to leave out: *"slow dark ambient drone, deep sub-bass hum, a sustained low cello note, very
  > slow evolving texture, no drums, no vocals, no melody"*. For horror and suspense a **low drone**
  > is layer 1 of *Sound in three layers*. Keep melodic stings out of it: put a one-off piano note on
  > the scene that needs it (an SFX line). You can also upload your own track instead.
- **Ambience:** one line per place: **name:** what it sounds like · volume (default 30%)
  > A looping background sound per location (layer 2 of *Sound in three layers*), e.g.
  > - **Bunker:** low ventilation hum, a distant generator, faint dripping water, steady · 30%
  > - **Forest at dawn:** gentle birdsong, a soft breeze in the leaves, a far stream · 35%
  >
  > Each scene names its place (**Ambience** below). Neighbouring scenes with the same ambience play
  > it as **one continuous loop**, crossfading only where the place changes, so the space doesn't
  > restart at every cut. Write steady textures with no one-off events (a single bang would repeat
  > every 30 s) and say *no voices*. Leave a scene without ambience for a planned silence.

---

## Cast & locations

> Optional, but this is what keeps characters and places the same across 100+ pictures. Each line
> becomes a **reference image** that Claude generates first (with your approval and a cost estimate),
> named in the editor's Library. Scenes then use them and call them by name, so the image model copies
> the face, clothes and room layout instead of inventing new ones each time.
>
> - **Characters:** one line each: name, then a full description (age, build, face, hair, clothing,
>   anything distinctive). Claude draws each as a **turnaround sheet**: the same person four times
>   side by side (front, three-quarter, side profile, back), full body, neutral pose, plain
>   background, so profiles and over-the-shoulder shots keep the face, hair and clothes too. A
>   character is sent only with the pictures that show them (their **References**), so a close-up of
>   one person doesn't grow a second one.
> - **Locations:** one line each for the key places: name, then the space as an establishing shot
>   (layout, materials, light sources, props that recur). Claude draws each as empty **master plates
>   from the directions the scenes look in**: usually two, the main view and the reverse (*Car
>   interior* from the back seat looking forward, then *Car interior, facing back* from the windshield
>   looking back; a room from the door, then facing the door). The second is generated **from the
>   first**, so it's the same place. Each picture's **References** name the plate its camera faces
>   (both only for a mirror shot or a side view). With only one direction, shots facing the other way
>   mix the two: the dashboard ends up in a door, the driver seems to sit in the back. Keep it to the
>   places that recur (3+ scenes).
> - Use exactly these names in the scenes ("Bucky checks the CO2 gauge by the Bunker door").

### Characters
- **Bucky:**
- **Jen:**

### Locations
- **Bunker door:**
- **Kitchen:**

---

## Scenes

> **Timing.** Give each scene a start–end time (`0:00–0:07`) or a length (`7s`). Scenes play back
> to back, so each one starts where the previous one ends. Claude flags gaps or overlaps and asks
> how to fix them. Times are rounded to 0.1 s, and a scene must be between 0.5 s and 10 min.
>
> **Fields.** Every field is optional. A scene with only an image prompt is fine. For the style of
> top story channels, also read *Writing like a director* at the end.
>
> - **Image:** what's on screen. Generated by your image model (FLUX by default) at the project's
>   format. Write it like a photographer's or illustrator's brief, in this order:
>   1. **Subject:** who or what, specifically. *"An elderly fisherman with a white beard and a
>      yellow raincoat"*, not *"a man"*.
>   2. **Action / pose:** what they're doing. *"hauling a net over the side of the boat"*.
>   3. **Setting:** where and when. *"on a small wooden boat at dawn, grey North Sea swell"*.
>   4. **Composition / camera:** shot size and angle, and **where the camera is and which way it
>      faces**. *"close-up taken from the front passenger seat, facing left toward the driver"*,
>      *"aerial top-down"*, *"wide establishing shot"*, *"subject on the left third, empty sky on the
>      right"*. Leave room where you'll put titles.
>   5. **Layout:** what is in the foreground and background and on the left / right of the frame, and
>      what is behind the subject. *"Behind her, the driver's headrest, then the dark back seat and the
>      rear window."* In cars and rooms this is what stops the model drawing a dashboard in a door.
>   6. **Lighting & mood:** name the light source and **where it is**: *"lit from below by the orange
>      instrument glow, which is out of frame below"*. A light named without a place ("in the dashboard
>      glow") gets drawn as the object, wherever it fits.
>   7. **Details that matter:** colours, materials, period, weather, textures, and the state the story
>      is in (the bandage, the wound, the time of day).
>
>   Tips:
>   - One clear subject and idea per image. Busy prompts give muddled pictures.
>   - **Long is fine.** A detailed prompt costs the same as a short one (the text is a fraction of a
>     cent; you pay per picture). 80–170 words that pin down camera, layout and light beat 20 words the
>     model has to guess around. Detail the geometry, not adjectives.
>   - **Say who is in the frame, and how many.** Image models often add a second person, or a third
>     hand, to a scene with one character. Write the count: *"Eli, alone, the only person in the train
>     car"*, *"two people: Maya and her father"*. For hands, say whose and how many: *"close-up of both
>     of Eli's hands (two hands) rinsing cabbage"*, not *"hands rinsing cabbage"*. Keep crowds where they
>     belong and say so: *"zombies outside, beyond the window glass"*. The editor also adds people and
>     hands guardrails to every prompt and checks each image (regenerating it when it finds extra hands
>     or people), but every retry costs another image, so a clear prompt is cheaper.
>   - Describe what you want, not what you don't ("empty beach", not "no people").
>   - Avoid text, logos, signs, numbers and charts in images: generators misspell them. Add text in
>     editing instead.
>   - Name real-world references by type ("1970s Kodachrome look", "National Geographic style"),
>     not by artist name.
>   - For a **recurring character or place**, describe it the same way in every scene (copy the exact
>     wording). For a close match, add a reference image in the editor (Project panel on the left → "References
>     for every scene", or a scene's own References box), name it in the library (e.g. "Maya"),
>     and use that name in the prompt.
>   - Don't repeat the visual style here: it's added automatically.
>
> - **Motion without video: flipbooks.** To show something *happening* (a window bursting, eyes
>   clouding over, a crowd turning), don't plan a video clip: make the scene a **flipbook** of 3–4
>   stills of the **same framing**, each a moment later, shown ~1.5–2 s apart. The scene's Image is
>   frame 1; each next frame is a **Shot** marked *next frame*, written as *"The same <shot>, same
>   framing, a moment later: <what has changed>"*. With *next frame*, the picture before is sent to the
>   image model as the same shot a moment earlier, so framing, light and characters stay put and only
>   the action moves on. Keep the frames' camera **still** (a zoom restarting on every frame jumps);
>   only the last frame may move. Change one or two things per frame, visibly: a light dims, the glass
>   cracks then bursts, the grey spreads across the iris, the heads turn. Don't flipbook a subject that
>   should stay still (someone asleep, a held breath): each frame must change something, so it moves
>   too much. Use one picture with a slow push in instead. A flipbook can also continue
>   from a different shot (wide, then a close-up flipbook of the detail).
>   e.g. **Image:** *Extreme close-up of Nora's eyes, pupils wide, one iris clouding grey* ·
>   **Shot 2 (at "blood", still, next frame):** *The same close-up, same framing, a moment later: her
>   pupils dilating, the grey spreading across her left iris* · **Shot 3 (at "woke", zoom in, next
>   frame):** *…grey across both irises, a dark vein surfacing at the corner of one eye.*
>
> - **Video:** *(only if you ask for clips)* a scene's **Generate video** button in the editor makes a
>   clip with Gemini Omni (needs a Gemini API key, ~$0.10/s) from the **Video** prompt, using the
>   scene's image as the first frame. Keep it to micro-motion: characters almost still, only the air
>   and light moving, one slow camera move at most, "no cuts, no new objects". For your own footage,
>   write what you'll use under **Notes** (e.g. *"use drone_coast.mp4 from 0:12"*) and drop the clip on
>   the scene from the Library.
>
> - **Voice:** the exact words the narrator says. They are spoken verbatim. When a character speaks,
>   put their label from **Speakers** first, `{Eli}`, and `{Narrator}` where the narration goes on:
>   *{Eli} [playfully] Eli to Mom, over. {Narrator} Every Saturday it was pancakes by walkie-talkie.*
>   The labels aren't spoken.
>   - Write it as it should be **heard**. Spell out what's awkward to read: "twenty twenty-four",
>     "three point five million", "N-A-S-A" or "NASA" as you want it pronounced.
>   - Use punctuation to control delivery: commas and full stops for pauses, an ellipsis (…) for a
>     longer beat, a question mark for a rising tone, a dash for a sudden turn.
>   - Write it the way you'd tell it: whole sentences of everyday length, joined with *and*, *so*,
>     *then*. Avoid long, nested sentences, but avoid stacking fragments too ("Keys. Bag. Eli."):
>     on every line they sound clipped and listy. Keep a short line for the few moments that should
>     land like a blow.
>   - Numbers sparingly: the clock the story runs on, said where it matters. Say the rest as what it
>     means ("the needle was already low") instead of as figures.
>   - **Direct the performance with audio tags** in square brackets, e.g. `[whispers]`,
>     `[sighs]`, `[excited]`, placed right where the delivery should change. They're performed, not
>     spoken, but **only with the Eleven v4 / v4 Turbo / v3 voice models**. See *Audio tags* below
>     for the full reference and rules. With other models, leave tags out and put directions in
>     **Notes**.
>   - Delivery directions in parentheses like "(whispering)" are always read out loud. Use a tag or
>     **Notes** instead.
>   - **Emphasis:** CAPITALISE a word to stress it ("it was HUGE"). Use sparingly.
>   - **Fit the timing:** the narrator speaks about **2.5 words per second** (tags don't count as
>     words), so a 7-second scene fits about 15–17 words. Reactions like `[sighs]`, `[laughs]` or
>     `[long pause]` add roughly half a second to a second each. Leave ~0.5 s of breathing room. If
>     the generated voice runs longer than the scene, the editor lengthens the scene so nothing is
>     cut off, and later scenes shift. Claude warns you about scenes that look too tight.
>
> - **Sound in three layers** (what makes horror and survival videos feel expensive):
>   1. **Drone:** a low sub-bass hum or dark ambient bed under the whole video, as the **Music**
>      track (see Project). It's constant tension you feel more than hear.
>   2. **Room tone:** the place's **Ambience** (see Project), the space's own hum (ventilation,
>      generator, birdsong, rain on the roof above), continuous for as long as the story stays there,
>      so every place sounds different and none restarts at a cut.
>   3. **Precise events:** **SFX 2–4**, timed to the words: floorboards creaking overhead, a steel
>      crossbar locking, a can rolling, quiet rustling. Small, close and exact beats loud and vague.
>
> - **Ambience:** the name of the place's ambience from the Project's **Ambience** list, e.g.
>   *Bunker*. Blank = no ambience (a planned silence, a blackout, a hard cut to nothing).
>
> - **SFX:** a background sound for **this scene only**, on top of the ambience: something the
>   place's loop doesn't have (a child breathing close by, a heartbeat under a reveal, a radio
>   hissing). Generated by ElevenLabs at the scene's length (max 30 s), mixed quietly under the
>   voice. Don't repeat the ambience here: the two would play on top of each other.
>   - **One sound per line.** Each sound gets its own line (the background here, the rest as SFX 2–4
>     below), so it can be generated, timed and balanced on its own. *"Alert tones fading, a dog
>     barking, sirens closer"* is three lines.
>   - **Describe it in full, like a sound designer's brief** (25–60 words): the source and what it
>     does, what it sounds like (texture, pitch), how it moves in time (attack, build, repeat, fade),
>     where it is (close and dry, a few houses away, through the car glass, the room's echo), the mood,
>     and what to leave out. E.g. *"A single small plastic record button pressed down on a cheap
>     handheld cassette dictaphone, one crisp mechanical click with a tiny spring-loaded clack,
>     recorded very close and completely dry, quiet and intimate, no echo, no tape hiss, no music, no
>     voices"*, not *"a dictaphone click"*.
>   - Say how it moves over time if it matters: *"starting faint and slowly rising in pitch and
>     volume"*, *"a dull hollow boom repeated every two seconds"*, *"cut off cleanly"*.
>   - Use real-world terms like whoosh, impact, riser, sub-bass hit, room tone, footsteps on gravel.
>   - End with what to leave out: *no music*, *no voices* (*no words* for breathing or crying), and
>     anything the model likes to add (*no echo*, *no thunder*, *no traffic*).
>   - Don't ask for **speech** (that's the voice) or **music** (that's the Music track). They come out
>     poorly as effects.
>   - Leave it blank for scenes that should only have voice and music.
>   - **Events on top of it:** add up to three **SFX 2 / SFX 3 / SFX 4** lines, one sound each (4 per
>     scene in total). They all play together with the background. Each can say:
>     - **when:** *at "word"* to land exactly when the narrator says that word, or *from 3s*;
>     - **how long:** *1.5s*. Size it to the sound (a hit or break 1–2 s, a door 2–3 s, footsteps
>       3–6 s), not to the scene;
>     - **how loud** *(optional)*: *volume 70%* for something distant under a closer sound.
>
>     e.g. Voice: *"Suddenly the glass breaks."* · **SFX 2 (at "breaks", 1.5s):** *a large plate glass
>     window shattering, a loud explosive crash with shards raining onto a concrete floor, violent and
>     sudden, small room echo, no voices, no music*. Synced sounds are moved to the exact moment the
>     word is spoken when the voiceover is generated. Claude splits a mixed SFX line into one line per
>     sound for you, writes each out in full, and shows the timing.
>
> - **Shot 2 / Shot 3 / Shot 4** *(optional)*: more pictures during the same narration. Write an image
>   prompt, when it cuts in: *at "word"* (exactly when the narrator says it) or *from 4s*, and its
>   camera move, e.g. **Shot 2 (at "tea", zoom in):** *Close-up of Eli's hands around a steaming metal
>   mug.* The Image above is shot 1; each shot lasts until the next. Up to 4 pictures per scene; keep
>   each on screen ≥ 1.5 s. Two pictures of ~2–4 s over one line of narration feel like a moving
>   picture; one picture held for 7–8 s feels like a slideshow (see *Vary the camera and the cut*).
>
> - **Camera:** how this scene's image moves: still, zoom in, zoom out, pan left → right, pan right →
>   left, pan top → bottom, pan bottom → top. Leave it blank to use the project's camera motion.
>   Choose it for what the picture is doing in the story (see *Vary the camera and the cut*): pans
>   suit wide landscapes (left → right) and tall subjects (bottom → top for a tree or tower).
>
> - **References:** the *Cast & locations* this scene's image shows, by name: **everyone in it, even
>   just a hand**, and the place's plate for the way the camera faces, e.g. *Kitchen, Nora*. Not the
>   people it doesn't show: each reference is someone the image model draws. A shot that shows other
>   people or faces the other way lists its own after its timing: *Shot 2 (at "word", zoom in)
>   [References: Kitchen, Eli]:*. The plates keep the place the same from every angle, the character
>   sheets the people.
>
> - **Title:** big on-screen text over the first 3 seconds, e.g. *DAY 12*, *WATER: 47 GALLONS*,
>   *CO2: 1,800 PPM*. Rendered in the edit, so it's always spelled right (unlike text in images).
>   Use it for chapter markers, counters and the rules of the world, not for full sentences.
>
> - **Shake:** light | heavy. Camera shake on export for a tense moment: *light* for unease
>   (footsteps overhead, a distant bang), *heavy* for impact or panic (a door hit, an explosion). A few
>   scenes per video at most, or it stops working.
>
> - **Notes:** anything for you, not for the generators: footage to import, on-screen text to add,
>   transitions, things to double-check. Shown on the timeline and in the scene's sidebar.

### Scene 1 · 0:00–0:07
- **Image:**
- **Voice:**
- **Ambience:**
- **SFX:**
- **SFX 2:**
- **Shot 2 (at "", zoom in):**
- **Camera:**
- **References:**
- **Title:**
- **Shake:**
- **Notes:**

### Scene 2 · 0:07–0:13
- **Image:**
- **Voice:**
- **Ambience:**
- **SFX:**
- **SFX 2:**
- **Camera:**
- **References:**
- **Title:**
- **Shake:**
- **Notes:**

### Scene 3 · 0:13–0:21
- **Image:**
- **Voice:**
- **SFX:**
- **SFX 2:**
- **Camera:**
- **References:**
- **Title:**
- **Shake:**
- **Notes:**

---

## Audio tags (Eleven v4 / v3 voice models)

> This is the reference Claude uses when it turns a story into voice lines. Tags are short
> **performance directions in square brackets** inside the Voice text. They're performed by the voice
> and never spoken.
>
> **They only work when the project's voice model is Eleven v4, Eleven v4 Turbo or Eleven v3.** With
> Multilingual v2, Turbo v2.5 or Flash v2.5, the brackets are read out loud. The editor warns you
> about this in the scene sidebar.
>
> The list is **not closed**. ElevenLabs publishes these as examples and the model understands
> other short, descriptive directions too, e.g. `[quiet, reflective narration]` or
> `[low, gravelly voice]`. Results depend on the voice: a calm narrator voice won't convincingly shout
> or do a pirate. The tags below come from ElevenLabs' own documentation and examples.

### Tag reference

| Category | Tags | Use for |
| --- | --- | --- |
| **Emotion** | `[happy]` `[sad]` `[angry]` `[excited]` `[curious]` `[nervous]` `[worried]` `[frustrated]` `[tired]` `[upset]` `[sorrowful]` `[regretful]` `[calm]` `[awe]` `[surprised]` `[annoyed]` `[exasperated]` `[appalled]` `[thoughtful]` `[crying]` `[panicking]` | How the narrator **feels** about the next line |
| **Tone & attitude** | `[cheerfully]` `[playfully]` `[mischievously]` `[cheeky]` `[sarcastic]` / `[sarcastically]` `[deadpan]` `[flatly]` `[dismissive]` `[matter-of-fact]` `[dramatic]` / `[dramatically]` `[cautiously]` `[hesitant]` `[resigned tone]` `[neutral tone]` `[professional]` `[sympathetic]` `[reassuring]` `[questioning]` | **How** a line is said, independent of emotion |
| **Volume & energy** | `[whispers]` `[softly]` `[quietly]` `[loudly]` `[shouts]` / `[shouting]` `[booming]` | Loudness and intensity |
| **Pacing & rhythm** | `[pause]` `[short pause]` `[long pause]` `[pauses]` `[hesitates]` `[stammers]` `[slowly]` `[drawn out]` `[rushed]` | Beats, suspense, nervous or rushed speech |
| **Reactions (non-verbal)** | `[sighs]` `[sigh of relief]` `[exhales]` `[exhales sharply]` `[inhales deeply]` `[gasps]` `[gulps]` `[swallows]` `[clears throat]` `[laughs]` `[light chuckle]` `[chuckles]` `[giggles]` `[laughs harder]` `[starts laughing]` `[wheezing]` `[snorts]` `[coughing]` | Human sounds between or before words |
| **Character & accent** *(experimental)* | `[British accent]` `[American accent]` `[Australian accent]` `[Irish accent]` `[Scottish accent]` `[Southern US accent]` `[New York accent]` `[Indian English]` `[French accent]` `[German accent]` `[Spanish accent]` `[Italian accent]` `[Russian accent]` `[strong X accent]` `[pirate voice]` `[evil scientist voice]` `[robotic tone]` `[childlike tone]` `[fantasy narrator]` `[sci-fi AI voice]` `[classic film noir]` `[sings]` | Quoting a character, a one-off voice, a genre feel |
| **Sound effects in the voice** *(avoid here)* | `[applause]` `[clapping]` `[gunshot]` `[explosion]` | Prefer the scene's **SFX** field: it's mixed separately and easier to fix |

### Rules for adding tags (what Claude follows)

1. **Only with Eleven v4 / v4 Turbo / v3.** If the project uses another voice model, Claude asks
   whether to switch to Eleven v4 or to leave the tags out.
2. **Never change the words.** Tags are added around the narration, not instead of it. When you give
   an exact script, Claude only *suggests* tags. When you ask it to write narration from a story, it
   adds them as it writes.
3. **Place each tag right before the words it affects**, or right after for a reaction:
   `[whispers] Don't move.` / `I can't believe it worked. [laughs]`
4. **Use them sparingly.** For documentary-style narration, aim for at most one tag every one or two
   sentences, and none on lines that read fine plainly. Use them where the meaning shifts: a reveal,
   a joke, a moment of tension, a change of mood. Dialogue and drama can carry more.
5. **Keep tags auditory.** Describe something you can hear. Visual actions like `[smiles]`,
   `[nods]`, `[pacing]` and `[standing]`, or `[music]`, do nothing or get read out.
6. **Match the voice and the video's tone.** A serious history narrator suits `[thoughtful]`,
   `[quietly]`, `[pause]`, not `[giggles]`. Accent and character tags are for quoting someone, not for
   the narrator's normal voice.
7. **Combine for nuance** when one tag isn't enough: `[tired] [sighs] Another day, another storm.`
8. **Let punctuation do the small things.** Ellipses (…) add hesitation and weight, a dash marks a
   sudden break, ! and ? shape the rhythm, and CAPS add emphasis. Use a tag only for what punctuation
   can't do.
9. **No SSML.** `<break time="1s"/>` and similar don't work on these models. Use `[pause]` /
   `[long pause]` or an ellipsis.
10. **One narrator per project.** The editor uses one voice for the whole video. For a quoted
    character, use a tag like `[gravelly old man voice]` or an accent tag on that line, or note the
    line in **Notes** to record it separately.

### Examples

| Plain | With tags |
| --- | --- |
| Two hundred meters down, the sunlight starts to fail. Welcome to the twilight zone. | Two hundred meters down, the sunlight starts to fail. [pause] [quietly] Welcome… to the twilight zone. |
| Nobody expected the experiment to work. It did. | Nobody expected the experiment to work. [short pause] [excited] It DID. |
| The captain read the letter and said nothing for a long time. | The captain read the letter… [long pause] [sighs] and said nothing for a long time. |
| "Run," she said. "They're coming." | [whispers] "Run," she said. [panicking] "They're coming." |
| And that, believe it or not, is how the cat became mayor. | And that, believe it or not, [deadpan] is how the cat became mayor. [light chuckle] |

---

## Example (filled in)

> This example uses audio tags, so its project's **Voice model** is Eleven v4.

### Scene 1 · 0:00–0:07
- **Image:** A small yellow research submarine descending into deep blue water, seen from slightly
  below, shafts of sunlight fading from the surface far above, tiny particles drifting in the beam of
  its headlights, vast empty darkness below
- **Voice:** Two hundred meters down, the sunlight starts to fail. [pause] [quietly] Welcome… to the twilight zone.
- **SFX:** Deep underwater ambience, muffled bubbles rising past, low steady hum of a submarine motor
- **Title:** The Twilight Zone
- **Notes:**

### Scene 2 · 0:07–0:13
- **Image:** Extreme close-up of a translucent jellyfish glowing electric blue and violet against
  pitch-black water, light rippling along its trailing tentacles, centred in frame
- **Voice:** Down here, almost everything makes its own light.
- **SFX:** Soft shimmering underwater tones, faint distant sonar ping
- **Notes:**

---

## Writing like a director

> What separates a gripping AI story video from generic AI content is mostly the script and the
> shot list, not the models. Claude follows these when it writes or reviews scenes.

- **Write a screenplay, not an article.** Every scene is something the viewer *sees* happening. Cut
  lines that summarise ("Things got worse") and show the moment that proves it.
- **Ground it in specifics.** Numbers, rules and procedures make a world feel real: *"47 gallons.
  Two cups a day each. That's 94 days."*, *"Rule three: no noise after dark."*, *"The CO2 gauge read
  1,800."* Put the key ones on screen with **Title**.
- **Show, don't tell.** Instead of "she was scared": *"Jen's hand stopped on the ladder. Above us,
  the floorboards creaked. Once. Twice."*
- **Structure in days or steps.** Chapter markers (*DAY 1*, *DAY 12*, *DAY 365*) as Titles give
  progress and a reason to keep watching.
- **One image, one beat.** Each picture is a single clear moment; use shots for a reveal, then the
  reaction, and a flipbook of *next frames* when the beat is an action happening.
- **Sensory-anchor image prompts.** Name the lens, light source and finish, once, in the project's
  **Visual style** (it's added to every prompt): *"35mm anamorphic, volumetric dust motes, dramatic
  side light from an emergency lantern, Kodak 500T film grain, photorealistic"*. In the scene,
  describe the moment and its own light (*"lit only by the red glow of the generator panel"*).
- **Tension needs stillness.** Long holds with a slow push in, quiet room tone, a single sound event
  and a light **Shake** land harder than fast cutting.
- **Vary the camera and the cut.** Give each picture the move its beat calls for, never one default
  on everything:
  - *zoom in*: tension, a realisation, a face; *zoom out*: isolation, relief, a reveal of how alone
    or how big; *pan left → right*: travel and action (keep one screen direction for a journey, e.g.
    the car always moves left → right); *pan right → left*: retreat, looking back, memory; *pan top →
    bottom*: sinking onto an object, dread; *pan bottom → top*: rising (a tower, floodlights, hope);
    *still*: a shock frame, a silence, a frozen face.
  - Mix them: no single move on more than about 40% of the pictures, and not the same move on 4 or
    more pictures in a row. Alternate moves between neighbouring pictures (push in, then pull back).
  - **Vary the rhythm too:** most narration lines get 2 pictures of 2–4 s (a wide, then a detail or
    the reaction), action gets quick runs of 3–4 short pictures, and the biggest beats get one long,
    still or slowly pushing hold. Hold a single picture longer than ~8 s only on purpose.

---

## Presets

> Write **Preset: survival horror** in the Project section and Claude fills these in (your own lines
> win). Claude shows what it applied.

### Survival horror (bunker, outbreak, "365 days" stories)
- **Visual style:** cinematic still from a survival horror film, 35mm anamorphic lens, volumetric
  dust motes in the air, dramatic side lighting from an emergency lantern, deep shadows, Kodak 500T
  film grain, photorealistic, highly detailed
- **Camera motion:** slow zoom in as the fallback, but set a **Camera** on every scene and a motion on
  every shot (see *Vary the camera and the cut*) · **Camera move:** 5%
- **Colour grade:** cold bunker · **Vignette:** 50% · **Film grain:** 25%
- **Captions:** word by word (bottom; center for 9:16)
- **Voice model:** Eleven v4 · **Voice settings:** stability 0 (Creative; use 0.5 if it drifts),
  style 0.3. A deep, slightly raspy male or tired female narrator voice, first person.
- **Music:** a generated low drone, e.g. *"slow dark ambient drone, deep sub-bass hum, a sustained low
  cello note, very slow evolving texture, no drums, no vocals, no melody"*, 180–300 s, volume 15%
- **Sound:** an **Ambience** per location (the bunker, the street, the car), every scene names its
  place, and 1–2 precise event sounds (*SFX 2–3*); *SFX* only for what this one scene adds
- **Pacing:** 4–7 s scenes with a new picture every 2–4 s (shots), a **Title** at every day change, **Shake** (light) on 1 in 10–15
  scenes at most: the threats
- **Motion:** a flipbook (3–4 frames of the same framing, see *Motion without video*) for the moments
  where something happens, about 1 in 10–15 scenes; no video clips unless asked
