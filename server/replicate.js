const API = 'https://api.replicate.com/v1';
const TIMEOUT_MS = 5 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw Object.assign(new Error('REPLICATE_API_TOKEN is not set. Add it to .env and restart.'), { status: 400 });
  return t;
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${data.detail || data.title || res.statusText}`);
  return data;
}

// ---- Model input schemas ------------------------------------------------------------------------
// Models name their inputs differently (image_input vs input_images vs input_image, which aspect
// ratios they allow, ...), so we read each model's OpenAPI schema and build inputs to match it.

const schemaCache = new Map();

async function inputSchema(model) {
  if (schemaCache.has(model)) return schemaCache.get(model);
  const [name, version] = model.split(':');
  const url = version ? `${API}/models/${name}/versions/${version}` : `${API}/models/${name}`;
  const data = await readJson(await fetch(url, { headers: { Authorization: `Bearer ${token()}` } }));
  const openapi = version ? data.openapi_schema : data.latest_version?.openapi_schema;
  const schemas = openapi?.components?.schemas || {};
  const input = schemas.Input;
  if (!input?.properties) throw new Error(`Couldn't read the input schema for ${model}`);
  // Enums are usually behind allOf: [{ $ref: '#/components/schemas/aspect_ratio' }]; inline them.
  const properties = Object.fromEntries(
    Object.entries(input.properties).map(([key, prop]) => {
      const ref = prop.allOf?.[0]?.$ref || prop.$ref;
      const target = ref ? schemas[ref.split('/').pop()] : null;
      return [key, { ...target, ...prop }];
    }),
  );
  const schema = { properties };
  schemaCache.set(model, schema);
  return schema;
}

const REF_ARRAY_FIELDS = ['image_input', 'input_images', 'reference_images', 'images', 'image_inputs'];
const REF_SINGLE_FIELDS = ['input_image', 'image', 'reference_image', 'image_prompt'];

/** Where a model takes reference images: { name, multi, max } or null if it doesn't. */
export function referenceField({ properties }) {
  for (const name of REF_ARRAY_FIELDS) {
    if (properties[name]?.type === 'array') return { name, multi: true, max: properties[name].maxItems ?? null };
  }
  for (const name of REF_SINGLE_FIELDS) if (properties[name]) return { name, multi: false, max: 1 };
  // Anything else that looks like an image URI input.
  for (const [name, p] of Object.entries(properties)) {
    if (!/image/i.test(name)) continue;
    if (p.type === 'array' && p.items?.format === 'uri') return { name, multi: true, max: p.maxItems ?? null };
    if (p.format === 'uri') return { name, multi: false, max: 1 };
  }
  return null;
}

/** Number of reference images a model accepts (0 = none), or null if unknown/unlimited. */
export async function referenceCapacity(model) {
  const field = referenceField(await inputSchema(model));
  return field ? field.max : 0;
}

/** Inputs the editor fills in itself (prompt, format, references), so they aren't offered as settings. */
function isManagedInput(schema, name) {
  if (name === 'prompt' || name === 'aspect_ratio') return true;
  if (name === referenceField(schema)?.name) return true;
  const p = schema.properties[name];
  // Other image / file inputs (masks, control images, …) need a file, not a setting.
  return p.format === 'uri' || (p.type === 'array' && p.items?.format === 'uri');
}

/**
 * The settings a model offers (everything but the inputs the editor fills in), in the model's own
 * order: [{ name, type, title, description, default, minimum, maximum, enum }].
 */
export async function modelParams(model) {
  const schema = await inputSchema(model);
  return Object.entries(schema.properties)
    // Only the first image is used, so asking for more would just cost more.
    .filter(([name]) => !isManagedInput(schema, name) && name !== 'num_outputs')
    .sort(([, a], [, b]) => (a['x-order'] ?? 999) - (b['x-order'] ?? 999))
    .map(([name, p]) => ({
      name,
      type: p.enum ? 'enum' : p.type || 'string',
      title: p.title || name,
      description: p.description || '',
      // The editor asks for PNG unless told otherwise, whatever the model's own default is.
      default: name === 'output_format' && p.enum?.includes('png') ? 'png' : p.default,
      minimum: p.minimum,
      maximum: p.maximum,
      enum: p.enum,
    }));
}

// Curated models are listed first; Replicate's collections add the rest.
const COLLECTIONS = ['text-to-image', 'image-editing'];
const COLLECTION_TTL_MS = 60 * 60_000;
let collectionCache = null;

/** Image models from Replicate's collections: [{ id, description, run_count, collections }], most used first. */
export async function listImageModels() {
  if (collectionCache && Date.now() - collectionCache.at < COLLECTION_TTL_MS) return collectionCache.models;
  const byId = new Map();
  const results = await Promise.allSettled(
    COLLECTIONS.map(async (slug) => {
      const data = await readJson(await fetch(`${API}/collections/${slug}`, { headers: { Authorization: `Bearer ${token()}` } }));
      for (const m of data.models || []) {
        const id = `${m.owner}/${m.name}`;
        const entry = byId.get(id) || { id, description: m.description || '', run_count: m.run_count || 0, collections: [] };
        entry.collections.push(slug);
        byId.set(id, entry);
      }
    }),
  );
  if (!byId.size) {
    const failure = results.find((r) => r.status === 'rejected');
    throw failure ? failure.reason : new Error('Replicate returned no image models');
  }
  const models = [...byId.values()].sort((a, b) => b.run_count - a.run_count);
  collectionCache = { at: Date.now(), models };
  return models;
}

function buildInput(schema, { prompt, aspectRatio, references, params }) {
  const props = schema?.properties;
  if (!props) {
    // Schema unavailable: fall back to the common FLUX/Gemini input names.
    const input = { output_format: 'png', ...params, prompt, aspect_ratio: aspectRatio };
    if (references.length) input.image_input = references;
    return input;
  }

  const input = { prompt };
  const ratio = props.aspect_ratio;
  if (ratio && (!ratio.enum || ratio.enum.includes(aspectRatio))) input.aspect_ratio = aspectRatio;
  const fmt = props.output_format?.enum;
  if (fmt) input.output_format = ['png', 'jpg', 'webp'].find((f) => fmt.includes(f));

  if (references.length) {
    const field = referenceField(schema);
    if (!field) throw Object.assign(new Error("This model doesn't accept reference images. Choose a reference model in the Project panel (left)."), { status: 400 });
    input[field.name] = field.multi ? references.slice(0, field.max ?? references.length) : references[0];
  }
  // The user's settings for this model (gear in the Project panel (left)). Unset ones keep the model's defaults.
  for (const [name, value] of Object.entries(params)) {
    if (props[name] && !isManagedInput(schema, name) && value !== null && value !== '') input[name] = value;
  }
  return input;
}

/**
 * Run a text-to-image model and return the image bytes.
 * `model` is "owner/name" (official models, e.g. black-forest-labs/flux-schnell) or "owner/name:version".
 * `references` are image URLs or data URIs used to keep characters / places consistent.
 * `params` are extra model inputs chosen by the user (e.g. { seed: 42, num_inference_steps: 4 }).
 * Resolves with { buffer, ext, usage }.
 */
export async function generateImage({ prompt, model, aspectRatio, references = [], params = {} }) {
  const headers = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' };
  let schema = null;
  try {
    schema = await inputSchema(model);
  } catch (err) {
    if (err.status === 400) throw err;
    console.warn(`Using default inputs for ${model}: ${err.message}`);
  }
  const input = buildInput(schema, { prompt, aspectRatio, references, params });

  const [name, version] = model.split(':');
  const url = version ? `${API}/predictions` : `${API}/models/${name}/predictions`;
  const body = version ? { version, input } : { input };

  let prediction = await readJson(
    await fetch(url, { method: 'POST', headers: { ...headers, Prefer: 'wait=60' }, body: JSON.stringify(body) }),
  );

  const deadline = Date.now() + TIMEOUT_MS;
  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() > deadline) throw new Error('Replicate prediction timed out');
    await sleep(1500);
    prediction = await readJson(await fetch(prediction.urls.get, { headers }));
  }
  if (prediction.status !== 'succeeded') {
    throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error || 'unknown error'}`);
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (typeof outputUrl !== 'string') throw new Error('Replicate returned no image URL');

  const imgRes = await fetch(outputUrl, outputUrl.startsWith(API) ? { headers } : undefined);
  if (!imgRes.ok) throw new Error(`Could not download generated image (${imgRes.status})`);
  const ext = (outputUrl.split('?')[0].match(/\.(png|jpe?g|webp)$/i)?.[1] || 'png').toLowerCase();
  // Replicate reports run time but no price; see server/usage.js.
  const usage = { images: 1, predict_time: prediction.metrics?.predict_time ?? null, prediction_id: prediction.id };
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), ext, usage };
}
