const API = 'https://api.elevenlabs.io';
const OUTPUT_FORMAT = 'mp3_44100_128';

function apiKey() {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw Object.assign(new Error('ELEVENLABS_API_KEY is not set. Add it to .env and restart.'), { status: 400 });
  return k;
}

async function errorMessage(res) {
  const text = await res.text();
  try {
    const { detail } = JSON.parse(text);
    return detail?.message || (typeof detail === 'string' ? detail : JSON.stringify(detail));
  } catch {
    return text || res.statusText;
  }
}

function post(path, body, accept) {
  return fetch(`${API}${path}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json', Accept: accept },
    body: JSON.stringify(body),
  });
}

/** The credits a request used ("character-cost" header), for the usage log. */
function usageOf(res) {
  const cost = res.headers.get('character-cost');
  return { credits: cost != null && cost !== '' && Number.isFinite(Number(cost)) ? Number(cost) : null, request_id: res.headers.get('request-id') };
}

async function postForAudio(path, body) {
  const res = await post(path, body, 'audio/mpeg');
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await errorMessage(res)}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), usage: usageOf(res) };
}

/**
 * Words with their start and end times (seconds) from an ElevenLabs character alignment:
 * [{ text, start, end }]. Audio tags like [whispers] aren't words.
 */
export function wordsFromAlignment(alignment) {
  const chars = alignment?.characters;
  if (!Array.isArray(chars) || !chars.length) return null;
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];
  let word = null;
  let inTag = false;
  chars.forEach((c, i) => {
    if (c === '[') inTag = true;
    if (inTag || /\s/.test(c)) {
      if (word) words.push(word);
      word = null;
      if (c === ']') inTag = false;
      return;
    }
    if (!word) word = { text: '', start: starts[i] ?? 0, end: ends[i] ?? 0 };
    word.text += c;
    word.end = ends[i] ?? word.end;
  });
  if (word) words.push(word);
  return words.map((w) => ({ text: w.text, start: Math.round(w.start * 100) / 100, end: Math.round(w.end * 100) / 100 }));
}

const VOICE_SETTINGS = ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'];
const isSet = (v) => v !== undefined && v !== null && v !== '';

/**
 * `params` are the user's voice settings (gear in the Project panel (left)). Unset ones are left out, so the
 * voice's own saved settings apply. `previousText` / `nextText` are the narration around this line,
 * which ElevenLabs uses to keep the delivery continuous. Resolves with { buffer, usage, words }, where
 * `words` are the spoken words with their times (null if ElevenLabs didn't give timings).
 */
export function textToSpeech({ text, voiceId, modelId, params = {}, previousText, nextText }) {
  const body = { text, model_id: modelId };
  if (previousText) body.previous_text = previousText;
  if (nextText) body.next_text = nextText;
  const voiceSettings = Object.fromEntries(VOICE_SETTINGS.filter((k) => isSet(params[k])).map((k) => [k, params[k]]));
  if (Object.keys(voiceSettings).length) body.voice_settings = voiceSettings;
  if (isSet(params.seed)) body.seed = params.seed;
  if (isSet(params.apply_text_normalization)) body.apply_text_normalization = params.apply_text_normalization;
  return speak(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, body);
}

/**
 * Speech with timings (so sound effects can be synced to words). If that endpoint refuses the request
 * (e.g. a model without timestamps), it falls back to plain speech without timings.
 */
async function speak(path, body) {
  const res = await post(`${path}/with-timestamps`, body, 'application/json');
  if (res.ok) {
    const data = await res.json();
    return { buffer: Buffer.from(data.audio_base64, 'base64'), usage: usageOf(res), words: wordsFromAlignment(data.alignment) };
  }
  // Authentication, quota and rate limits would fail the same way without timestamps.
  if ([401, 402, 429].includes(res.status) || res.status >= 500) throw new Error(`ElevenLabs ${res.status}: ${await errorMessage(res)}`);
  console.warn(`Speech with timestamps refused (${res.status}: ${await errorMessage(res)}); generating without timings.`);
  return { ...(await postForAudio(path, body)), words: null };
}

/** `params`: { prompt_influence, loop, auto_duration } (auto_duration lets the model pick the length). */
export function soundEffect({ text, durationSec, modelId, params = {} }) {
  const body = { text, prompt_influence: isSet(params.prompt_influence) ? params.prompt_influence : 0.3 };
  if (modelId) body.model_id = modelId;
  if (!params.auto_duration) body.duration_seconds = Math.min(30, Math.max(0.5, durationSec));
  if (isSet(params.loop)) body.loop = params.loop;
  return postForAudio('/v1/sound-generation', body);
}

/**
 * The account's credits this billing period: { tier, used, limit, remaining, resets_at }.
 * Needs the API key's "user_read" permission.
 */
export async function subscription() {
  const res = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': apiKey() } });
  if (!res.ok) throw new Error(await errorMessage(res));
  const s = await res.json();
  const used = s.character_count ?? null;
  const limit = s.character_limit ?? null;
  return {
    tier: s.tier ?? null,
    used,
    limit,
    remaining: used != null && limit != null ? Math.max(0, limit - used) : null,
    resets_at: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : null,
  };
}

/** The account's models: [{ model_id, name, description, tts }]. */
export async function listModels() {
  const res = await fetch(`${API}/v1/models`, { headers: { 'xi-api-key': apiKey() } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await errorMessage(res)}`);
  const models = await res.json();
  return models.map((m) => ({ model_id: m.model_id, name: m.name, description: m.description || '', tts: Boolean(m.can_do_text_to_speech) }));
}

export async function listVoices() {
  const res = await fetch(`${API}/v1/voices`, { headers: { 'xi-api-key': apiKey() } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await errorMessage(res)}`);
  const { voices } = await res.json();
  return voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    description: [v.labels?.accent, v.labels?.gender, v.labels?.age, v.labels?.description || v.labels?.descriptive]
      .filter(Boolean)
      .join(', '),
    preview_url: v.preview_url,
  }));
}
