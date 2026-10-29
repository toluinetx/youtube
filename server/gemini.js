// Google's Gemini API: Gemini image models ("Nano Banana") and Gemini Omni (video).
// Their model ids are stored with a "gemini:" prefix (e.g. "gemini:gemini-3.1-flash-image") so they
// can sit in the same model settings as Replicate's "owner/name" ids.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const PREFIX = 'gemini:';
const VIDEO_TIMEOUT_MS = 10 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const isGeminiModel = (id) => typeof id === 'string' && id.startsWith(PREFIX);
const bare = (id) => (isGeminiModel(id) ? id.slice(PREFIX.length) : id);

/** Video models (Gemini Omni; Veo was shut down in the Gemini API in October 2026). */
const isVideoModel = (model) => /omni|veo/.test(bare(model));

function apiKey() {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!k) throw Object.assign(new Error('GEMINI_API_KEY is not set. Add it to .env and restart.'), { status: 400 });
  return k;
}

async function call(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': apiKey(), ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || res.statusText}`);
  return data;
}

const isSet = (v) => v !== undefined && v !== null && v !== '';
const pick = (params, names) => Object.fromEntries(names.filter((n) => isSet(params[n])).map((n) => [n, params[n]]));

function splitDataUri(uri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(uri);
  if (!m) throw new Error('Images must be data URIs');
  return { mimeType: m[1], data: m[2] };
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** The first Nano Banana (Gemini 2.5 Flash Image) takes fewer references than later ones and has no image size. */
const isNanoBanana1 = (id) => id.startsWith('gemini-2.5') || id.startsWith('gemini-2.0');

// ---- Settings (gear next to the model) ------------------------------------------------------------

/** The settings a Gemini model offers, in the same shape as Replicate's (see modelParams in replicate.js). */
export function geminiParams(model) {
  if (isVideoModel(model)) {
    return [
      {
        name: 'resolution', type: 'enum', title: 'Resolution', enum: ['360p', '720p', '1080p', '4k'], default: '720p',
        description: '1080p and 4K are upscaled from 720p and take longer.',
      },
      {
        name: 'duration_hint', type: 'integer', title: 'Clip length (s, approx.)', minimum: 3, maximum: 10,
        description: 'Omni has no length setting, so this is added to the prompt as a hint. Clips are 3–10 s.',
      },
      { name: 'seed', type: 'integer', title: 'Seed', description: 'Set for more repeatable results.' },
    ];
  }
  return [
    ...(!isNanoBanana1(bare(model)) ? [{ name: 'imageSize', type: 'enum', title: 'Image size', enum: ['1K', '2K', '4K'], default: '1K', description: 'Output resolution.' }] : []),
    { name: 'temperature', type: 'number', title: 'Temperature', minimum: 0, maximum: 2, default: 1, description: 'Higher is more varied, lower is more predictable.' },
    { name: 'seed', type: 'integer', title: 'Seed', description: 'Set for more repeatable results.' },
  ];
}

/** Reference images a model accepts: 3 for the first Nano Banana, 14 for later ones, 0 for video models. */
export function geminiReferenceCapacity(model) {
  if (isVideoModel(model)) return 0;
  return isNanoBanana1(bare(model)) ? 3 : 14;
}

// ---- Images ---------------------------------------------------------------------------------------

/** Same contract as replicate.generateImage: resolves with { buffer, ext, usage }. */
export async function generateGeminiImage({ prompt, model, aspectRatio, references = [], referenceLabels = [], params = {} }) {
  const id = bare(model);
  if (isVideoModel(model)) throw Object.assign(new Error(`${id} makes videos, not images. Pick an image model.`), { status: 400 });

  // Each reference is labelled right before its image, then the instructions follow.
  const parts = [
    ...references.flatMap((uri, i) => [
      { text: `Reference image ${i + 1}${referenceLabels[i] ? `: ${referenceLabels[i]}` : ''}` },
      { inlineData: splitDataUri(uri) },
    ]),
    { text: prompt },
  ];
  const data = await call(`models/${id}:generateContent`, {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio, ...pick(params, ['imageSize']) },
      ...pick(params, ['temperature', 'seed']),
    },
  });
  const candidate = data.candidates?.[0];
  const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!image) {
    const said = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ');
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason;
    throw new Error(`Gemini returned no image${reason ? ` (${reason})` : ''}${said ? `: ${said.slice(0, 200)}` : ''}`);
  }
  return { buffer: Buffer.from(image.data, 'base64'), ext: EXT[image.mimeType] || 'png', usage: imageUsage(data.usageMetadata) };
}

/** Billable tokens from a generateContent response: input, text (incl. thinking) and image output. */
function imageUsage(meta = {}) {
  const byModality = Object.fromEntries((meta.candidatesTokensDetails || []).map((d) => [d.modality, d.tokenCount || 0]));
  const known = 'IMAGE' in byModality || 'TEXT' in byModality;
  return {
    input_tokens: meta.promptTokenCount ?? 0,
    // Without a breakdown, the output of an image model is counted as image tokens.
    image_output_tokens: known ? byModality.IMAGE || 0 : meta.candidatesTokenCount ?? 0,
    text_output_tokens: (known ? byModality.TEXT || 0 : 0) + (meta.thoughtsTokenCount ?? 0),
  };
}

// ---- Video (Interactions API) ---------------------------------------------------------------------

const DONE = new Set(['completed', 'failed', 'cancelled', 'incomplete', 'requires_action', 'requires_continuation']);

/** The first video item anywhere in an interaction (it sits in a model_output step's content). */
function findVideo(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'video' && (node.data || node.uri)) return node;
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findVideo(value);
    if (found) return found;
  }
  return null;
}

async function downloadVideo(uri) {
  // Files API ids ("files/abc" or a URL ending in it) download through files/{id}:download.
  const file = /files\/([\w-]+)/.exec(uri)?.[1];
  const url = file ? `${API}/files/${file}:download?alt=media` : uri;
  const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey() }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download the generated video (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate a clip with Gemini Omni. `image` (a data URI) becomes the first frame when given.
 * Runs in the background and is polled until done. Resolves with { buffer, usage } (the MP4 bytes,
 * and the interaction's token counts when it reports them).
 */
export async function generateGeminiVideo({ prompt, model, aspectRatio, image, params = {} }) {
  const id = bare(model);
  if (!isVideoModel(model)) throw Object.assign(new Error(`${id} isn't a video model. Pick one in the Project panel (left).`), { status: 400 });

  const text = isSet(params.duration_hint) ? `${prompt}. Duration: about ${params.duration_hint} seconds.` : prompt;
  const input = [];
  if (image) {
    const { mimeType, data } = splitDataUri(image);
    input.push({ type: 'image', data, mime_type: mimeType });
  }
  input.push({ type: 'text', text });

  let interaction = await call('interactions', {
    model: id,
    input,
    // Omni makes landscape or portrait clips only; square projects crop the landscape one.
    response_format: { type: 'video', aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9', ...pick(params, ['resolution']) },
    generation_config: { video_config: { task: image ? 'image_to_video' : 'text_to_video' }, ...pick(params, ['seed']) },
    background: true,
    store: true,
  });

  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  while (!DONE.has(interaction.status)) {
    if (Date.now() > deadline) throw new Error('Video generation took more than 10 minutes. Try again later.');
    await sleep(5000);
    interaction = await call(`interactions/${interaction.id}`);
  }
  if (interaction.status !== 'completed') {
    throw new Error(`Gemini video ${interaction.status}${interaction.error?.message ? `: ${interaction.error.message}` : ''}`);
  }

  const video = findVideo(interaction.steps ?? interaction);
  if (!video) throw new Error('Gemini returned no video (the prompt or image may have been filtered)');
  const buffer = video.data ? Buffer.from(video.data, 'base64') : await downloadVideo(video.uri);
  return { buffer, usage: interactionUsage(interaction) };
}

/** Token counts from an interaction's `usage`, whichever names it uses; null where it doesn't say. */
function interactionUsage(interaction) {
  const u = interaction.usage || {};
  const first = (...keys) => keys.map((k) => u[k]).find((v) => typeof v === 'number') ?? null;
  return {
    interaction_id: interaction.id,
    input_tokens: first('total_input_tokens', 'input_tokens', 'prompt_tokens', 'total_prompt_tokens'),
    video_output_tokens: first('total_output_tokens', 'output_tokens', 'total_candidates_tokens', 'candidates_tokens'),
    reported: u,
  };
}

/** Output tokens Google bills per second of 720p Omni video (ai.google.dev pricing), when usage isn't reported. */
export const OMNI_TOKENS_PER_SECOND = 5792;

// ---- Model list -----------------------------------------------------------------------------------

const MODELS_TTL_MS = 60 * 60_000;
let modelsCache = null;

/**
 * Image and video models this API key lists: { image: [{ id, label, sub }], video: [...] }.
 * Some usable models aren't listed, so the editor also offers a built-in list.
 */
export async function listGeminiModels() {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
  const all = [];
  let page = '';
  do {
    const data = await call(`models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    all.push(...(data.models || []));
    page = data.nextPageToken;
  } while (page);

  const entry = (m) => ({ id: PREFIX + m.name.replace(/^models\//, ''), label: m.displayName || m.name, sub: m.description || '' });
  const methods = (m) => m.supportedGenerationMethods || [];
  const name = (m) => m.name.replace(/^models\//, '');
  const models = {
    image: all.filter((m) => /image|nano-banana/.test(name(m)) && !/embed/.test(name(m)) && methods(m).includes('generateContent')).map(entry),
    // The preview Omni model was shut down when 1.1 came out, so only stable ones are listed.
    video: all.filter((m) => /omni/.test(name(m)) && !/preview/.test(name(m))).map(entry),
  };
  modelsCache = { at: Date.now(), models };
  return models;
}
