// A local ComfyUI server running workflows exported with "Export (API)". Each workflow in
// comfyui-workflows/ is a model: comfyui-workflows/qwen-image.json is "comfyui:qwen-image".
//
// The editor fills in, by itself:
//   - the prompt: every text input set to "{{prompt}}",
//   - the size: width / height of the Empty…Latent… nodes, from the project's aspect ratio,
//   - the seed: every seed / noise_seed input (random unless set in the model's settings).
// An optional "_editor" entry (removed before the workflow is sent) names it and lists more settings:
//   { "label", "description", "params": [{ name, type, title, default, …, "inputs": [[nodeId, inputName], …], "invert" }] }
// A workflow takes reference images if "_editor" says where they go:
//   "references": { "max", "image_node": a LoadImage node to copy for each one,
//                   "inputs": [[nodeId, "images.image_{n}"], …] }   ({n} counts from 1, {i} from 0)
// The workflow's own LoadImage nodes are replaced by one per reference, uploaded to ComfyUI's input folder.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './paths.js';

const PREFIX = 'comfyui:';
const WORKFLOWS_DIR = path.join(ROOT, 'comfyui-workflows');
// ComfyUI Desktop listens on 8000, the portable / git install on 8188.
const DEFAULT_URLS = ['http://127.0.0.1:8000', 'http://127.0.0.1:8188'];
// The first run of a workflow loads its models, which can take minutes.
const TIMEOUT_MS = 15 * 60_000;
const PLACEHOLDER = '{{prompt}}';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

export const isComfyModel = (id) => typeof id === 'string' && id.startsWith(PREFIX);
const bare = (id) => (isComfyModel(id) ? id.slice(PREFIX.length) : id);

// ---- Server ---------------------------------------------------------------------------------------

let found = null;

async function probe(url) {
  const res = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(1500) });
  const data = await res.json();
  if (!res.ok || !data.system) throw new Error('not ComfyUI');
  return url;
}

/** The ComfyUI server's URL (COMFYUI_URL, else whichever default port answers), or null if none does. */
export async function findComfyServer() {
  const urls = process.env.COMFYUI_URL ? [process.env.COMFYUI_URL.replace(/\/+$/, '')] : DEFAULT_URLS;
  if (found && urls.includes(found)) {
    if (await probe(found).catch(() => null)) return found;
  }
  found = await Promise.any(urls.map(probe)).catch(() => null);
  return found;
}

async function server() {
  const url = await findComfyServer();
  if (url) return url;
  const where = process.env.COMFYUI_URL || DEFAULT_URLS.join(' or ');
  throw badRequest(`ComfyUI isn't running at ${where}. Start ComfyUI (or set COMFYUI_URL in .env) and try again.`);
}

async function call(base, route, body) {
  const res = await fetch(`${base}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ComfyUI ${res.status}: ${describeError(data) || res.statusText}`);
  return data;
}

/** The useful part of a rejected /prompt: the error, then each node's problems. */
function describeError(data) {
  const nodes = Object.entries(data.node_errors || {}).flatMap(([id, n]) =>
    (n.errors || []).map((e) => `${n.class_type || 'node'} #${id}: ${e.message}${e.details ? ` (${e.details})` : ''}`),
  );
  return [data.error?.message, ...nodes].filter(Boolean).join('; ');
}

// ---- Workflows ------------------------------------------------------------------------------------

async function readWorkflow(model) {
  const name = bare(model);
  if (!/^[\w.-]+$/.test(name)) throw badRequest(`Not a ComfyUI workflow name: ${name}`);
  let text;
  try {
    text = await fs.readFile(path.join(WORKFLOWS_DIR, `${name}.json`), 'utf8');
  } catch {
    throw badRequest(`No ComfyUI workflow at comfyui-workflows/${name}.json`);
  }
  const { _editor: editor = {}, ...nodes } = JSON.parse(text);
  if (Object.values(nodes).some((n) => !n?.class_type)) {
    throw badRequest(`comfyui-workflows/${name}.json isn't in API format. In ComfyUI, use File → Export (API).`);
  }
  return { editor, nodes };
}

/** Reference images a workflow takes: its "max" (null if none is given), or 0 without "references". */
const capacityOf = (editor) => (editor.references ? editor.references.max ?? null : 0);

export async function comfyReferenceCapacity(model) {
  return capacityOf((await readWorkflow(model)).editor);
}

/** Workflows in comfyui-workflows/: [{ id, label, sub, references }], references being their capacity. */
export async function listComfyModels() {
  const files = await fs.readdir(WORKFLOWS_DIR).catch(() => []);
  const models = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const id = PREFIX + file.slice(0, -'.json'.length);
    try {
      const { editor } = await readWorkflow(id);
      models.push({ id, label: editor.label || bare(id), sub: editor.description || '', references: capacityOf(editor) });
    } catch (err) {
      console.warn(`Skipping ComfyUI workflow ${file}: ${err.message}`);
    }
  }
  return models;
}

const SIZE_PARAMS = [
  {
    name: 'megapixels', type: 'number', title: 'Size (megapixels)', minimum: 0.25, maximum: 4, step: 0.25, default: 1,
    description: 'The shape follows the project format. Larger is slower and needs more VRAM.',
  },
  { name: 'seed', type: 'integer', title: 'Seed', minimum: 0, description: 'Leave empty for a new picture each time.' },
];

/** A workflow's settings, in the same shape as Replicate's (see modelParams in replicate.js). */
export async function comfyParams(model) {
  const { editor } = await readWorkflow(model);
  return [...(editor.params || []).map(({ inputs, ...p }) => p), ...SIZE_PARAMS];
}

const isSet = (v) => v !== undefined && v !== null && v !== '';

/** Width and height for an aspect ratio like "16:9" at about `megapixels` (1 = 1024²), in multiples of 16. */
function sizeFor(aspectRatio, megapixels) {
  const [w, h] = String(aspectRatio || '1:1').split(':').map(Number);
  const ratio = w > 0 && h > 0 ? w / h : 1;
  const pixels = (Number(megapixels) > 0 ? Number(megapixels) : 1) * 1024 * 1024;
  const round = (n) => Math.max(256, Math.round(n / 16) * 16);
  return { width: round(Math.sqrt(pixels * ratio)), height: round(Math.sqrt(pixels / ratio)) };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';

/**
 * Plug one LoadImage node per uploaded reference (`names`) into the inputs "references" lists, in
 * place of the workflow's own images, then drop LoadImage nodes nothing uses any more.
 */
function wireReferences(graph, config, names) {
  const template = graph[config.image_node];
  if (template?.class_type !== 'LoadImage') throw badRequest(`"references.image_node" must be a LoadImage node (got ${config.image_node})`);
  for (const [id, pattern] of config.inputs || []) {
    const inputs = graph[id]?.inputs;
    if (!inputs) throw badRequest(`"references" points at node ${id}, which isn't in the workflow`);
    const [before, after = ''] = pattern.split(/\{[ni]\}/);
    const slot = new RegExp(`^${escapeRegex(before)}\\d+${escapeRegex(after)}$`);
    for (const key of Object.keys(inputs)) if (slot.test(key)) delete inputs[key];
    names.forEach((_, k) => {
      inputs[pattern.replace('{n}', k + 1).replace('{i}', k)] = [`editor_ref_${k + 1}`, 0];
    });
  }
  names.forEach((name, k) => {
    graph[`editor_ref_${k + 1}`] = { ...structuredClone(template), inputs: { ...template.inputs, image: name } };
  });
  const used = new Set(Object.values(graph).flatMap((n) => Object.values(n.inputs || {}).filter(isLink).map(([id]) => id)));
  for (const [id, node] of Object.entries(graph)) if (node.class_type === 'LoadImage' && !used.has(id)) delete graph[id];
}

/** The workflow with the prompt, size, seed, reference images and the user's settings filled in. */
function fill({ editor, nodes }, { prompt, width, height, seed, params, references }) {
  const graph = structuredClone(nodes);
  let prompts = 0;
  for (const node of Object.values(graph)) {
    const inputs = node.inputs || {};
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'string' && value.includes(PLACEHOLDER)) {
        inputs[key] = value.replaceAll(PLACEHOLDER, prompt);
        prompts++;
      } else if (/(^|\.|_)seed$/.test(key) && typeof value === 'number') {
        inputs[key] = seed;
      }
    }
    if (/^Empty.*Latent/i.test(node.class_type) && 'width' in inputs && 'height' in inputs) {
      inputs.width = width;
      inputs.height = height;
    }
  }
  if (!prompts) throw badRequest(`This workflow has no "${PLACEHOLDER}". Put it in the prompt text box of the workflow's JSON.`);
  if (editor.references) wireReferences(graph, editor.references, references);

  for (const p of editor.params || []) {
    if (!isSet(params[p.name])) continue;
    for (const [id, input] of p.inputs || []) {
      if (!graph[id]) throw badRequest(`Setting "${p.name}" points at node ${id}, which isn't in the workflow`);
      graph[id].inputs[input] = p.invert ? !params[p.name] : params[p.name];
    }
  }
  return graph;
}

/** The first saved image in a finished run's outputs (preview images only if nothing was saved). */
function outputImage(outputs = {}) {
  const images = Object.values(outputs).flatMap((o) => o.images || []);
  return images.find((i) => i.type === 'output') || images[0] || null;
}

// ---- Images ---------------------------------------------------------------------------------------

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Upload images (data URIs) to ComfyUI's input folder; resolves with their names there, for LoadImage. */
function uploadImages(base, uris) {
  return Promise.all(
    uris.map(async (uri) => {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(uri);
      if (!m) throw new Error('Reference images must be data URIs');
      const bytes = Buffer.from(m[2], 'base64');
      // Named by content, so the same reference is stored once however often it's sent.
      const name = `ai-video-editor-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.${EXT[m[1]] || 'png'}`;
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: m[1] }), name);
      form.append('overwrite', 'true');
      const res = await fetch(`${base}/upload/image`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.name) throw new Error(`ComfyUI ${res.status}: couldn't upload a reference image`);
      return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
    }),
  );
}

/** Same contract as replicate.generateImage: resolves with { buffer, ext, usage }. */
export async function generateComfyImage({ prompt, model, aspectRatio, references = [], params = {} }) {
  const workflow = await readWorkflow(model);
  if (references.length && !workflow.editor.references) {
    throw badRequest('This ComfyUI workflow is text to image only. Pick another model under "Model when references are used".');
  }
  const base = await server();
  const { width, height } = sizeFor(aspectRatio, params.megapixels);
  const seed = isSet(params.seed) ? Number(params.seed) : Math.floor(Math.random() * 2 ** 48);
  const max = capacityOf(workflow.editor);
  const names = await uploadImages(base, max ? references.slice(0, max) : references);
  const graph = fill(workflow, { prompt, width, height, seed, params, references: names });

  const started = Date.now();
  const { prompt_id: id } = await call(base, '/prompt', { prompt: graph, client_id: 'ai-video-editor' });
  let run;
  while (!(run = (await call(base, `/history/${id}`))[id])?.status?.completed) {
    if (run?.status?.status_str === 'error') break;
    if (Date.now() - started > TIMEOUT_MS) throw new Error('ComfyUI took too long. The job may still be running in ComfyUI.');
    await sleep(1000);
  }
  if (run.status.status_str === 'error') {
    const failure = run.status.messages?.find(([type]) => type === 'execution_error')?.[1];
    throw new Error(`ComfyUI failed${failure ? ` in ${failure.node_type}: ${failure.exception_message?.trim()}` : ''}`);
  }

  const image = outputImage(run.outputs);
  if (!image) throw new Error('The ComfyUI workflow finished without an image. Does it end in a Save Image node?');
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
  const res = await fetch(`${base}/view?${query}`);
  if (!res.ok) throw new Error(`Could not download the image from ComfyUI (${res.status})`);
  const ext = (image.filename.match(/\.(png|jpe?g|webp)$/i)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
  const usage = { images: 1, references: names.length, seconds: (Date.now() - started) / 1000, width, height, seed, prompt_id: id };
  return { buffer: Buffer.from(await res.arrayBuffer()), ext, usage };
}
