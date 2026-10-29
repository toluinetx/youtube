let historyListener = null;

/** Called with { undo, redo } (labels or null) whenever the server reports its undo history. */
export function onHistory(fn) {
  historyListener = fn;
}

async function request(method, url, body, opts = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });
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
  storyboard: () => request('GET', '/api/storyboard'),
  updateSettings: (patch) => request('PUT', '/api/settings', patch),
  updateScene: (id, patch, opts) => request('PUT', `/api/scene/${id}`, patch, opts),
  addScene: (fields) => request('POST', '/api/scenes', fields),
  duplicateScene: (id) => request('POST', `/api/scene/${id}/duplicate`),
  deleteScene: (id) => request('DELETE', `/api/scene/${id}`),
  reorder: (order) => request('POST', '/api/scenes/reorder', { order }),
  importScript: (script, mode) => request('POST', '/api/scenes/import-script', { script, mode }),
  regenerate: (id, kind) => request('POST', `/api/scene/${id}/${REGENERATE_ROUTE[kind]}`),
  clearSceneSlot: (id, slot) => request('DELETE', `/api/scene/${id}/media/${slot}`),
  // Library: uploads land here; nothing is put on the reel until used explicitly.
  uploadToLibrary: (file) => upload('/api/library', file),
  deleteAsset: (assetId, force) => request('DELETE', `/api/library/${assetId}${force ? '?force=1' : ''}`),
  useAsset: (sceneId, assetId, slot) => request('POST', `/api/scene/${sceneId}/use-asset`, { asset_id: assetId, slot }),
  sceneFromAsset: (assetId, index) => request('POST', '/api/scenes/from-asset', { asset_id: assetId, index }),
  renameAsset: (assetId, name) => request('PATCH', `/api/library/${assetId}`, { name }),
  snapshot: (assetId, timeSec) => request('POST', `/api/library/${assetId}/snapshot`, { time_sec: timeSec }),
  saveSceneToLibrary: (sceneId) => request('POST', `/api/scene/${sceneId}/save-to-library`),
  modelInfo: (model) => request('GET', `/api/model-info?model=${encodeURIComponent(model)}`),
  setMusic: (assetId) => request('PUT', '/api/music', { asset_id: assetId }),
  removeMusic: () => request('DELETE', '/api/music'),
  generateMissing: () => request('POST', '/api/generate-missing'),
  exportVideo: () => request('POST', '/api/export'),
  job: () => request('GET', '/api/job'),
  undo: () => request('POST', '/api/undo'),
  redo: () => request('POST', '/api/redo'),
  voices: () => request('GET', '/api/voices'),
};
