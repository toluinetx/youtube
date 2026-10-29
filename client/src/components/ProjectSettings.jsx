import { useEffect, useRef, useState } from 'react';
import { Loader2, Music, Pause, Play, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { ACCEPT, formatTime } from '../util.js';
import ReferenceList from './ReferenceList.jsx';

const IMAGE_MODELS = [
  ['black-forest-labs/flux-schnell', 'FLUX.1 schnell (fast, cheap)'],
  ['black-forest-labs/flux-dev', 'FLUX.1 dev'],
  ['black-forest-labs/flux-1.1-pro', 'FLUX 1.1 pro'],
  ['black-forest-labs/flux-1.1-pro-ultra', 'FLUX 1.1 pro ultra'],
];

// Models that accept reference images (field names are detected from each model's schema).
const REFERENCE_MODELS = [
  ['google/nano-banana', 'Nano Banana (Gemini 2.5 Flash Image)'],
  ['google/nano-banana-pro', 'Nano Banana Pro (up to 14 refs)'],
  ['bytedance/seedream-4', 'Seedream 4'],
  ['black-forest-labs/flux-2-pro', 'FLUX.2 pro (up to 8 refs)'],
  ['black-forest-labs/flux-kontext-pro', 'FLUX Kontext pro (1 ref)'],
];

const TTS_MODELS = [
  ['eleven_v4', 'Eleven v4 (recommended, audio tags)'],
  ['eleven_v4_turbo', 'Eleven v4 Turbo (faster, audio tags)'],
  ['eleven_v3', 'Eleven v3 (audio tags)'],
  ['eleven_multilingual_v2', 'Multilingual v2 (no audio tags)'],
  ['eleven_turbo_v2_5', 'Turbo v2.5'],
  ['eleven_flash_v2_5', 'Flash v2.5 (fastest, cheapest)'],
];

export default function ProjectSettings({
  settings, onChange, status, musicBusy, onUploadMusic, onRemoveMusic, library, onRequestSnapshot, onUploadFiles,
}) {
  const [voices, setVoices] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const audio = useRef(null);
  const customModel = !IMAGE_MODELS.some(([id]) => id === settings.image_model);

  useEffect(() => {
    if (!status?.elevenlabs) return;
    api.voices().then(setVoices).catch((e) => setVoiceError(e.message));
  }, [status?.elevenlabs]);

  const voice = voices?.find((v) => v.voice_id === settings.voice_id);

  const togglePreview = () => {
    if (!voice?.preview_url) return;
    if (previewing) {
      audio.current?.pause();
      setPreviewing(false);
      return;
    }
    audio.current = new Audio(voice.preview_url);
    audio.current.onended = () => setPreviewing(false);
    audio.current.play();
    setPreviewing(true);
  };

  useEffect(() => () => audio.current?.pause(), []);

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

      <Group title="Images" subtitle="Replicate" ok={status?.replicate}>
        <Field label="Model (scenes without references)">
          <select
            className="field"
            value={customModel ? 'custom' : settings.image_model}
            onChange={(e) => onChange({ image_model: e.target.value === 'custom' ? '' : e.target.value })}
          >
            {IMAGE_MODELS.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
            <option value="custom">Custom model…</option>
          </select>
          {customModel && (
            <input
              className="field mt-2 font-mono text-xs"
              placeholder="owner/model or owner/model:version"
              value={settings.image_model}
              onChange={(e) => onChange({ image_model: e.target.value.trim() })}
            />
          )}
        </Field>
        <Field label="Style (appended to every image prompt)">
          <textarea
            rows={2}
            className="field resize-y"
            value={settings.style_prompt}
            placeholder="e.g. watercolor illustration, soft pastel palette"
            onChange={(e) => onChange({ style_prompt: e.target.value })}
          />
        </Field>
        <Field label="Camera motion">
          <select className="field" value={settings.motion} onChange={(e) => onChange({ motion: e.target.value })}>
            <option value="kenburns">Slow zoom (Ken Burns)</option>
            <option value="none">Static</option>
          </select>
        </Field>
      </Group>

      <ReferenceSettings
        settings={settings}
        onChange={onChange}
        status={status}
        library={library}
        onRequestSnapshot={onRequestSnapshot}
        onUploadFiles={onUploadFiles}
      />

      <Group title="Voice & sound" subtitle="ElevenLabs" ok={status?.elevenlabs}>
        <Field label="Voice">
          {voices ? (
            <div className="flex gap-2">
              <select className="field" value={settings.voice_id} onChange={(e) => onChange({ voice_id: e.target.value })}>
                {!voice && <option value={settings.voice_id}>{settings.voice_id}</option>}
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}{v.description ? ` (${v.description})` : ''}
                  </option>
                ))}
              </select>
              <button className="icon-btn shrink-0 border border-zinc-800" title="Preview voice" disabled={!voice?.preview_url} onClick={togglePreview}>
                {previewing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
            </div>
          ) : (
            <>
              <input
                className="field font-mono text-xs"
                value={settings.voice_id}
                onChange={(e) => onChange({ voice_id: e.target.value.trim() })}
                placeholder="ElevenLabs voice ID"
              />
              <p className="mt-1 text-[11px] text-zinc-600">
                {voiceError ? `Couldn't load voices: ${voiceError}` : status?.elevenlabs ? 'Loading voices…' : 'Add ELEVENLABS_API_KEY to pick from your voices.'}
              </p>
            </>
          )}
        </Field>
        <Field label="Speech model">
          <select className="field" value={settings.tts_model} onChange={(e) => onChange({ tts_model: e.target.value })}>
            {TTS_MODELS.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
            {!TTS_MODELS.some(([id]) => id === settings.tts_model) && <option value={settings.tts_model}>{settings.tts_model}</option>}
          </select>
        </Field>
        <Field label={`Sound effect volume: ${Math.round(settings.sfx_volume * 100)}%`}>
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

      <MusicSettings settings={settings} onChange={onChange} busy={musicBusy} onUpload={onUploadMusic} onRemove={onRemoveMusic} />
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

function MusicSettings({ settings, onChange, busy, onUpload, onRemove }) {
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
  const custom = !REFERENCE_MODELS.some(([id]) => id === model);

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
      <Field label="Model when references are used">
        <select
          className="field"
          value={custom ? 'custom' : model}
          onChange={(e) => onChange({ reference_model: e.target.value === 'custom' ? '' : e.target.value })}
        >
          {REFERENCE_MODELS.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
          <option value="custom">Custom model…</option>
        </select>
        {custom && (
          <input
            className="field mt-2 font-mono text-xs"
            placeholder="owner/model or owner/model:version"
            value={model}
            onChange={(e) => onChange({ reference_model: e.target.value.trim() })}
          />
        )}
        {capacityText && <p className={`mt-1 text-[11px] ${capacity === 0 || capacity === 'error' ? 'text-amber-400' : 'text-zinc-500'}`}>{capacityText}</p>}
      </Field>
    </section>
  );
}
