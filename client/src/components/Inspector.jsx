import { useRef } from 'react';
import {
  ArrowLeft, ArrowRight, AudioLines, BookmarkPlus, Copy, Film, ImageIcon, Loader2, NotebookPen, RefreshCw, Sparkles, Trash2, TriangleAlert, Upload,
  Wand2, X,
} from 'lucide-react';
import { ACCEPT, formatTime } from '../util.js';
import ReferenceList from './ReferenceList.jsx';

const WORDS_PER_SEC = 2.6;

export default function Inspector({
  scene, index, count, start, settings, library, busy, errors, onChange, onRegenerate, onUpload, onClear, onDelete, onDuplicate, onMove,
  onRequestSnapshot, onUploadFiles, onSaveToLibrary, onOpenProject,
}) {
  const isBusy = (slot) => Boolean(busy[`${scene.scene_id}:${slot}`]);
  const errorFor = (slot) => errors[`${scene.scene_id}:${slot}`];
  const words = scene.voiceover_text.trim() ? scene.voiceover_text.trim().split(/\s+/).length : 0;
  const voLen = scene.voiceover_duration_sec;
  const voTooLong = voLen > scene.duration_sec;
  const isVideo = Boolean(scene.video_url);
  const names = scene.source_names || {};
  const libraryIds = new Set(library.map((a) => a.asset_id));
  const projectRefs = (settings.reference_asset_ids || []).filter((id) => libraryIds.has(id));
  const sceneRefs = scene.reference_asset_ids || [];
  const refCount = new Set([...sceneRefs.filter((id) => libraryIds.has(id)), ...(scene.use_global_references ? projectRefs : [])]).size;
  const imageInLibrary = library.some((a) => a.url === scene.image_url);

  return (
    <div className="divide-y divide-zinc-800">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Scene {index + 1}</h2>
          <p className="text-xs text-zinc-500 tabular-nums">
            {formatTime(start, true)} – {formatTime(start + scene.duration_sec, true)}
          </p>
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

      <Section icon={isVideo ? Film : ImageIcon} color="text-image" title={isVideo ? 'Video' : 'Image'} hint={isVideo ? 'Imported clip' : 'Replicate or upload'}>
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

        {isVideo && (
          <div className="mt-3 grid grid-cols-2 gap-3">
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

        <div className="mt-3 mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">References</span>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400" title="Also send the project-wide references (Project tab)">
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={scene.use_global_references}
              onChange={(e) => onChange({ use_global_references: e.target.checked })}
            />
            + project refs ({projectRefs.length})
          </label>
        </div>
        <ReferenceList
          ids={sceneRefs}
          library={library}
          onChange={(ids) => onChange({ reference_asset_ids: ids })}
          onRequestSnapshot={onRequestSnapshot}
          onUploadFiles={onUploadFiles}
          emptyHint="Drag a character or place from the library (videos: pick a frame) to keep this scene's look consistent."
        />
        <p className="mt-1 text-[11px] text-zinc-600">
          {refCount > 0 ? (
            <>
              Generates with <span className="text-zinc-400">{settings.reference_model || 'no model set'}</span> using {refCount} reference
              {refCount > 1 ? 's' : ''}.{' '}
              <button className="underline hover:text-zinc-300" onClick={onOpenProject}>Change</button>
            </>
          ) : (
            <>Without references: {settings.image_model}.</>
          )}
        </p>

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
        <Actions
          has={Boolean(scene.image_url)}
          secondary={isVideo}
          busy={isBusy('image')}
          disabled={!scene.image_prompt.trim()}
          error={errorFor('image')}
          label="Image"
          onGenerate={() => {
            if (isVideo && !window.confirm('Generating an image replaces the imported video for this scene. Continue?')) return;
            onRegenerate('image');
          }}
          accept={ACCEPT.visual}
          uploadTitle="Upload an image or video clip"
          onUpload={(file) => onUpload('image', file)}
        />
      </Section>

      <Section icon={AudioLines} color="text-voice" title="Voiceover" hint="ElevenLabs or upload">
        <textarea
          rows={4}
          className="field resize-y"
          value={scene.voiceover_text}
          placeholder="What the narrator says in this scene…"
          onChange={(e) => onChange({ voiceover_text: e.target.value })}
          aria-label="Voiceover text"
        />
        <p className="mt-1 text-[11px] text-zinc-600">
          {words} words · ~{(words / WORDS_PER_SEC).toFixed(1)}s spoken
          {voLen ? ` · audio is ${voLen.toFixed(1)}s` : ''}
        </p>
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

      <Section icon={Sparkles} color="text-sfx" title="Sound effect" hint="ElevenLabs or upload">
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
      </Section>

      <div className="px-4 py-4">
        <label className="label" htmlFor="duration">Duration (seconds)</label>
        <div className="flex gap-2">
          <input
            id="duration"
            type="number"
            min={0.5}
            max={600}
            step={0.5}
            className="field w-28 tabular-nums"
            value={scene.duration_sec}
            onChange={(e) => {
              const d = Number(e.target.value);
              if (d >= 0.5 && d <= 600) onChange({ duration_sec: d });
            }}
          />
          {voLen > 0 && (
            <button
              className="btn-secondary"
              title="Set the duration to the voiceover length plus half a second"
              onClick={() => onChange({ duration_sec: Math.ceil((voLen + 0.5) * 10) / 10 })}
            >
              <Wand2 className="size-3.5" /> Fit to voiceover
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Adding a voiceover lengthens the scene if the narration doesn't fit. A video shorter than the scene holds its last frame.
        </p>
      </div>

      <Section icon={NotebookPen} color="text-zinc-400" title="Notes" hint="Not used for generation">
        <textarea
          rows={2}
          className="field resize-y"
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
