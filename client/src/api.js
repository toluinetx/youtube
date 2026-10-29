let historyListener = null;
let projectListener = null;

/** Identifies this browser tab, so it can ignore change events it caused itself. */
export const CLIENT_ID = crypto.randomUUID();

/** The project this tab is showing (from the server's X-Project header). */
let projectId = null;
export const currentProject = () => projectId;

/** Headers for every request: who is asking, and which project the change is meant for. */
export const clientHeaders = () => ({ 'X-Client': CLIENT_ID, ...(projectId && { 'X-Project': projectId }) });

/** Called with { undo, redo } (labels or null) whenever the server reports its undo history. */
export function onHistory(fn) {
  historyListener = fn;
}

/** Called with the new project id when the server has switched to another project. */
export function onProjectChange(fn) {
  projectListener = fn;
}

async function request(method, url, body, { headers, ...opts } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...clientHeaders(), ...(body && { 'Content-Type': 'application/json' }), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });
  const project = res.headers.get('X-Project');
  if (project) {
    if (projectId && project !== projectId) projectListener?.(project);
    else projectId = project;
  }
  const history = res.headers.get('X-History');
  if (history && historyListener) historyListener(JSON.parse(decodeURIComponent(history)));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status, data });
  return data;
}

/** Send a File as the raw request body; the server streams it to disk. */
function upload(url, file) {
  return request('POST', url, undefined, {
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
}

const REGENERATE_ROUTE = { image: 'regenerate-image', voiceover: 'regenerate-audio', sfx: 'regenerate-sfx' };

export const api = {
  status: () => request('GET', '/api/status'),
  projects: () => request('GET', '/api/projects'),
  createProject: (title, open) => request('POST', '/api/projects', { title, open }),
  openProject: (id) => request('POST', `/api/projects/${encodeURIComponent(id)}/open`),
  storyboard: () => request('GET', '/api/storyboard'),
  updateSettings: (patch) => request('PUT', '/api/settings', patch),
  updateScene: (id, patch, opts) => request('PUT', `/api/scene/${id}`, patch, opts),
  addScene: (fields) => request('POST', '/api/scenes', fields),
  duplicateScene: (id) => request('POST', `/api/scene/${id}/duplicate`),
  deleteScene: (id) => request('DELETE', `/api/scene/${id}`),
  deleteScenes: (ids) => request('POST', '/api/scenes/delete', { ids }),
  pastePrompts: (ids, prompts) => request('POST', '/api/scenes/paste-prompts', { ids, prompts }),
  duplicateScenes: (ids) => request('POST', '/api/scenes/duplicate', { ids }),
  reorder: (order) => request('POST', '/api/scenes/reorder', { order }),
  importScript: (script, mode) => request('POST', '/api/scenes/import-script', { script, mode }),
  regenerate: (id, kind) => request('POST', `/api/scene/${id}/${REGENERATE_ROUTE[kind]}`),
  clearSceneSlot: (id, slot) => request('DELETE', `/api/scene/${id}/media/${slot}`),
  // Library: uploads land here; nothing is put on the reel until used explicitly.
  library: () => request('GET', '/api/library'),
  uploadToLibrary: (file) => upload('/api/library', file),
  deleteAsset: (assetId, force) => request('DELETE', `/api/library/${assetId}${force ? '?force=1' : ''}`),
  // `into`: { layerId } for an extra sound effect, { shotId } for an extra shot.
  useAsset: (sceneId, assetId, slot, into = {}) =>
    request('POST', `/api/scene/${sceneId}/use-asset`, { asset_id: assetId, slot, layer_id: into.layerId, shot_id: into.shotId }),
  generateShot: (sceneId, shotId) => request('POST', `/api/scene/${sceneId}/shots/${shotId}/generate`),
  generateSfxLayer: (sceneId, layerId) => request('POST', `/api/scene/${sceneId}/sfx-layers/${layerId}/generate`),
  sceneFromAsset: (assetId, index) => request('POST', '/api/scenes/from-asset', { asset_id: assetId, index }),
  renameAsset: (assetId, name) => request('PATCH', `/api/library/${assetId}`, { name }),
  snapshot: (assetId, timeSec) => request('POST', `/api/library/${assetId}/snapshot`, { time_sec: timeSec }),
  saveSceneToLibrary: (sceneId) => request('POST', `/api/scene/${sceneId}/save-to-library`),
  modelInfo: (model) => request('GET', `/api/model-info?model=${encodeURIComponent(model)}`),
  setMusic: (assetId) => request('PUT', '/api/music', { asset_id: assetId }),
  removeMusic: () => request('DELETE', '/api/music'),
  // `settings`: unsaved changes to price the plan with. `items`: plan item ids to generate.
  generationPlan: (settings) => request('POST', '/api/generate-missing/plan', { settings }),
  generateMissing: (items) => request('POST', '/api/generate-missing', items && { items }),
  exportVideo: () => request('POST', '/api/export'),
  latestExport: () => request('GET', '/api/export'),
  job: () => request('GET', '/api/job'),
  undo: () => request('POST', '/api/undo'),
  redo: () => request('POST', '/api/redo'),
  voices: () => request('GET', '/api/voices'),
  elevenlabsModels: () => request('GET', '/api/elevenlabs-models'),
  imageModels: () => request('GET', '/api/image-models'),
  geminiModels: () => request('GET', '/api/gemini-models'),
  generateVideo: (id) => request('POST', `/api/scene/${id}/generate-video`),
  modelParams: (model) => request('GET', `/api/model-params?model=${encodeURIComponent(model)}`),
  usage: () => request('GET', '/api/usage'),
  usageAccounts: () => request('GET', '/api/usage/accounts'),
  setPrice: (key, price) => request('PUT', '/api/usage/prices', { key, price }),
  preferences: () => request('GET', '/api/preferences'),
  setStarred: (list, id, starred) => request('PUT', '/api/preferences/starred', { list, id, starred }),
};
