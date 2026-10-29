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

function buildInput(schema, { prompt, aspectRatio, references }) {
  const props = schema?.properties;
  if (!props) {
    // Schema unavailable: fall back to the common FLUX/Gemini input names.
    const input = { prompt, aspect_ratio: aspectRatio, output_format: 'png' };
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
    if (!field) throw Object.assign(new Error("This model doesn't accept reference images. Choose a reference model in the Project tab."), { status: 400 });
    input[field.name] = field.multi ? references.slice(0, field.max ?? references.length) : references[0];
  }
  return input;
}

/**
 * Run a text-to-image model and return the image bytes.
 * `model` is "owner/name" (official models, e.g. black-forest-labs/flux-schnell) or "owner/name:version".
 * `references` are image URLs or data URIs used to keep characters / places consistent.
 */
export async function generateImage({ prompt, model, aspectRatio, references = [] }) {
  const headers = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' };
  let schema = null;
  try {
    schema = await inputSchema(model);
  } catch (err) {
    if (err.status === 400) throw err;
    console.warn(`Using default inputs for ${model}: ${err.message}`);
  }
  const input = buildInput(schema, { prompt, aspectRatio, references });

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
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), ext };
}
