import { useEffect, useRef, useState } from 'react';
import { Loader2, Music, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { ACCEPT, LOOKS, MOTIONS, formatTime } from '../util.js';
import ReferenceList from './ReferenceList.jsx';
import { ImageModelControl, SfxModelControl, VideoModelControl, VoiceControl, VoiceModelControl } from './ModelControls.jsx';

export default function ProjectSettings({ settings, onChange, status, library, onRequestSnapshot, onUploadFiles }) {
  return (
    <div className="space-y-5 px-4 py-4">
      <Field label="Video title">
        <input className="field" value={settings.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Format">
          <select className="field" value={settings.aspect_ratio} onChange={(e) => onChange({ aspect_ratio: e.target.value })}>
            <option value="16:9">16:9 YouTube</option>
            <option value="9:16">9:16 Shorts</option>
            <option value="1:1">1:1 Square</option>
          </select>
        </Field>
        <Field label="Frame rate">
          <select className="field" value={settings.fps} onChange={(e) => onChange({ fps: Number(e.target.value) })}>
            {[24, 25, 30, 60].map((f) => (
              <option key={f} value={f}>{f} fps</option>
            ))}
          </select>
        </Field>
      </div>
      <p className="-mt-3 text-[11px] text-zinc-600">Changing the format only affects images generated afterwards; existing ones get center-cropped.</p>

      <Group title="Images" subtitle="Replicate · Gemini" ok={status?.replicate || status?.gemini}>
        <ImageModelControl settings={settings} onChange={onChange} />
        <Field label="Style (appended to every image prompt)">
          <textarea
            rows={2}
            className="field resize-y"
            value={settings.style_prompt}
            placeholder="e.g. watercolor illustration, soft pastel palette"
            onChange={(e) => onChange({ style_prompt: e.target.value })}
          />
        </Field>
        <StyleReferences settings={settings} onChange={onChange} library={library} onRequestSnapshot={onRequestSnapshot} onUploadFiles={onUploadFiles} />
        <label className="flex items-start gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-amber-400"
            checked={settings.image_guardrails !== false}
            onChange={(e) => onChange({ image_guardrails: e.target.checked })}
          />
          <span>
            People &amp; hands guardrails
            <span className="block text-[11px] text-zinc-600">Tells the image model: only the people the scene describes, two hands each.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-amber-400"
            checked={Boolean(settings.image_check)}
            onChange={(e) => onChange({ image_check: e.target.checked })}
          />
          <span>
            Check each image, and retry up to{' '}
            <input
              type="number"
              min={0}
              max={5}
              className="field inline-block !w-12 !px-1.5 !py-0 text-center"
              value={settings.image_check_retries}
              disabled={!settings.image_check}
              onChange={(e) => onChange({ image_check_retries: Math.min(5, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
            />{' '}
            times
            <span className="block text-[11px] text-zinc-600">
              A Gemini vision model looks for extra hands or people and a missing subject. Each retry costs another image.
              {status && !status.gemini && ' Needs GEMINI_API_KEY in .env; skipped until then.'}
            </span>
          </span>
        </label>
        <Field label="Camera motion for images (scenes can override it)">
          <select className="field" value={settings.motion} onChange={(e) => onChange({ motion: e.target.value })}>
            {MOTIONS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label={`How far it moves: ${settings.motion_amount ?? 12}%${(settings.motion_amount ?? 12) <= 6 ? ' (slow cinematic push)' : ''}`}>
          <input
            type="range" min={2} max={30} step={1} value={settings.motion_amount ?? 12}
            onChange={(e) => onChange({ motion_amount: Number(e.target.value) })}
            className="w-full accent-amber-400"
          />
        </Field>
      </Group>

      <Group title="Finishing" subtitle="Applied on export">
        <Field label="Colour grade">
          <select className="field" value={settings.look || 'none'} onChange={(e) => onChange({ look: e.target.value })}>
            {LOOKS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Vignette: ${Math.round((settings.vignette || 0) * 100)}%`}>
            <input
              type="range" min={0} max={1} step={0.05} value={settings.vignette || 0}
              onChange={(e) => onChange({ vignette: Number(e.target.value) })}
              className="w-full accent-amber-400"
            />
          </Field>
          <Field label={`Film grain: ${Math.round((settings.grain || 0) * 100)}%`}>
            <input
              type="range" min={0} max={1} step={0.05} value={settings.grain || 0}
              onChange={(e) => onChange({ grain: Number(e.target.value) })}
              className="w-full accent-amber-400"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Captions">
            <select className="field" value={settings.captions || 'off'} onChange={(e) => onChange({ captions: e.target.value })}>
              <option value="off">Off</option>
              <option value="words">Word by word</option>
              <option value="lines">Subtitle lines</option>
            </select>
          </Field>
          <Field label="Position">
            <select
              className="field"
              value={settings.caption_position || 'bottom'}
              disabled={(settings.captions || 'off') === 'off'}
              onChange={(e) => onChange({ caption_position: e.target.value })}
            >
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-zinc-600">
          Captions follow the voiceover word by word, timed from the generated narration. The preview approximates the grade and vignette; see the exact result in the rendered MP4. Scenes add shake and on-screen titles in their own sidebar.
        </p>
      </Group>

      <ReferenceSettings
        settings={settings}
        onChange={onChange}
        status={status}
        library={library}
        onRequestSnapshot={onRequestSnapshot}
        onUploadFiles={onUploadFiles}
      />

      <Group title="Video" subtitle="Gemini API" ok={status?.gemini}>
        <VideoModelControl settings={settings} onChange={onChange} label="Model for Generate video" />
        <p className="text-[11px] text-zinc-600">
          Each scene gets a Generate video button. Clips take a minute or more and replace the scene's image.
          {status && !status.gemini && ' Add GEMINI_API_KEY to .env and restart to use it.'}
        </p>
      </Group>

      <Group title="Voice" subtitle="ElevenLabs" ok={status?.elevenlabs}>
        <VoiceModelControl settings={settings} onChange={onChange} />
        <VoiceControl settings={settings} onChange={onChange} />
      </Group>

      <Group title="Sound effects" subtitle="ElevenLabs" ok={status?.elevenlabs}>
        <SfxModelControl settings={settings} onChange={onChange} label="Model" />
        <Field label={`Volume in the mix: ${Math.round(settings.sfx_volume * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.sfx_volume}
            onChange={(e) => onChange({ sfx_volume: Number(e.target.value) })}
            className="w-full accent-amber-400"
          />
        </Field>
      </Group>

      <p className="text-[11px] text-zinc-600">Background music is in the Music tab on the right.</p>
    </div>
  );
}

const STYLE_REFERENCE_LIMIT = 6;

/**
 * Images that show the video's look, each with a caption saying what to take from it. They're sent
 * with every scene that has "+ project & style refs" ticked, for images and video clips.
 */
function StyleReferences({ settings, onChange, library, onRequestSnapshot, onUploadFiles }) {
  const refs = settings.style_references || [];
  const captions = Object.fromEntries(refs.map((r) => [r.asset_id, r.caption]));
  return (
    <div>
      <span className="label">Style images (sent with every image and video)</span>
      <ReferenceList
        ids={refs.map((r) => r.asset_id)}
        library={library}
        onChange={(ids) => onChange({ style_references: ids.map((id) => ({ asset_id: id, caption: captions[id] || '' })) })}
        captions={captions}
        onCaptionChange={(id, caption) => onChange({ style_references: refs.map((r) => (r.asset_id === id ? { ...r, caption } : r)) })}
        captionPlaceholder="What to take from it, e.g. ink linework and flat cel shading"
        max={STYLE_REFERENCE_LIMIT}
        onRequestSnapshot={onRequestSnapshot}
        onUploadFiles={onUploadFiles}
        emptyHint="Add images that show the look you want (drag from the library or drop files). The model copies their style, not what's in them."
      />
      <p className="mt-1 text-[11px] text-zinc-600">
        A caption says what each image is for (palette, linework, lighting). Video clips that start from a scene image get the captions only.
      </p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function Group({ title, subtitle, ok, children }) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 p-3">
      <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-zinc-300 uppercase">
        {title}
        <span className={`text-[10px] font-normal normal-case tracking-normal ${ok ? 'text-zinc-500' : 'text-amber-400'}`}>
          {subtitle}{ok === false ? ' · API key missing' : ''}
        </span>
      </h3>
      {children}
    </section>
  );
}

/** The video's background music: upload, volume, ducking. Shown in the Music tab. */
export function MusicSettings({ settings, onChange, busy, onUpload, onRemove }) {
  const input = useRef(null);
  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 p-3">
      <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-zinc-300 uppercase">
        Background music
        <span className="text-[10px] font-normal tracking-normal normal-case text-zinc-500">Your own file</span>
      </h3>
      {settings.music_url ? (
        <>
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Music className="size-3.5 shrink-0 text-fuchsia-400" />
            <span className="truncate" title={settings.music_name}>{settings.music_name}</span>
            <span className="shrink-0 text-zinc-500 tabular-nums">{formatTime(settings.music_duration_sec)}</span>
          </div>
          <audio key={settings.music_url} src={settings.music_url} controls className="h-8 w-full" />
          <Field label={`Music volume: ${Math.round(settings.music_volume * 100)}%`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.music_volume}
              onChange={(e) => onChange({ music_volume: Number(e.target.value) })}
              className="w-full accent-fuchsia-400"
            />
          </Field>
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5 accent-fuchsia-400"
              checked={settings.music_ducking}
              onChange={(e) => onChange({ music_ducking: e.target.checked })}
            />
            <span>
              Duck under voiceover
              <span className="block text-[11px] text-zinc-600">Lowers the music automatically while someone is speaking (in the export).</span>
            </span>
          </label>
          <p className="text-[11px] text-zinc-600">Loops if shorter than the video, then fades out at the end.</p>
        </>
      ) : (
        <p className="text-xs text-zinc-500">No music. Upload a track, or drop one onto the Music row of the timeline.</p>
      )}
      <div className="flex gap-2">
        <button className="btn-secondary flex-1" disabled={busy} onClick={() => input.current.click()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {settings.music_url ? 'Replace music' : 'Upload music'}
        </button>
        {settings.music_url && (
          <button className="btn-ghost hover:!text-red-400" disabled={busy} onClick={onRemove}>
            <X className="size-3.5" /> Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.sound}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (file) onUpload(file);
        }}
      />
    </section>
  );
}

function ReferenceSettings({ settings, onChange, status, library, onRequestSnapshot, onUploadFiles }) {
  const [capacity, setCapacity] = useState(undefined);
  const model = settings.reference_model;

  useEffect(() => {
    setCapacity(undefined);
    if (!status?.replicate || !model?.includes('/')) return;
    const t = setTimeout(() => {
      api.modelInfo(model).then((r) => setCapacity(r.reference_capacity)).catch(() => setCapacity('error'));
    }, 500);
    return () => clearTimeout(t);
  }, [model, status?.replicate]);

  const capacityText =
    capacity === undefined
      ? null
      : capacity === 'error'
        ? "Couldn't look up this model on Replicate."
        : capacity === 0
          ? "This model doesn't accept reference images. Pick another."
          : capacity === null
            ? 'Accepts multiple reference images.'
            : `Accepts up to ${capacity} reference image${capacity > 1 ? 's' : ''}; extra ones are skipped (scene references first).`;

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 p-3">
      <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-zinc-300 uppercase">
        References for every scene
        <span className="text-[10px] font-normal tracking-normal normal-case text-zinc-500">Characters · places · style</span>
      </h3>
      <ReferenceList
        ids={settings.reference_asset_ids || []}
        library={library}
        onChange={(ids) => onChange({ reference_asset_ids: ids })}
        onRequestSnapshot={onRequestSnapshot}
        onUploadFiles={onUploadFiles}
        emptyHint="Add your main character or setting here to keep them the same in every generated image."
      />
      <p className="text-[11px] leading-relaxed text-zinc-600">
        Each scene can add its own references too. Reference names are included in the prompt, so rename them in the library (e.g. "Maya")
        and write "Maya walks into the lab".
      </p>
      <div>
        <ImageModelControl settings={settings} onChange={onChange} refs />
        {capacityText && <p className={`mt-1 text-[11px] ${capacity === 0 || capacity === 'error' ? 'text-amber-400' : 'text-zinc-500'}`}>{capacityText}</p>}
      </div>
    </section>
  );
}
