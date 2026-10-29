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

async function postForAudio(path, body) {
  const res = await fetch(`${API}${path}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await errorMessage(res)}`);
  return Buffer.from(await res.arrayBuffer());
}

export function textToSpeech({ text, voiceId, modelId }) {
  return postForAudio(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, { text, model_id: modelId });
}

export function soundEffect({ text, durationSec }) {
  const duration = Math.min(30, Math.max(0.5, durationSec));
  return postForAudio('/v1/sound-generation', { text, duration_seconds: duration, prompt_influence: 0.3 });
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
