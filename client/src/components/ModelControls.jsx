import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import Picker from './Picker.jsx';
import ParamsPanel, { GearButton, countSet } from './ParamsPanel.jsx';

// Model, voice and settings pickers, shared by the Project panel and the scene sidebar. They all edit
// project settings: picking a model next to a scene's Generate button changes it for every scene.

// [id, name, note]. Listed first; Replicate's collections add more models to search.
const IMAGE_MODELS = [
  ['black-forest-labs/flux-schnell', 'FLUX.1 schnell', 'fast, cheap'],
  ['black-forest-labs/flux-dev', 'FLUX.1 dev'],
  ['black-forest-labs/flux-1.1-pro', 'FLUX 1.1 pro'],
  ['black-forest-labs/flux-1.1-pro-ultra', 'FLUX 1.1 pro ultra'],
];

// Models that accept reference images (field names are detected from each model's schema).
const REFERENCE_MODELS = [
  ['google/nano-banana', 'Nano Banana', 'Gemini 2.5 Flash Image'],
  ['google/nano-banana-pro', 'Nano Banana Pro', 'up to 14 refs'],
  ['bytedance/seedream-4', 'Seedream 4'],
  ['black-forest-labs/flux-2-pro', 'FLUX.2 pro', 'up to 8 refs'],
  ['black-forest-labs/flux-kontext-pro', 'FLUX Kontext pro', '1 ref'],
];

// Google's Gemini API ("gemini:" ids). The API key's own model list adds any others.
const GEMINI_IMAGE_MODELS = [
  ['gemini:gemini-3.1-flash-image', 'Nano Banana 2', 'up to 14 refs'],
  ['gemini:gemini-3-pro-image', 'Nano Banana Pro', 'up to 14 refs'],
  ['gemini:gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', 'fastest'],
  ['gemini:gemini-2.5-flash-image', 'Nano Banana', 'up to 3 refs'],
];

const VIDEO_MODELS = [['gemini:gemini-omni-1.1-flash', 'Gemini Omni Flash', '3–10 s clips with sound, ~$0.10/s at 720p']];

const TTS_MODELS = [
  ['eleven_v4', 'Eleven v4', 'recommended, audio tags'],
  ['eleven_v4_turbo', 'Eleven v4 Turbo', 'faster, audio tags'],
  ['eleven_v3', 'Eleven v3', 'audio tags'],
  ['eleven_multilingual_v2', 'Multilingual v2', 'no audio tags'],
  ['eleven_turbo_v2_5', 'Turbo v2.5'],
  ['eleven_flash_v2_5', 'Flash v2.5', 'fastest, cheapest'],
];

const SFX_MODELS = [['eleven_text_to_sound_v2', 'Sound Effects v2', 'latest, can loop']];

// The ElevenLabs voice settings. Defaults are ElevenLabs' usual ones; settings left alone aren't
// sent, so each voice keeps its own saved settings.
const TTS_PARAMS = [
  { name: 'stability', type: 'number', title: 'Stability', minimum: 0, maximum: 1, step: 0.05, default: 0.5,
    description: 'Lower is more expressive and varied, higher is steadier. Eleven v3/v4: 0 = Creative, 0.5 = Natural, 1 = Robust.' },
  { name: 'similarity_boost', type: 'number', title: 'Similarity', minimum: 0, maximum: 1, step: 0.05, default: 0.75,
    description: 'How closely the speech sticks to the original voice.' },
  { name: 'style', type: 'number', title: 'Style exaggeration', minimum: 0, maximum: 1, step: 0.05, default: 0,
    description: "Amplifies the speaker's style. Higher values can make speech less stable." },
  { name: 'speed', type: 'number', title: 'Speed', minimum: 0.7, maximum: 1.2, step: 0.05, default: 1, description: '1 is normal speed.' },
  { name: 'use_speaker_boost', type: 'boolean', title: 'Speaker boost', default: true,
    description: 'Boosts similarity to the original speaker. Slightly slower.' },
  { name: 'seed', type: 'integer', title: 'Seed', minimum: 0, maximum: 4294967295,
    description: 'The same seed and text give (mostly) the same take. Leave empty for a fresh take each time.' },
];

const SFX_PARAMS = [
  { name: 'prompt_influence', type: 'number', title: 'Prompt influence', minimum: 0, maximum: 1, step: 0.05, default: 0.3,
    description: 'Higher follows the prompt more literally; lower is more creative.' },
  { name: 'auto_duration', type: 'boolean', title: 'Let the model choose the length', default: false,
    description: "Off: the sound effect matches the scene's length (up to 30 s)." },
  { name: 'loop', type: 'boolean', title: 'Seamless loop', default: false, description: 'Makes the sound effect loop smoothly (Sound Effects v2).' },
];

const REPLICATE_ID = /^[\w.-]+\/[\w.-]+(:\w+)?$/;
const GEMINI_ID = /^gemini:[\w.-]+$/;
const COMFY_ID = /^comfyui:[\w.-]+$/;
const isImageModelId = (q) => REPLICATE_ID.test(q) || GEMINI_ID.test(q) || COMFY_ID.test(q);
const isGeminiId = (q) => GEMINI_ID.test(q);
const isElevenLabsId = (q) => /^[\w-]+$/.test(q);

const curatedOptions = (list, provider) => list.map(([id, label, note]) => ({ id, label, sub: note ? `${note} · ${id}` : id, badge: provider, provider }));

/** Models from the Gemini API key's list that aren't in `curated`. */
const extraGemini = (curated, fetched) => {
  const known = new Set(curated.map(([id]) => id));
  return (fetched || [])
    .filter((m) => !known.has(m.id))
    .map((m) => ({ ...m, sub: `${m.sub ? `${m.sub} · ` : ''}${m.id}`, badge: 'Gemini', provider: 'Gemini' }));
};

function runs(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M runs`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k runs`;
  return n ? `${n} runs` : '';
}

/**
 * Curated Replicate and Gemini models first, then the rest of Gemini's, then local ComfyUI workflows
 * (for `refs`, those that take reference images; otherwise the others), then Replicate's collections
 * (those in `prefer` first).
 */
function imageModelOptions(curated, catalog, prefer, refs) {
  const known = new Set(curated.map(([id]) => id));
  const rest = (catalog.models || []).filter((m) => !known.has(m.id));
  const ranked = [...rest.filter((m) => m.collections.includes(prefer)), ...rest.filter((m) => !m.collections.includes(prefer))];
  return [
    ...curatedOptions(curated, 'Replicate'),
    ...curatedOptions(GEMINI_IMAGE_MODELS, 'Gemini'),
    ...extraGemini(GEMINI_IMAGE_MODELS, catalog.gemini?.image),
    ...(catalog.comfy || []).filter((m) => (m.references !== 0) === refs).map((m) => ({ ...m, sub: `${m.sub ? `${m.sub} · ` : ''}${m.id}`, badge: 'Local', provider: 'ComfyUI' })),
    ...ranked.map((m) => ({ id: m.id, label: m.id, sub: m.description, badge: runs(m.run_count), provider: 'Replicate' })),
  ];
}

// ---- Shared data: model lists, voices, stars, voice previews --------------------------------------

const Catalog = createContext(null);

/** Loads the model lists, voices and stars once for every picker below it. */
export function ModelCatalogProvider({ status, onError, children }) {
  const [catalog, setCatalog] = useState({});
  const [voices, setVoices] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const [elevenModels, setElevenModels] = useState(null);
  const [starred, setStarred] = useState({});
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);

  useEffect(() => {
    api.preferences().then((p) => setStarred(p.starred)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!status?.replicate) return;
    api.imageModels().then((models) => setCatalog((c) => ({ ...c, models }))).catch((e) => setCatalog((c) => ({ ...c, error: e.message })));
  }, [status?.replicate]);

  useEffect(() => {
    if (!status?.gemini) return;
    api.geminiModels().then((gemini) => setCatalog((c) => ({ ...c, gemini }))).catch(() => {});
  }, [status?.gemini]);

  useEffect(() => {
    if (status?.comfyui == null) return;
    api.comfyModels().then((comfy) => setCatalog((c) => ({ ...c, comfy }))).catch(() => {});
  }, [status?.comfyui]);

  useEffect(() => {
    if (!status?.elevenlabs) return;
    api.voices().then(setVoices).catch((e) => setVoiceError(e.message));
    api.elevenlabsModels().then(setElevenModels).catch(() => {});
  }, [status?.elevenlabs]);

  const star = useCallback(
    (list) => (id, on) => {
      setStarred((s) => {
        const others = (s[list] || []).filter((x) => x !== id);
        return { ...s, [list]: on ? [...others, id] : others };
      });
      api.setStarred(list, id, on).then((p) => setStarred(p.starred)).catch((e) => onError?.(`Couldn't save the star: ${e.message}`));
    },
    [onError],
  );

  const togglePreview = useCallback(
    (voiceId, url) => {
      audio.current?.pause();
      if (!url || playing === voiceId) return setPlaying(null);
      audio.current = new Audio(url);
      audio.current.onended = () => setPlaying(null);
      audio.current.play();
      setPlaying(voiceId);
    },
    [playing],
  );

  useEffect(() => () => audio.current?.pause(), []);

  const value = { status, catalog, voices, voiceError, elevenModels, starred, star, playing, togglePreview };
  return <Catalog.Provider value={value}>{children}</Catalog.Provider>;
}

const useCatalog = () => useContext(Catalog);

// ---- Settings loaded from the server --------------------------------------------------------------

const paramCache = new Map();

/** An image / video model's settings, loaded once `active` (its gear is open). */
function useModelParams(model, active) {
  const [state, setState] = useState({});
  useEffect(() => {
    if (!active || !isImageModelId(model || '')) return setState({});
    if (paramCache.has(model)) return setState({ params: paramCache.get(model) });
    let live = true;
    setState({ loading: true });
    api
      .modelParams(model)
      .then((r) => {
        paramCache.set(model, r.params);
        if (live) setState({ params: r.params });
      })
      .catch((e) => live && setState({ error: `Couldn't load this model's settings: ${e.message}` }));
    return () => {
      live = false;
    };
  }, [model, active]);
  return state;
}

// ---- Building blocks ------------------------------------------------------------------------------

function Row({ label, hint, children }) {
  return (
    <div>
      {label && (
        <span className="label flex items-center justify-between">
          {label}
          {hint && <span className="text-[10px] font-normal text-zinc-600">{hint}</span>}
        </span>
      )}
      {children}
    </div>
  );
}

/** A picker with a gear on its right that opens the chosen model's settings below. */
function ModelRow({ label, hint, picker, params, values, onValues, loading, error, note }) {
  const [open, setOpen] = useState(false);
  return (
    <Row label={label} hint={hint}>
      <div className="flex gap-2">
        {picker}
        <GearButton open={open} count={countSet(values)} onClick={() => setOpen((o) => !o)} title="Model settings" />
      </div>
      {open && <ParamsPanel params={params} values={values} onChange={onValues} loading={loading} error={error} note={note} />}
    </Row>
  );
}

/** Settings saved per model in settings[key][model] (image_params, video_params). */
function usePerModelParams(settings, onChange, key, model) {
  const values = settings[key]?.[model] || {};
  const setValues = (v) => {
    const { [model]: _, ...rest } = settings[key] || {};
    onChange({ [key]: countSet(v) ? { ...rest, [model]: v } : rest });
  };
  return [values, setValues];
}

function ServerModelRow({ label, hint, model, onModel, options, starList, settings, onChange, paramsKey, custom, status, note, placeholder }) {
  const { starred, star } = useCatalog();
  const [gearOpen, setGearOpen] = useState(false);
  const { params, loading, error } = useModelParams(model, gearOpen);
  const [values, setValues] = usePerModelParams(settings, onChange, paramsKey, model);
  return (
    <Row label={label} hint={hint}>
      <div className="flex gap-2">
        <Picker
          value={model}
          options={options}
          onChange={onModel}
          starred={starred[starList]}
          onStar={star(starList)}
          custom={custom}
          placeholder={placeholder}
          status={status}
          ariaLabel={label}
          groupBy="provider"
        />
        <GearButton open={gearOpen} count={countSet(values)} onClick={() => setGearOpen((o) => !o)} title="Model settings" />
      </div>
      {gearOpen && <ParamsPanel params={params} values={values} onChange={setValues} loading={loading} error={error} note={note} />}
    </Row>
  );
}

// ---- The controls ---------------------------------------------------------------------------------

/** Image model: `refs` picks the model used when a scene has reference images. */
export function ImageModelControl({ settings, onChange, refs = false, label, hint }) {
  const { catalog } = useCatalog();
  const key = refs ? 'reference_model' : 'image_model';
  const options = imageModelOptions(refs ? REFERENCE_MODELS : IMAGE_MODELS, catalog, refs ? 'image-editing' : 'text-to-image', refs);
  const status = catalog.error
    ? `Couldn't load more models from Replicate (${catalog.error}). Type owner/model or gemini:model to use any model.`
    : catalog.models
      ? `${options.length} models. Type owner/model (Replicate) or gemini:model to use any other.`
      : 'Loading more models from Replicate…';
  return (
    <ServerModelRow
      label={label ?? (refs ? 'Model when references are used' : 'Model (scenes without references)')}
      hint={hint}
      model={settings[key]}
      onModel={(id) => onChange({ [key]: id })}
      options={options}
      starList="image_model"
      settings={settings}
      onChange={onChange}
      paramsKey="image_params"
      custom={isImageModelId}
      status={status}
      placeholder="Search models, or type owner/model"
      note="Saved for this model. The prompt, format and reference images are filled in for you."
    />
  );
}

export function VideoModelControl({ settings, onChange, label = 'Video model', hint }) {
  const { catalog } = useCatalog();
  return (
    <ServerModelRow
      label={label}
      hint={hint}
      model={settings.video_model}
      onModel={(id) => onChange({ video_model: id })}
      options={[...curatedOptions(VIDEO_MODELS, 'Gemini'), ...extraGemini(VIDEO_MODELS, catalog.gemini?.video)]}
      starList="video_model"
      settings={settings}
      onChange={onChange}
      paramsKey="video_params"
      custom={isGeminiId}
      status="Type gemini:model to use another Gemini video model."
      placeholder="Search video models"
      note="Saved for this model. Uses the scene's image prompt; its image (if any) becomes the first frame."
    />
  );
}

export function VoiceModelControl({ settings, onChange, label = 'Voice model', hint }) {
  const { elevenModels, starred, star } = useCatalog();
  const known = new Set(TTS_MODELS.map(([id]) => id));
  const options = [
    ...curatedOptions(TTS_MODELS),
    ...(elevenModels || []).filter((m) => m.tts && !known.has(m.model_id)).map((m) => ({ id: m.model_id, label: m.name, sub: m.model_id })),
  ];
  return (
    <ModelRow
      label={label}
      hint={hint}
      picker={
        <Picker
          value={settings.tts_model}
          options={options}
          onChange={(id) => onChange({ tts_model: id })}
          starred={starred.tts_model}
          onStar={star('tts_model')}
          custom={isElevenLabsId}
          placeholder="Search voice models"
          ariaLabel={label}
        />
      }
      params={TTS_PARAMS}
      values={settings.tts_params}
      onValues={(v) => onChange({ tts_params: v })}
      note="Settings you leave alone use the voice's own saved settings."
    />
  );
}

export function VoiceControl({ settings, onChange, label = 'Voice', hint }) {
  const { status, voices, voiceError, starred, star, playing, togglePreview } = useCatalog();
  const voice = voices?.find((v) => v.voice_id === settings.voice_id);
  if (!voices) {
    return (
      <Row label={label} hint={hint}>
        <input
          className="field font-mono text-xs"
          value={settings.voice_id}
          onChange={(e) => onChange({ voice_id: e.target.value.trim() })}
          placeholder="ElevenLabs voice ID"
        />
        <p className="mt-1 text-[11px] text-zinc-600">
          {voiceError ? `Couldn't load voices: ${voiceError}` : status?.elevenlabs ? 'Loading voices…' : 'Add ELEVENLABS_API_KEY to pick from your voices.'}
        </p>
      </Row>
    );
  }
  const options = voices.map((v) => ({
    id: v.voice_id,
    label: v.name,
    sub: [v.description, v.category].filter(Boolean).join(' · '),
    preview_url: v.preview_url,
  }));
  const previewButton = (o) =>
    o.preview_url && (
      <button
        type="button"
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-500 hover:text-zinc-100"
        title="Preview voice"
        aria-label={`Preview ${o.label}`}
        onClick={() => togglePreview(o.id, o.preview_url)}
      >
        {playing === o.id ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
    );
  return (
    <Row label={label} hint={hint}>
      <div className="flex gap-2">
        <Picker
          value={settings.voice_id}
          options={options}
          onChange={(id) => onChange({ voice_id: id })}
          starred={starred.voice}
          onStar={star('voice')}
          custom={isElevenLabsId}
          extra={previewButton}
          placeholder="Search voices by name, accent, style…"
          status={`${options.length} voices in your ElevenLabs account. Paste a voice ID to use another.`}
          ariaLabel={label}
        />
        <button
          className="icon-btn shrink-0 border border-zinc-800"
          title="Preview voice"
          disabled={!voice?.preview_url}
          onClick={() => togglePreview(voice.voice_id, voice.preview_url)}
        >
          {voice && playing === voice.voice_id ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
      </div>
    </Row>
  );
}

/**
 * More voices for the narration, by speaker (settings.voices). A voiceover's "{Eli}" starts a part in
 * Eli's voice, "{Narrator}" goes back to the voice above.
 */
export function SpeakersControl({ settings, onChange }) {
  const { voices, starred, star } = useCatalog();
  const speakers = settings.voices || [];
  const options = (voices || []).map((v) => ({ id: v.voice_id, label: v.name, sub: [v.description, v.category].filter(Boolean).join(' · ') }));
  const set = (i, patch) => onChange({ voices: speakers.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const remove = (i) => onChange({ voices: speakers.filter((_, k) => k !== i) });
  const add = () => onChange({ voices: [...speakers, { name: `Speaker ${speakers.length + 1}`, voice_id: settings.voice_id }] });
  return (
    <Row label="Speakers" hint="for dialogue">
      <div className="space-y-1.5">
        {speakers.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="field !w-28 shrink-0"
              value={s.name}
              onChange={(e) => set(i, { name: e.target.value.replace(/[{}]/g, '') })}
              aria-label={`Speaker ${i + 1} name`}
              placeholder="Name"
            />
            {voices ? (
              <Picker
                value={s.voice_id}
                options={options}
                onChange={(id) => set(i, { voice_id: id })}
                starred={starred.voice}
                onStar={star('voice')}
                custom={isElevenLabsId}
                placeholder="Search voices, or paste a voice ID"
                ariaLabel={`${s.name} voice`}
              />
            ) : (
              <input
                className="field font-mono text-xs"
                value={s.voice_id}
                onChange={(e) => set(i, { voice_id: e.target.value.trim() })}
                placeholder="ElevenLabs voice ID"
                aria-label={`${s.name} voice ID`}
              />
            )}
            <button type="button" className="icon-btn shrink-0 border border-zinc-800" title={`Remove ${s.name}`} onClick={() => remove(i)}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <button type="button" className="btn-ghost w-full text-xs" onClick={add}>
          <Plus className="size-3.5" /> Add a speaker
        </button>
        <p className="text-[11px] text-zinc-600">
          In a voiceover, <span className="font-mono text-zinc-400">{'{Name}'}</span> starts a part in that speaker&apos;s voice and{' '}
          <span className="font-mono text-zinc-400">{'{Narrator}'}</span> goes back to the voice above. The labels aren&apos;t spoken.
        </p>
      </div>
    </Row>
  );
}

export function SfxModelControl({ settings, onChange, label = 'Sound effect model', hint }) {
  const { elevenModels, starred, star } = useCatalog();
  const known = new Set(SFX_MODELS.map(([id]) => id));
  const options = [
    ...curatedOptions(SFX_MODELS),
    ...(elevenModels || [])
      .filter((m) => !m.tts && /sound|sfx/i.test(m.model_id) && !known.has(m.model_id))
      .map((m) => ({ id: m.model_id, label: m.name, sub: m.model_id })),
  ];
  return (
    <ModelRow
      label={label}
      hint={hint}
      picker={
        <Picker
          value={settings.sfx_model}
          options={options}
          onChange={(id) => onChange({ sfx_model: id })}
          starred={starred.sfx_model}
          onStar={star('sfx_model')}
          custom={isElevenLabsId}
          placeholder="Search, or type a model ID"
          ariaLabel={label}
        />
      }
      params={SFX_PARAMS}
      values={settings.sfx_params}
      onValues={(v) => onChange({ sfx_params: v })}
      note="Used for every sound effect in this project."
    />
  );
}
