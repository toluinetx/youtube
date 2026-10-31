import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, AudioLines, BookmarkPlus, Copy, Eye, Film, Plus, ImageIcon, Loader2, NotebookPen, RefreshCw, Sparkles, Trash2, TriangleAlert, Upload,
  Wand2, X,
} from 'lucide-react';
import {
  ACCEPT, AUDIO_TAG, AUDIO_TAG_MODELS, MAX_SHOTS, MOTIONS, SHAKES, cueTime, formatTime, motionLabel, newShot, newSfxLayer, sceneTimeline, shotNumbers,
  withoutSpeakers,
} from '../util.js';
import ReferenceList from './ReferenceList.jsx';
import { entriesFor } from '../continuity.js';
import { api } from '../api.js';
import { ImageModelControl, SfxModelControl, VideoModelControl, VoiceControl, VoiceModelControl } from './ModelControls.jsx';

const WORDS_PER_SEC = 2.6;

export default function Inspector({
  scene, previousScene, tab, index, count, start, settings, library, ambience = [], onEditAmbience, busy, errors, onChange, onRegenerate, onUpload, onClear, onDelete, onDuplicate, onMove,
  onRequestSnapshot, onUploadFiles, onSaveToLibrary, onOpenProject, onGenerateVideo, onChangeSettings, onGenerateSfxLayer, onUploadSfxLayer,
  onGenerateShot, onUploadShot, claudeReady = false, onCheckWithClaude, continuity = [], scenes = [],
}) {
  const isBusy = (slot) => Boolean(busy[`${scene.scene_id}:${slot}`]);
  const errorFor = (slot) => errors[`${scene.scene_id}:${slot}`];
  // Audio tags like [whispers] are performed, not spoken, so they don't count as words.
  const spoken = withoutSpeakers(scene.voiceover_text).replace(AUDIO_TAG, ' ').trim();
  const words = spoken ? spoken.split(/\s+/).length : 0;
  const tags = scene.voiceover_text.match(AUDIO_TAG) || [];
  const tagsReadAloud = tags.length > 0 && !AUDIO_TAG_MODELS.includes(settings.tts_model);
  const voLen = scene.voiceover_duration_sec;
  const voTooLong = voLen > scene.duration_sec;
  const isVideo = Boolean(scene.video_url);
  const names = scene.source_names || {};
  const libraryIds = new Set(library.map((a) => a.asset_id));
  const projectRefs = (settings.reference_asset_ids || []).filter((id) => libraryIds.has(id));
  const styleRefs = (settings.style_references || []).map((r) => r.asset_id).filter((id) => libraryIds.has(id));
  const sceneRefs = scene.reference_asset_ids || [];
  // On unless turned off (older scenes don't have the field): the project-wide references, and the style
  // images, which follow them unless the scene sets its own.
  const useProjectRefs = scene.use_global_references !== false;
  const useStyleRefs = scene.use_style_references ?? useProjectRefs;
  // The previous scene's picture is sent too (for continuity) unless turned off.
  const previousPicture = previousScene && (previousScene.video_thumb_url || previousScene.image_url);
  const usePrevious = scene.use_previous_scene !== false;
  const refCount =
    new Set([...sceneRefs.filter((id) => libraryIds.has(id)), ...(useProjectRefs ? projectRefs : []), ...(useStyleRefs ? styleRefs : [])]).size +
    (usePrevious && previousPicture ? 1 : 0);
  const imageInLibrary = library.some((a) => a.url === scene.image_url);
  const [visualTab, setVisualTab] = useState(isVideo ? 'video' : 'image');
  // Put "{Name} " at the cursor in the voiceover text, so what follows is spoken in that voice.
  const voiceText = useRef(null);
  const insertSpeaker = (name) => {
    const el = voiceText.current;
    const text = scene.voiceover_text;
    const at = el ? el.selectionStart : text.length;
    const before = text.slice(0, at);
    const label = `${before && !/\s$/.test(before) ? ' ' : ''}{${name}} `;
    onChange({ voiceover_text: before + label + text.slice(at) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = at + label.length;
    });
  };
  const layers = scene.sfx_layers || [];
  const setLayers = (next) => onChange({ sfx_layers: next });
  const shots = scene.shots || [];
  // Items synced to a word follow it; the time is sent along so this tab shows it right away.
  const withCueTime = (item) => {
    const t = cueTime(scene, item.cue);
    return t ? { ...item, start_sec: t.sec } : item;
  };
  const editShot = (id, patch) => onChange({ shots: shots.map((s) => (s.shot_id === id ? withCueTime({ ...s, ...patch }) : s)) });
  const addShot = () => {
    // Halfway between the last cut and the end of the scene.
    const last = Math.max(0, ...shots.map((s) => s.start_sec));
    onChange({ shots: [...shots, newShot(Math.round(((last + scene.duration_sec) / 2) * 10) / 10)] });
  };

  return (
    <div className="divide-y divide-zinc-800">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Scene {index + 1}</h2>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 tabular-nums">
            <span>{formatTime(start, true)} –</span>
            <input
              id="duration"
              type="number"
              min={0.5}
              max={600}
              step={0.5}
              className="field w-16 px-1.5 py-0.5 text-xs tabular-nums"
              value={scene.duration_sec}
              aria-label="Scene length in seconds"
              title="Scene length (seconds). Generating a voiceover that runs longer lengthens the scene so the narration isn't cut off; a video shorter than the scene holds its last frame."
              onChange={(e) => {
                const d = Number(e.target.value);
                if (d >= 0.5 && d <= 600) onChange({ duration_sec: d });
              }}
            />
            <span>s</span>
            {voLen > 0 && Math.abs(Math.ceil((voLen + 0.5) * 10) / 10 - scene.duration_sec) >= 0.1 && (
              <button
                className="icon-btn size-6"
                title={`Fit to the voiceover: ${(Math.ceil((voLen + 0.5) * 10) / 10).toFixed(1)}s (its length plus half a second)`}
                aria-label="Fit the scene length to the voiceover"
                onClick={() => onChange({ duration_sec: Math.ceil((voLen + 0.5) * 10) / 10 })}
              >
                <Wand2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center">
          <button className="icon-btn" title="Move earlier" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowLeft className="size-4" />
          </button>
          <button className="icon-btn" title="Move later" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowRight className="size-4" />
          </button>
          <button className="icon-btn" title="Duplicate scene (prompts only)" onClick={onDuplicate}>
            <Copy className="size-4" />
          </button>
          <button className="icon-btn hover:!text-red-400" title="Delete scene" onClick={onDelete}>
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      {tab === 'visual' && (
      <Section
        icon={isVideo ? Film : ImageIcon}
        color="text-image"
        title={`Visual · ${index + 1}.1`}
        hint={isVideo ? 'Showing a video clip' : scene.image_url ? 'Showing an image' : 'Nothing yet'}
      >
        <div
          className="relative mb-2 overflow-hidden rounded-md bg-zinc-900 ring-1 ring-zinc-800"
          style={{ aspectRatio: settings.aspect_ratio.replace(':', ' / '), maxHeight: 260 }}
        >
          {isVideo ? (
            <video key={scene.video_url} src={`${scene.video_url}#t=${scene.video_start_sec || 0}`} controls preload="metadata" className="h-full w-full bg-black object-cover" />
          ) : scene.image_url ? (
            <a href={scene.image_url} target="_blank" rel="noreferrer" title="Open full size">
              <img src={scene.image_url} alt="" className="h-full w-full object-cover" />
            </a>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">No image or video yet</div>
          )}
          {isBusy('image') && <BusyOverlay />}
        </div>
        <SourceRow
          name={names.image}
          fallback={isVideo ? 'Video clip' : scene.image_url ? 'Generated image' : null}
          onClear={() => onClear('image')}
          busy={isBusy('image')}
          extra={
            scene.image_url &&
            !imageInLibrary && (
              <button
                className="flex shrink-0 items-center gap-0.5 hover:text-zinc-200"
                onClick={onSaveToLibrary}
                title="Copy this image into the library, e.g. to use it as a reference for other scenes"
              >
                <BookmarkPlus className="size-3" /> Save to library
              </button>
            )
          }
        />

        <div className="mt-3 flex rounded-md bg-zinc-900 p-0.5 ring-1 ring-zinc-800" role="tablist" aria-label="Make an image or a video">
          {[
            ['image', 'Image', ImageIcon],
            ['video', 'Video', Film],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={visualTab === key}
              className={`btn flex-1 py-1 text-xs ${visualTab === key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              onClick={() => setVisualTab(key)}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>

        {visualTab === 'image' ? (
          <div className="mt-3">
            {isVideo && <p className="mb-2 text-[11px] text-amber-400/90">This scene shows a video clip. A new image replaces it.</p>}
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">References</span>
              <div className="flex items-center gap-3">
                {previousScene && (
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-400" title="Also send the picture before (the previous scene's, and for each shot the one before it), to keep the shots continuous. Flipbook frames always get theirs.">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={usePrevious}
                      onChange={(e) => onChange({ use_previous_scene: e.target.checked })}
                    />
                    + previous scene
                  </label>
                )}
                <label
                  className="flex items-center gap-1.5 text-[11px] text-zinc-400"
                  title={
                    `Also send the Project panel's ${projectRefs.length} reference${projectRefs.length === 1 ? '' : 's'} for every scene (left). ` +
                    'Untick for a scene that shouldn\'t show them, e.g. a character who isn\'t in it.'
                  }
                >
                  <input
                    type="checkbox"
                    className="accent-indigo-500"
                    checked={useProjectRefs}
                    onChange={(e) => onChange({ use_global_references: e.target.checked })}
                  />
                  + project refs ({projectRefs.length})
                </label>
                {styleRefs.length > 0 && (
                  <label
                    className="flex items-center gap-1.5 text-[11px] text-zinc-400"
                    title={`Also send the project's ${styleRefs.length} style image${styleRefs.length === 1 ? '' : 's'}, for its look. Untick for a scene that should look different.`}
                  >
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={useStyleRefs}
                      onChange={(e) => onChange({ use_style_references: e.target.checked })}
                    />
                    + style ({styleRefs.length})
                  </label>
                )}
              </div>
            </div>
            <ReferenceList
              ids={sceneRefs}
              library={library}
              onChange={(ids) => onChange({ reference_asset_ids: ids })}
              onRequestSnapshot={onRequestSnapshot}
              onUploadFiles={onUploadFiles}
              emptyHint="Pick a character or place from the library (or drag one here) to keep this scene's look consistent."
            />
            {previousScene && usePrevious && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                {previousPicture ? (
                  <>
                    <img src={previousPicture} alt="" className="h-8 w-12 shrink-0 rounded object-cover ring-1 ring-white/10" />
                    <span>
                      Scene {index}'s {previousScene.video_url ? 'last frame' : 'image'} is sent too, for continuity (it isn't copied).
                    </span>
                  </>
                ) : (
                  <span>Scene {index} has no picture yet, so there's no previous shot to match.</span>
                )}
              </div>
            )}
            <div className="mt-3">
              {/* Scenes with references use the reference model, so show whichever this scene will use. */}
              <ImageModelControl
                key={refCount > 0 ? 'refs' : 'plain'}
                settings={settings}
                onChange={onChangeSettings}
                refs={refCount > 0}
                label={refCount > 0 ? `Image model (with ${refCount} reference${refCount > 1 ? 's' : ''})` : 'Image model'}
                hint="all scenes"
              />
            </div>

            <label className="label mt-3" htmlFor="image_prompt">Image prompt</label>
            <textarea
              id="image_prompt"
              rows={3}
              className="field resize-y"
              value={scene.image_prompt}
              placeholder="Describe what's on screen…"
              onChange={(e) => onChange({ image_prompt: e.target.value })}
            />
            {settings.style_prompt && (
              <p className="mt-1 truncate text-[11px] text-zinc-600" title={settings.style_prompt}>
                + project style: {settings.style_prompt}
              </p>
            )}
            <ContinuityChips
              continuity={continuity}
              slot={scene}
              prompt={scene.image_prompt}
              sceneId={scene.scene_id}
              scenes={scenes}
              onChange={onChange}
            />
            <Actions
              has={Boolean(scene.image_url)}
              secondary={isVideo}
              busy={isBusy('image')}
              disabled={!scene.image_prompt.trim()}
              error={errorFor('image')}
              label="Image"
              onGenerate={() => {
                if (isVideo && !window.confirm('Generating an image replaces the video clip for this scene. Continue?')) return;
                onRegenerate('image');
              }}
              accept={ACCEPT.image}
              uploadTitle="Upload an image"
              onUpload={(file) => onUpload('image', file)}
            />
            <ImageCheck
              check={scene.image_check}
              url={isVideo ? null : scene.image_url}
              passMark={settings.image_check_threshold ?? 80}
              claudeReady={claudeReady}
              busy={isBusy('image')}
              onCheck={onCheckWithClaude && (() => onCheckWithClaude(null))}
            />

            <label className="label mt-3" htmlFor="motion">Camera motion</label>
            <select id="motion" className="field" value={scene.motion || ''} onChange={(e) => onChange({ motion: e.target.value || null })}>
              <option value="">Project default: {motionLabel(settings.motion)}</option>
              {MOTIONS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-600">How the image moves on screen. Press Space to see it in the preview.</p>
          </div>
        ) : (
          <div className="mt-3">
            {isVideo && (
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="video_start">Start at (s)</label>
                  <input
                    id="video_start"
                    type="number"
                    min={0}
                    max={scene.video_duration_sec || undefined}
                    step={0.1}
                    className="field tabular-nums"
                    value={scene.video_start_sec}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 0) onChange({ video_start_sec: v });
                    }}
                  />
                  <p className="mt-1 text-[11px] text-zinc-600">Clip is {scene.video_duration_sec?.toFixed(1) ?? '?'}s long</p>
                </div>
                <div>
                  <label className="label" htmlFor="video_volume">
                    Clip audio {scene.video_has_audio ? `${Math.round(scene.video_volume * 100)}%` : ''}
                  </label>
                  {scene.video_has_audio ? (
                    <input
                      id="video_volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={scene.video_volume}
                      onChange={(e) => onChange({ video_volume: Number(e.target.value) })}
                      className="mt-2 w-full accent-sky-400"
                    />
                  ) : (
                    <p className="mt-2 text-[11px] text-zinc-600">This clip has no sound</p>
                  )}
                </div>
                {scene.video_duration_sec != null && (
                  <button
                    className="btn-secondary col-span-2"
                    title="Set the scene duration to the rest of the clip after the start point"
                    onClick={() => onChange({ duration_sec: Math.max(0.5, Math.round((scene.video_duration_sec - scene.video_start_sec) * 10) / 10) })}
                  >
                    <Wand2 className="size-3.5" /> Fit scene to clip
                  </button>
                )}
              </div>
            )}

            <VideoModelControl settings={settings} onChange={onChangeSettings} hint="all scenes" />

            <label className="label mt-3" htmlFor="video_prompt">Video prompt</label>
            <textarea
              id="video_prompt"
              rows={3}
              className="field resize-y"
              value={scene.video_prompt || ''}
              placeholder={scene.image_prompt.trim() ? 'Describe the action and camera movement… (empty: uses the image prompt)' : 'Describe the shot, action and camera movement…'}
              onChange={(e) => onChange({ video_prompt: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-zinc-600">
              {scene.image_url ? "Starts from this scene's image, which the clip then replaces (Ctrl/Cmd+Z brings it back)." : 'Tip: generate an image first to choose the opening frame.'}
            </p>
            <Actions
              has={isVideo}
              busy={isBusy('image')}
              disabled={!(scene.video_prompt?.trim() || scene.image_prompt.trim()) || !settings.video_model}
              error={errorFor('image')}
              label="Video"
              onGenerate={onGenerateVideo}
              accept={ACCEPT.video}
              uploadTitle="Upload a video clip"
              onUpload={(file) => onUpload('image', file)}
            />
          </div>
        )}

        <div className="mt-4 border-t border-zinc-800 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Shots in this scene</span>
            <span className="text-[10px] text-zinc-600">
              {shots.length + 1} of {MAX_SHOTS}
            </span>
          </div>
          <p className="text-[11px] text-zinc-600">
            {shots.length
              ? `Shot 1 is the ${isVideo ? 'clip' : 'image'} above, until ${(sceneTimeline(scene)[1]?.start ?? scene.duration_sec).toFixed(1)}s. Each shot after it cuts in at its time and lasts until the next; the narration runs across all of them.`
              : 'Cut to other pictures during this narration, e.g. a close-up when the narrator mentions something.'}
          </p>
          {shots.map((shot, n) => (
            <Shot
              key={shot.shot_id}
              shot={shot}
              number={shotNumbers(scene).get(shot.shot_id) ?? n + 2}
              pictureId={`${index + 1}.${shotNumbers(scene).get(shot.shot_id) ?? n + 2}`}
              cue={cueTime(scene, shot.cue)}
              shown={sceneTimeline(scene).find((p) => p.shot?.shot_id === shot.shot_id)}
              sceneDuration={scene.duration_sec}
              defaultMotion={settings.motion}
              busy={isBusy(`shot:${shot.shot_id}`)}
              error={errorFor(`shot:${shot.shot_id}`)}
              aspectRatio={settings.aspect_ratio}
              sceneRefs={sceneRefs}
              library={library}
              onRequestSnapshot={onRequestSnapshot}
              onUploadFiles={onUploadFiles}
              onEdit={(patch) => editShot(shot.shot_id, patch)}
              onRemove={() => onChange({ shots: shots.filter((s) => s.shot_id !== shot.shot_id) })}
              onGenerate={() => onGenerateShot(shot.shot_id)}
              passMark={settings.image_check_threshold ?? 80}
              claudeReady={claudeReady}
              onCheck={onCheckWithClaude && (() => onCheckWithClaude(shot.shot_id))}
              continuity={continuity}
              sceneId={scene.scene_id}
              onUpload={(file) => onUploadShot(shot.shot_id, file)}
            />
          ))}
          <button className="btn-ghost mt-2 w-full text-xs" onClick={addShot} disabled={shots.length >= MAX_SHOTS - 1}>
            <Plus className="size-3.5" /> Add a shot
          </button>
        </div>
      </Section>
      )}

      {tab === 'voice' && (
      <Section icon={AudioLines} color="text-voice" title="Voiceover" hint="ElevenLabs or upload">
        <textarea
          ref={voiceText}
          rows={4}
          className="field resize-y"
          value={scene.voiceover_text}
          placeholder="What the narrator says in this scene…"
          onChange={(e) => onChange({ voiceover_text: e.target.value })}
          aria-label="Voiceover text"
        />
        {settings.voices?.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-600">
            <span title="Put a speaker's label before their words; the rest is the narrator's. Labels aren't spoken.">Speakers:</span>
            {[...settings.voices.map((v) => v.name).filter((n) => n.toLowerCase() !== 'narrator'), 'Narrator'].map((name) => (
              <button
                key={name}
                type="button"
                className="rounded bg-zinc-800 px-1.5 font-mono text-zinc-300 hover:bg-zinc-700"
                title={`Insert {${name}}: what follows is spoken in ${name === 'Narrator' ? "the narrator's" : `${name}'s`} voice`}
                onClick={() => insertSpeaker(name)}
              >
                {`{${name}}`}
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-zinc-600">
          {words} words{tags.length ? ` + ${tags.length} audio tag${tags.length === 1 ? '' : 's'}` : ''} · ~{(words / WORDS_PER_SEC).toFixed(1)}s spoken
          {voLen ? ` · audio is ${voLen.toFixed(1)}s` : ''}
        </p>
        {tagsReadAloud && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>
              Audio tags like {tags[0]} only work with the Eleven v4 / v3 voice models. With the current model they'll be read
              out loud.{' '}
              <button className="underline underline-offset-2 hover:text-amber-300" onClick={onOpenProject}>
                Change the voice model
              </button>
            </span>
          </p>
        )}
        {scene.voiceover_url && (
          <>
            <audio key={scene.voiceover_url} src={scene.voiceover_url} controls className="mt-2 h-8 w-full" />
            <SourceRow name={names.voiceover} fallback="Generated voiceover" onClear={() => onClear('voiceover')} busy={isBusy('voiceover')} />
          </>
        )}
        {voTooLong && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
            <TriangleAlert className="size-3.5 shrink-0" /> Voiceover is longer than the scene and will be cut off.
          </p>
        )}
        <div className="mt-3 space-y-3">
          <VoiceControl settings={settings} onChange={onChangeSettings} hint="all scenes" />
          <VoiceModelControl settings={settings} onChange={onChangeSettings} hint="all scenes" />
        </div>
        <Actions
          has={Boolean(scene.voiceover_url)}
          busy={isBusy('voiceover')}
          disabled={!scene.voiceover_text.trim()}
          error={errorFor('voiceover')}
          label="Voiceover"
          onGenerate={() => onRegenerate('voiceover')}
          accept={ACCEPT.sound}
          uploadTitle="Upload your own recording (audio, or a video's soundtrack)"
          onUpload={(file) => onUpload('voiceover', file)}
        />
      </Section>
      )}

      {tab === 'sfx' && (
      <Section
        icon={Sparkles}
        color="text-sfx"
        title={layers.length ? `Sound effects (${layers.length + 1})` : 'Sound effect'}
        hint={layers.length ? 'All play at the same time' : 'ElevenLabs or upload'}
      >
        <SfxModelControl settings={settings} onChange={onChangeSettings} label="Model" hint="all scenes" />

        <div className="mt-3 flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="label">Ambience: the place's background loop</span>
            <select className="field" value={scene.ambience_id || ''} onChange={(e) => onChange({ ambience_id: e.target.value || null })}>
              <option value="">None</option>
              {ambience.map((a) => (
                <option key={a.ambience_id} value={a.ambience_id}>
                  {a.name || 'Untitled'}{a.url ? '' : ' (not generated yet)'}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-ghost px-2 py-1.5 text-xs" onClick={onEditAmbience} title="Add or edit ambience in the Music tab">
            {ambience.length ? 'Edit' : 'Add'}
          </button>
        </div>

        <div className={layers.length ? 'mt-3 rounded-md border border-zinc-800 p-2.5' : 'mt-3'}>
          {layers.length > 0 && <p className="mb-1.5 text-xs font-medium text-zinc-400">Sound 1</p>}
          <textarea
            rows={2}
            className="field resize-y"
            value={scene.sfx_prompt}
            placeholder="e.g. gentle rain on a window, distant thunder"
            onChange={(e) => onChange({ sfx_prompt: e.target.value })}
            aria-label="Sound effect prompt"
          />
          {scene.sfx_url && (
            <>
              <audio key={scene.sfx_url} src={scene.sfx_url} controls className="mt-2 h-8 w-full" />
              <SourceRow name={names.sfx} fallback="Generated sound effect" onClear={() => onClear('sfx')} busy={isBusy('sfx')} />
            </>
          )}
          <Actions
            has={Boolean(scene.sfx_url)}
            busy={isBusy('sfx')}
            disabled={!scene.sfx_prompt.trim()}
            error={errorFor('sfx')}
            label="SFX"
            onGenerate={() => onRegenerate('sfx')}
            accept={ACCEPT.sound}
            uploadTitle="Upload a sound effect"
            onUpload={(file) => onUpload('sfx', file)}
          />
        </div>

        {layers.map((layer, n) => (
          <SfxLayer
            key={layer.layer_id}
            layer={layer}
            number={n + 2}
            cue={cueTime(scene, layer.cue)}
            sceneDuration={scene.duration_sec}
            busy={isBusy(`sfx:${layer.layer_id}`)}
            error={errorFor(`sfx:${layer.layer_id}`)}
            onEdit={(patch) => setLayers(layers.map((l) => (l.layer_id === layer.layer_id ? withCueTime({ ...l, ...patch }) : l)))}
            onRemove={() => setLayers(layers.filter((l) => l.layer_id !== layer.layer_id))}
            onGenerate={() => onGenerateSfxLayer(layer.layer_id)}
            onUpload={(file) => onUploadSfxLayer(layer.layer_id, file)}
          />
        ))}

        <button className="btn-ghost mt-2 w-full text-xs" onClick={() => setLayers([...layers, newSfxLayer()])} disabled={layers.length >= 12}>
          <Plus className="size-3.5" /> Add another sound effect
        </button>
        {layers.length === 0 && <p className="text-[11px] text-zinc-600">Layer more sounds (rain + thunder + footsteps) that play at the same time.</p>}
      </Section>
      )}

      <Section icon={Wand2} color="text-zinc-400" title="Finishing" hint="On export">
        <label className="label" htmlFor="title_text">On-screen title</label>
        <input
          id="title_text"
          className="field"
          maxLength={80}
          value={scene.title_text || ''}
          placeholder='e.g. DAY 12 or 47 GALLONS LEFT'
          onChange={(e) => onChange({ title_text: e.target.value })}
        />
        <p className="mt-1 text-[11px] text-zinc-600">Shown big over the first 3 seconds of the scene.</p>
        <label className="label mt-3" htmlFor="shake">Camera shake</label>
        <select id="shake" className="field" value={scene.shake || ''} onChange={(e) => onChange({ shake: e.target.value || null })}>
          {SHAKES.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-zinc-600">For tense moments (footsteps overhead, a door hit). Only in the exported video.</p>
      </Section>

      <Section icon={NotebookPen} color="text-zinc-400" title="Notes" hint="Not used for generation">
        <AutoTextarea
          minRows={3}
          className="field resize-none"
          value={scene.notes || ''}
          placeholder="e.g. import the drone clip here, or a reminder for the edit"
          onChange={(e) => onChange({ notes: e.target.value })}
          aria-label="Scene notes"
        />
      </Section>
    </div>
  );
}

function Section({ icon: Icon, color, title, hint, children }) {
  return (
    <section className="px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-300 uppercase">
          <Icon className={`size-3.5 ${color}`} /> {title}
        </h3>
        <span className="text-[10px] text-zinc-600">{hint}</span>
      </div>
      {children}
    </section>
  );
}

/** One extra picture in a scene: its prompt, image, camera motion and when it cuts in. */
function Shot({
  shot, number, pictureId, cue, shown, sceneDuration, defaultMotion, busy, error, aspectRatio, sceneRefs, library, onRequestSnapshot, onUploadFiles,
  onEdit, onRemove, onGenerate, onUpload, passMark, claudeReady, onCheck, continuity, sceneId,
}) {
  const id = `shot-${shot.shot_id}`;
  const start = cue ? cue.sec : shot.start_sec;
  const outside = start <= 0 || start >= sceneDuration;
  return (
    <div className="mt-2 rounded-md border border-zinc-800 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">
          Shot {number} <span className="ml-1 rounded bg-zinc-800 px-1 font-semibold text-zinc-300 tabular-nums" title="Picture ID">{pictureId}</span>
          {shown && <span className="ml-1.5 font-normal text-zinc-600 tabular-nums">{shown.start.toFixed(1)}–{shown.end.toFixed(1)}s</span>}
        </span>
        <button className="icon-btn size-6 hover:!text-red-400" title="Remove this shot" onClick={onRemove} disabled={busy}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {shot.image_url && (
        <div className="relative mb-2 overflow-hidden rounded ring-1 ring-zinc-800" style={{ aspectRatio: aspectRatio.replace(':', ' / '), maxHeight: 140 }}>
          <a href={shot.image_url} target="_blank" rel="noreferrer" title={shot.source_name ? `Imported: ${shot.source_name}` : 'Open full size'}>
            <img src={shot.image_url} alt="" className="h-full w-full object-cover" />
          </a>
          {busy && <BusyOverlay />}
        </div>
      )}
      <ImageCheck check={shot.image_check} url={shot.image_url} passMark={passMark} claudeReady={claudeReady} busy={busy} onCheck={onCheck} />
      <textarea
        rows={2}
        className="field resize-y"
        value={shot.image_prompt}
        placeholder="e.g. Close-up of the dashboard switching to calm cyan blue"
        onChange={(e) => onEdit({ image_prompt: e.target.value })}
        aria-label={`Shot ${number} image prompt`}
      />
      <ContinuityChips continuity={continuity} slot={shot} prompt={shot.image_prompt} sceneId={sceneId} shotId={shot.shot_id} onChange={onEdit} />
      <label className="label mt-2" htmlFor={`${id}-cue`}>Cut in on words in the narration</label>
      <input
        id={`${id}-cue`}
        className="field"
        value={shot.cue || ''}
        placeholder='e.g. "tea" (leave empty to set the time yourself)'
        onChange={(e) => onEdit({ cue: e.target.value || null })}
      />
      {shot.cue?.trim() && (
        <p className={`mt-1 text-[11px] ${cue ? 'text-zinc-500' : 'text-amber-400'}`}>
          {!cue
            ? `"${shot.cue.trim()}" isn't in this scene's narration.`
            : cue.exact
              ? `Cuts in at ${cue.sec.toFixed(2)}s, exactly when "${shot.cue.trim()}" is spoken.`
              : `Cuts in at about ${cue.sec.toFixed(1)}s (estimated). Generate the voiceover to land it exactly on "${shot.cue.trim()}".`}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${id}-start`}>Cuts in at (s)</label>
          <input
            id={`${id}-start`}
            type="number"
            min={0.1}
            max={Math.max(0.1, sceneDuration - 0.1)}
            step={0.1}
            className="field tabular-nums disabled:opacity-60"
            value={start}
            disabled={Boolean(cue)}
            title={cue ? 'Set by the words it is synced to' : undefined}
            onChange={(e) => {
              const t = Number(e.target.value);
              if (Number.isFinite(t) && t >= 0) onEdit({ start_sec: t });
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-motion`}>Camera motion</label>
          <select id={`${id}-motion`} className="field" value={shot.motion || ''} onChange={(e) => onEdit({ motion: e.target.value || null })}>
            <option value="">Project default: {motionLabel(defaultMotion)}</option>
            {MOTIONS.map(([m, label]) => (
              <option key={m} value={m}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="mt-2 flex items-start gap-2 text-xs text-zinc-300">
        <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={Boolean(shot.continues)} onChange={(e) => onEdit({ continues: e.target.checked })} />
        <span>
          Next frame of the picture before
          <span className="block text-[11px] text-zinc-600">
            Same framing, only the action moves on. 3–4 frames ~2 s apart play like a short clip; keep their camera motion still.
          </span>
        </span>
      </label>
      <label className="mt-2 flex items-start gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          className="mt-0.5 accent-indigo-500"
          checked={Boolean(shot.reference_asset_ids)}
          onChange={(e) => onEdit({ reference_asset_ids: e.target.checked ? [...sceneRefs] : null })}
        />
        <span>
          Its own references
          <span className="block text-[11px] text-zinc-600">
            Instead of the scene's, e.g. only the character this picture shows. Project refs and style still follow the scene.
          </span>
        </span>
      </label>
      {shot.reference_asset_ids && (
        <div className="mt-1.5">
          <ReferenceList
            ids={shot.reference_asset_ids}
            library={library}
            onChange={(ids) => onEdit({ reference_asset_ids: ids })}
            onRequestSnapshot={onRequestSnapshot}
            onUploadFiles={onUploadFiles}
            emptyHint="Pick the characters and place this picture shows."
          />
        </div>
      )}
      {outside && <p className="mt-1 text-[11px] text-amber-400">It has to start after 0s and before the scene ends ({sceneDuration}s) to be shown.</p>}
      {!outside && !shot.image_url && <p className="mt-1 text-[11px] text-zinc-600">Not shown until it has a picture.</p>}
      <Actions
        has={Boolean(shot.image_url)}
        busy={busy}
        disabled={!shot.image_prompt.trim()}
        error={error}
        label="Image"
        onGenerate={onGenerate}
        accept={ACCEPT.image}
        uploadTitle="Upload an image for this shot"
        onUpload={onUpload}
      />
    </div>
  );
}

/** One extra sound effect: its own prompt, audio, start time and volume. Plays together with Sound 1. */
function SfxLayer({ layer, number, cue, sceneDuration, busy, error, onEdit, onRemove, onGenerate, onUpload }) {
  const id = `sfx-layer-${layer.layer_id}`;
  const start = cue ? cue.sec : layer.start_sec;
  return (
    <div className="mt-2 rounded-md border border-zinc-800 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">Sound {number}</span>
        <button className="icon-btn size-6 hover:!text-red-400" title="Remove this sound effect" onClick={onRemove} disabled={busy}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <textarea
        rows={2}
        className="field resize-y"
        value={layer.prompt}
        placeholder="e.g. distant thunder rolling, low rumble"
        onChange={(e) => onEdit({ prompt: e.target.value })}
        aria-label={`Sound effect ${number} prompt`}
      />
      {layer.url && (
        <>
          <audio key={layer.url} src={layer.url} controls className="mt-2 h-8 w-full" />
          <p className="mt-1 truncate text-[11px] text-zinc-500" title={layer.source_name || undefined}>
            {layer.source_name ? `Imported: ${layer.source_name}` : 'Generated sound effect'}
            {layer.duration_sec ? ` · ${layer.duration_sec.toFixed(1)}s` : ''}
          </p>
        </>
      )}
      <label className="label mt-2" htmlFor={`${id}-cue`}>Sync to words in the narration</label>
      <input
        id={`${id}-cue`}
        className="field"
        value={layer.cue || ''}
        placeholder='e.g. "breaks" (leave empty to set the time yourself)'
        onChange={(e) => onEdit({ cue: e.target.value || null })}
      />
      {layer.cue?.trim() && (
        <p className={`mt-1 text-[11px] ${cue ? 'text-zinc-500' : 'text-amber-400'}`}>
          {!cue
            ? `"${layer.cue.trim()}" isn't in this scene's narration.`
            : cue.exact
              ? `Plays at ${cue.sec.toFixed(2)}s, exactly when "${layer.cue.trim()}" is spoken.`
              : `Plays at about ${cue.sec.toFixed(1)}s (estimated). Generate the voiceover to land it exactly on "${layer.cue.trim()}".`}
        </p>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor={`${id}-start`}>Starts at (s)</label>
          <input
            id={`${id}-start`}
            type="number"
            min={0}
            max={Math.max(0, sceneDuration - 0.5)}
            step={0.1}
            className="field tabular-nums disabled:opacity-60"
            value={start}
            disabled={Boolean(cue)}
            title={cue ? 'Set by the words it is synced to' : undefined}
            onChange={(e) => {
              const t = Number(e.target.value);
              if (Number.isFinite(t) && t >= 0) onEdit({ start_sec: t });
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-length`}>Length (s)</label>
          <input
            id={`${id}-length`}
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            className="field tabular-nums"
            value={layer.length_sec ?? ''}
            placeholder={String(Math.max(0.5, Math.round((sceneDuration - start) * 10) / 10))}
            title="How long a sound to generate. Empty: until the end of the scene."
            onChange={(e) => {
              const d = e.target.value === '' ? null : Number(e.target.value);
              if (d === null || (Number.isFinite(d) && d >= 0.5 && d <= 30)) onEdit({ length_sec: d });
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-volume`}>Volume {Math.round(layer.volume * 100)}%</label>
          <input
            id={`${id}-volume`}
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={layer.volume}
            onChange={(e) => onEdit({ volume: Number(e.target.value) })}
            className="mt-2 w-full accent-amber-400"
          />
        </div>
      </div>
      {start >= sceneDuration && <p className="mt-1 text-[11px] text-amber-400">Starts after the scene ends, so it won't be heard.</p>}
      <Actions
        has={Boolean(layer.url)}
        busy={busy}
        disabled={!layer.prompt.trim()}
        error={error}
        label="SFX"
        onGenerate={onGenerate}
        accept={ACCEPT.sound}
        uploadTitle="Upload a sound effect"
        onUpload={onUpload}
      />
    </div>
  );
}

/** A textarea that grows to fit its text (at least `minRows` lines), so nothing is hidden. */
function AutoTextarea({ minRows = 2, value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} value={value} {...props} />;
}

/** Shows where the current media came from, with a button to remove it. */
function SourceRow({ name, fallback, onClear, busy, extra }) {
  const label = name || fallback;
  if (!label) return null;
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
      <span className="truncate" title={label}>{name ? `Imported: ${name}` : label}</span>
      {extra}
      <button className="flex shrink-0 items-center gap-0.5 hover:text-red-400 disabled:opacity-40" onClick={onClear} disabled={busy}>
        <X className="size-3" /> Remove
      </button>
    </div>
  );
}

/**
 * What the image check found in the picture now shown (a check of a picture since replaced is ignored):
 * problems it couldn't fix in its retries, or that the check couldn't run. Nothing when it passed.
 */
function ImageCheck({ check, url, passMark = 80, claudeReady, busy, onCheck }) {
  const current = check && url && check.url === url ? check : null;
  const scored = current?.score != null;
  const mark = current?.threshold ?? passMark;
  const passes = (n) => `${n} ${n === 1 ? 'pass' : 'passes'}`;
  const why = { stalled: ', stopped when two passes in a row brought no improvement', time: ', stopped at the time limit' }[current?.stopped] || '';
  const subscores = scored && current.scores
    ? ` (adherence ${current.scores.adherence}, logic ${current.scores.logic}, quality ${current.scores.quality})`
    : '';
  return (
    <>
      {current && !current.ok && (
        <div className="mt-1.5 mb-2 flex gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-300">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {current.error ? (
            <span>The image check couldn't run: {current.error}</span>
          ) : scored ? (
            <span title={subscores.trim()}>
              Claude scored this <b>{current.score}%</b> (pass mark {mark}%) after {passes(current.attempts || 1)}{why}: {current.issues.join(' ')}{' '}
              Edit the prompt (say who is in the frame and how many hands) and check again.
            </span>
          ) : (
            <span>
              {current.checker === 'claude' ? "Claude's check: still" : 'Still'} has problems after {current.attempts}{' '}
              {current.attempts === 1 ? 'try' : 'tries'}: {current.issues.join(' ')} Edit the prompt
              (say who is in the frame and how many hands) and regenerate.
            </span>
          )}
        </div>
      )}
      {current?.ok && scored && (
        <p className="mt-1 mb-1.5 text-[11px] text-emerald-400" title={subscores.trim()}>
          Claude scored this {current.score}% (pass mark {mark}%){current.issues.length ? `. Minor: ${current.issues.join(' ')}` : ''}
        </p>
      )}
      {onCheck && url && (
        <button
          className="btn-ghost mb-2 w-full text-xs"
          disabled={busy || !claudeReady}
          onClick={onCheck}
          title={
            claudeReady
              ? `Claude Code scores the picture against its prompt. Under ${passMark}%, a better variant is used, or the image model makes it again with what was wrong, until one passes or the retries run out.`
              : "Claude Code isn't available on the editor's machine: install it, sign in, and restart the editor (or set CLAUDE_BIN in .env)."
          }
        >
          <Eye className="size-3.5" /> {busy ? 'Working…' : scored ? 'Check again with Claude' : 'Check with Claude'}
        </button>
      )}
    </>
  );
}

function Actions({ has, secondary, busy, disabled, error, label, onGenerate, accept, uploadTitle, onUpload }) {
  const input = useRef(null);
  return (
    <>
      <div className="mt-2 flex gap-2">
        <button className={`${has || secondary ? 'btn-secondary' : 'btn-primary'} flex-1`} disabled={busy || disabled} onClick={onGenerate}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {busy ? 'Working…' : `${has ? 'Regenerate' : 'Generate'} ${label}`}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => input.current.click()} title={uploadTitle}>
          <Upload className="size-3.5" /> Upload
        </button>
        <input
          ref={input}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </div>
      {error && <p className="mt-1.5 text-xs break-words text-red-400">{error}</p>}
    </>
  );
}

function BusyOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
      <Loader2 className="size-5 animate-spin text-white" />
    </div>
  );
}

/**
 * The continuity bible's entries in one picture: the ones its prompt names (click to leave one out)
 * and any added by hand, the facts they add, and (for a scene) which point in the story it shows.
 */
function ContinuityChips({ continuity, slot, prompt, sceneId, shotId, scenes, onChange }) {
  const [preview, setPreview] = useState(null);
  if (!continuity.length) return null;
  const rows = entriesFor(continuity, slot, prompt);
  const include = slot.continuity_include || [];
  const exclude = slot.continuity_exclude || [];
  const set = (patch) => {
    setPreview(null);
    onChange(patch);
  };
  const others = rows.filter((r) => !r.included && !r.detected);
  const showPreview = async () => {
    if (preview) return setPreview(null);
    try {
      setPreview((await api.sceneContinuity(sceneId, shotId)).text || 'Nothing from the continuity bible applies to this picture.');
    } catch (err) {
      setPreview(`Couldn't load it: ${err.message}`);
    }
  };
  return (
    <div className="mt-1.5 mb-1">
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="text-zinc-500">Continuity:</span>
        {rows.filter((r) => r.included || r.detected).map(({ entry, detected, included }) => (
          <button
            key={entry.entry_id}
            className={`rounded px-1.5 py-px ring-1 ${included ? 'bg-zinc-800 text-zinc-200 ring-zinc-700 hover:ring-red-400/60' : 'text-zinc-600 line-through ring-zinc-800 hover:text-zinc-300'}`}
            title={
              included
                ? detected
                  ? `The prompt names ${entry.name}: its facts are added. Click to leave it out of this picture (e.g. it's only mentioned, not shown).`
                  : `Added by hand. Click to remove.`
                : `Left out of this picture. Click to add it back.`
            }
            onClick={() => {
              if (included && detected) set({ continuity_exclude: [...exclude, entry.entry_id] });
              else if (included) set({ continuity_include: include.filter((id) => id !== entry.entry_id) });
              else set({ continuity_exclude: exclude.filter((id) => id !== entry.entry_id) });
            }}
          >
            {entry.name}
            {included && !detected && ' +'}
          </button>
        ))}
        {others.length > 0 && (
          <select
            className="rounded bg-transparent px-1 py-px text-zinc-500 ring-1 ring-zinc-800 hover:text-zinc-300"
            value=""
            aria-label="Add a continuity entry to this picture"
            onChange={(e) => e.target.value && set({ continuity_include: [...include, e.target.value], continuity_exclude: exclude.filter((id) => id !== e.target.value) })}
          >
            <option value="">+ add</option>
            {others.map(({ entry }) => <option key={entry.entry_id} value={entry.entry_id}>{entry.name}</option>)}
          </select>
        )}
        <button className="ml-auto text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline" onClick={showPreview}>
          {preview ? 'hide text' : 'show text'}
        </button>
      </div>
      {!shotId && scenes && (
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
          Story time:
          <select
            className="rounded bg-transparent px-1 py-px ring-1 ring-zinc-800"
            value={slot.continuity_at ?? ''}
            onChange={(e) => set({ continuity_at: e.target.value === '' ? null : scenes.find((s) => String(s.scene_id) === e.target.value)?.scene_id ?? null })}
            title="For a flash-forward or flashback: take the continuity states (where the props are, how hurt she is) from the scene it shows."
          >
            <option value="">this scene</option>
            {scenes.map((s, i) => s.scene_id !== sceneId && (
              <option key={s.scene_id} value={s.scene_id}>as in scene {i + 1}{s.title_text ? ` · ${s.title_text}` : ''}</option>
            ))}
          </select>
        </label>
      )}
      {preview && <pre className="mt-1 max-h-48 overflow-auto rounded bg-zinc-900 p-2 text-[11px] whitespace-pre-wrap text-zinc-400">{preview}</pre>}
    </div>
  );
}
