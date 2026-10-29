import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, AudioLines, BookmarkPlus, Camera, Check, ClipboardCopy, ClipboardPaste, Clapperboard, Copy, FolderPlus, ImageIcon, Music, Pencil, Plus, RefreshCw, Settings2, Sparkles,
  SquareDashedMousePointer, Trash2, X,
} from 'lucide-react';
import { CLIENT_ID, api, clientHeaders, currentProject, onHistory, onProjectChange } from './api.js';
import { assetFits, countMissing, describeGeneration, isTyping, sceneIndexAt, sceneStarts, wantsVideo } from './util.js';
import AssetLibrary from './components/AssetLibrary.jsx';
import SnapshotModal from './components/SnapshotModal.jsx';
import TopBar from './components/TopBar.jsx';
import Preview from './components/Preview.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector from './components/Inspector.jsx';
import ProjectSettings, { MusicSettings } from './components/ProjectSettings.jsx';
import LeftPanel from './components/LeftPanel.jsx';
import PanelResizer from './components/PanelResizer.jsx';
import { ModelCatalogProvider } from './components/ModelControls.jsx';
import ScriptImport from './components/ScriptImport.jsx';
import GenerateDialog from './components/GenerateDialog.jsx';
import ContextMenu from './components/ContextMenu.jsx';

const SAVE_DELAY_MS = 600;
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
const SLOT_LABEL = { image: 'image', voiceover: 'voiceover', sfx: 'sound effect' };
const SLOT_PROMPT = { image: 'image_prompt', voiceover: 'voiceover_text', sfx: 'sfx_prompt' };
const SLOT_ICON = { image: ImageIcon, voiceover: AudioLines, sfx: Sparkles };
const PROMPT_FIELDS = ['image_prompt', 'voiceover_text', 'sfx_prompt'];
// Fields the server owns after a generate/upload/remove; everything else may have unsaved local edits.
const LEFT_PANEL = { initial: 320, min: 220, max: 640 };
const RIGHT_PANEL = { initial: 380, min: 300, max: 720 };

/** A width in pixels kept in localStorage under `key`. */
function useStoredWidth(key, initial) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(key)) || initial);
  useEffect(() => localStorage.setItem(key, String(width)), [key, width]);
  return [width, setWidth];
}

/**
 * A scene's sound effect layers or shots after a media action: the server's, unless this tab still has
 * edits to them waiting to be saved; then those, with the media the server now has (and, for items
 * synced to a word, the server's timing, which follows the new voiceover).
 */
function withServerMedia(local = [], server = [], localPending, idKey, mediaKeys) {
  if (!localPending) return server;
  const byId = new Map(server.map((x) => [x[idKey], x]));
  return local.map((x) => {
    const s = byId.get(x[idKey]);
    if (!s) return x;
    return { ...x, ...Object.fromEntries(mediaKeys.map((k) => [k, s[k]])), ...(x.cue && s.cue === x.cue && { start_sec: s.start_sec }) };
  });
}

const MEDIA_FIELDS = [
  'image_url', 'voiceover_url', 'sfx_url', 'voiceover_duration_sec', 'sfx_duration_sec',
  'video_url', 'video_thumb_url', 'video_duration_sec', 'video_has_audio', 'video_start_sec', 'source_names',
];

export default function App() {
  const [sb, setSb] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState(null);
  // selectedId is the scene shown in the sidebar; selection holds every selected scene (shift / ⌘-click).
  // A selection that doesn't include selectedId is stale and means just selectedId.
  const [selectedId, setSelectedId] = useState(null);
  const [selection, setSelection] = useState([]);
  const anchorId = useRef(null); // where a shift-click range starts
  const [copiedPrompts, setCopiedPrompts] = useState(null); // { image_prompt, voiceover_text, sfx_prompt, from }
  // Right: the selected scene's Visual / Voice / SFX, or the Music. Left: the library or the project settings.
  const [sidebarTab, setSidebarTab] = useState('visual');
  const [leftTab, setLeftTab] = useState(() => localStorage.getItem('leftTab') || 'library');
  // Side panel widths in pixels (dragged by their inner edges), remembered between visits.
  const [leftWidth, setLeftWidth] = useStoredWidth('leftWidth', LEFT_PANEL.initial);
  const [rightWidth, setRightWidth] = useStoredWidth('rightWidth', RIGHT_PANEL.initial);
  const [time, setTime] = useState(0);
  const [seekToken, setSeekToken] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const [job, setJob] = useState(null);
  const [exportUrl, setExportUrl] = useState(null);
  const [previewMode, setPreviewMode] = useState('live');
  const [showImport, setShowImport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [toast, setToast] = useState(null);
  const [uploading, setUploading] = useState([]);
  const [dragAsset, setDragAsset] = useState(null);
  const [snapshotTarget, setSnapshotTarget] = useState(null); // { asset, purpose, resolve }
  const [menu, setMenu] = useState(null); // { x, y, items }
  const [history, setHistory] = useState({ undo: null, redo: null }); // labels of the next undo / redo step
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => localStorage.getItem('libraryCollapsed') === '1');

  const scenes = useMemo(() => sb?.scenes ?? [], [sb]);
  const starts = useMemo(() => sceneStarts(scenes), [scenes]);
  const total = scenes.reduce((sum, s) => sum + (Number(s.duration_sec) || 0), 0);
  const selectedIndex = scenes.findIndex((s) => s.scene_id === selectedId);
  const selected = scenes[selectedIndex];
  const selectedIds = useMemo(() => {
    const ids = selection.includes(selectedId) ? selection : [selectedId];
    return scenes.filter((s) => ids.includes(s.scene_id)).map((s) => s.scene_id);
  }, [scenes, selection, selectedId]);
  const library = useMemo(() => sb?.library ?? [], [sb]);

  // Where each media URL is used, on the reel or as a reference (for library badges):
  // { count, scenes: [scene numbers], music, reference (project-wide) }.
  const usage = useMemo(() => {
    const uses = {};
    const use = (url) => {
      if (!url) return null;
      const u = (uses[url] ??= { count: 0, scenes: [], music: false, reference: false });
      u.count++;
      return u;
    };
    const urlOf = new Map(library.map((a) => [a.asset_id, a.url]));
    scenes.forEach((s, i) => {
      const urls = [
        s.image_url, s.video_url, s.voiceover_url, s.sfx_url, ...(s.sfx_layers || []).map((l) => l.url), ...(s.shots || []).map((x) => x.image_url),
        ...(s.reference_asset_ids || []).map((id) => urlOf.get(id)),
      ];
      for (const url of urls) {
        const u = use(url);
        if (u && u.scenes.at(-1) !== i + 1) u.scenes.push(i + 1);
      }
    });
    const music = use(sb?.settings.music_url);
    if (music) music.music = true;
    for (const id of sb?.settings.reference_asset_ids || []) {
      const u = use(urlOf.get(id));
      if (u) u.reference = true;
    }
    return uses;
  }, [scenes, library, sb?.settings.music_url, sb?.settings.reference_asset_ids]);

  /** Show a toast; `action` ({ label, onClick }) adds a button to it, e.g. Undo. */
  const notify = useCallback((message, tone = 'error', action = null) => {
    setToast({ message, tone, action, id: Date.now() });
  }, []);

  useEffect(() => onHistory(setHistory), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Debounced saving -------------------------------------------------------------------------
  // Local edits apply instantly; the network write is batched per scene. Unsaved/in-flight edits are
  // re-applied on top of anything the server sends back so typing is never clobbered.

  const pending = useRef({});
  const inflight = useRef({});
  const timers = useRef({});

  const overlayLocal = useCallback(
    (scene) => ({ ...scene, ...inflight.current[scene.scene_id], ...pending.current[scene.scene_id] }),
    [],
  );

  const applyServer = useCallback(
    (data) => setSb({ ...data, scenes: data.scenes.map(overlayLocal), settings: { ...data.settings, ...pending.current.settings } }),
    [overlayLocal],
  );

  const flush = useCallback(
    async (id) => {
      clearTimeout(timers.current[id]);
      const patch = pending.current[id];
      if (!patch) return;
      delete pending.current[id];
      inflight.current[id] = { ...inflight.current[id], ...patch };
      try {
        if (id === 'settings') await api.updateSettings(patch);
        else await api.updateScene(id, patch);
      } catch (err) {
        notify(`Save failed: ${err.message}`);
      } finally {
        if (inflight.current[id]) {
          for (const k of Object.keys(patch)) if (inflight.current[id][k] === patch[k]) delete inflight.current[id][k];
        }
      }
    },
    [notify],
  );

  const queueSave = useCallback(
    (id, patch) => {
      pending.current[id] = { ...pending.current[id], ...patch };
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => flush(id), SAVE_DELAY_MS);
    },
    [flush],
  );

  const patchScene = useCallback(
    (id, patch) => {
      setSb((prev) => ({ ...prev, scenes: prev.scenes.map((s) => (s.scene_id === id ? { ...s, ...patch } : s)) }));
      queueSave(id, patch);
    },
    [queueSave],
  );

  const patchSettings = useCallback(
    (patch) => {
      setSb((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
      queueSave('settings', patch);
    },
    [queueSave],
  );

  useEffect(() => {
    const onUnload = () => {
      for (const [id, patch] of Object.entries(pending.current)) {
        const url = id === 'settings' ? '/api/settings' : `/api/scene/${id}`;
        fetch(url, { method: 'PUT', keepalive: true, headers: { ...clientHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  // ---- Loading ----------------------------------------------------------------------------------

  const reload = useCallback(async () => {
    try {
      applyServer(await api.storyboard());
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [applyServer]);

  useEffect(() => {
    reload();
    api.status().then(setStatus).catch(() => {});
    api.job().then((j) => j.status !== 'idle' && setJob(j)).catch(() => {});
  }, [reload]);

  useEffect(() => {
    if (!sb) return;
    // Nothing selected, or the selected scene is gone (deleted, undone, changed elsewhere): select the first.
    if (selectedId == null || !scenes.some((s) => s.scene_id === selectedId)) setSelectedId(scenes[0]?.scene_id ?? null);
  }, [sb, selectedId, scenes]);

  // ---- Live updates -----------------------------------------------------------------------------
  // Changes made elsewhere (another tab, the timeline-generation skill) arrive as server-sent events.
  // When the server switches to another project, this tab reloads to show it.

  useEffect(() => onProjectChange(() => window.location.reload()), []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === 'project' && currentProject() && event.project !== currentProject()) window.location.reload();
      if (event.type === 'storyboard' && event.origin !== CLIENT_ID && event.project === currentProject()) {
        reload();
        if (event.label?.startsWith('Import')) notify(`Timeline updated: ${event.label}`, 'success');
      }
    };
    return () => events.close();
  }, [reload, notify]);

  // ---- Playback ---------------------------------------------------------------------------------

  const seek = useCallback(
    (t) => {
      setTime(Math.max(0, Math.min(t, total)));
      setSeekToken((n) => n + 1);
    },
    [total],
  );

  /** Show scene `id` in the sidebar and the preview, keeping `ids` selected. */
  const focusScene = useCallback(
    (id, ids, { seekTo = true } = {}) => {
      setSelectedId(id);
      setSelection(ids);
      setSidebarTab((t) => (t === 'music' ? 'visual' : t));
      setPreviewMode('live');
      const i = scenes.findIndex((s) => s.scene_id === id);
      if (seekTo && i >= 0) seek(starts[i] + 0.001);
    },
    [scenes, starts, seek],
  );

  /** Select just this scene. */
  const selectScene = useCallback(
    (id, opts) => {
      anchorId.current = id;
      focusScene(id, [id], opts);
    },
    [focusScene],
  );

  // Latest scene actions for the keyboard shortcuts and context menus, which are bound once.
  const actions = useRef({});

  /** A click on a timeline clip: shift extends the selection from the anchor, ⌘/Ctrl toggles one scene. */
  actions.current.clickScene = (id, { range, toggle } = {}) => {
    const ids = scenes.map((s) => s.scene_id);
    if (range) {
      const a = ids.indexOf(anchorId.current ?? selectedId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) return focusScene(id, ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (toggle) {
      if (!selectedIds.includes(id)) {
        anchorId.current = id;
        return focusScene(id, [...selectedIds, id]);
      }
      const rest = selectedIds.filter((x) => x !== id);
      if (!rest.length) return; // keep at least one scene selected
      return focusScene(id === selectedId ? rest.at(-1) : selectedId, rest, { seekTo: false });
    }
    selectScene(id);
  };
  const clickScene = useCallback((id, mods) => actions.current.clickScene(id, mods), []);

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || e.altKey) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) actions.current.redo();
        else actions.current.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'd') {
        e.preventDefault();
        if (selectedIds.length) actions.current.duplicateScenes(selectedIds);
        return;
      }
      // Copy / paste prompts, unless the user is copying text they selected on the page.
      if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'v') && !window.getSelection()?.toString()) {
        if (key === 'c' && selectedId != null) actions.current.copyPrompts(selectedId);
        else if (key === 'v' && selectedIds.length) actions.current.pastePrompts(selectedIds);
        else return;
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault();
        if (scenes.length) focusScene(selectedId ?? scenes[0].scene_id, scenes.map((s) => s.scene_id), { seekTo: false });
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedIds.length) actions.current.deleteScenes(selectedIds);
      } else if (e.key === 'Escape' && selectedIds.length > 1) {
        selectScene(selectedId, { seekTo: false });
      } else if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Grow / shrink the selection from the anchor.
        e.preventDefault();
        const next = scenes[selectedIndex + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) actions.current.clickScene(next.scene_id, { range: true });
      } else if (e.code === 'Space') {
        e.preventDefault();
        setPreviewMode('live');
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = sceneIndexAt(starts, scenes, time);
        const next = Math.max(0, Math.min(scenes.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
        if (scenes[next]) selectScene(scenes[next].scene_id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scenes, starts, time, selectScene, focusScene, selectedId, selectedIds, selectedIndex]);

  // ---- Scene operations -------------------------------------------------------------------------

  /** Run a generate/upload/remove for one slot of a scene, tracking busy state and errors per slot. */
  const mediaAction = useCallback(
    async (id, slot, action) => {
      const key = `${id}:${slot}`;
      setBusy((b) => ({ ...b, [key]: true }));
      setErrors(({ [key]: _, ...rest }) => rest);
      try {
        await flush(id);
        const scene = await action();
        const media = Object.fromEntries(MEDIA_FIELDS.map((f) => [f, scene[f]]));
        setSb((prev) => ({
          ...prev,
          scenes: prev.scenes.map((s) =>
            s.scene_id === id
              ? {
                ...s,
                ...media,
                sfx_layers: withServerMedia(s.sfx_layers, scene.sfx_layers, Boolean(pending.current[id]?.sfx_layers), 'layer_id', ['url', 'duration_sec', 'source_name']),
                shots: withServerMedia(s.shots, scene.shots, Boolean(pending.current[id]?.shots), 'shot_id', ['image_url', 'source_name']),
                duration_sec: pending.current[id]?.duration_sec ?? scene.duration_sec,
              }
              : s,
          ),
        }));
        // Generated files are added to the library too.
        api.library().then((lib) => setSb((prev) => ({ ...prev, library: lib }))).catch(() => {});
      } catch (err) {
        setErrors((e) => ({ ...e, [key]: err.message }));
      } finally {
        setBusy(({ [key]: _, ...rest }) => rest);
      }
    },
    [flush],
  );

  const regenerate = (id, kind) => mediaAction(id, kind, () => api.regenerate(id, kind));
  const regenerateWithConfirm = (scene, kind) => {
    if (kind === 'image' && scene.video_url && !window.confirm('Generating an image replaces the imported video for this scene. Continue?')) return;
    regenerate(scene.scene_id, kind);
  };
  const clearSlot = (id, slot) => mediaAction(id, slot, () => api.clearSceneSlot(id, slot));
  // Extra sound effect layers are busy under "sfx:<layer id>".
  const generateSfxLayer = (sceneId, layerId) => mediaAction(sceneId, `sfx:${layerId}`, () => api.generateSfxLayer(sceneId, layerId));
  const uploadSfxLayer = (sceneId, layerId, file) =>
    mediaAction(sceneId, `sfx:${layerId}`, async () => {
      const asset = await uploadOne(file);
      return api.useAsset(sceneId, asset.asset_id, 'sfx', { layerId });
    });
  // Extra shots are busy under "shot:<shot id>".
  const generateShot = (sceneId, shotId) => mediaAction(sceneId, `shot:${shotId}`, () => api.generateShot(sceneId, shotId));
  const uploadShot = (sceneId, shotId, file) =>
    mediaAction(sceneId, `shot:${shotId}`, async () => {
      const asset = await uploadOne(file);
      return api.useAsset(sceneId, asset.asset_id, 'image', { shotId });
    });
  // A generated clip goes in the scene's visual slot, so it shows as busy there.
  const generateVideo = (scene) => {
    if (scene.video_url && !window.confirm('Generating a video replaces the current clip for this scene. Continue?')) return;
    mediaAction(scene.scene_id, 'image', () => api.generateVideo(scene.scene_id));
  };

  const musicAction = async (action) => {
    setBusy((b) => ({ ...b, music: true }));
    try {
      await flush('settings');
      const settings = await action();
      setSb((prev) => ({ ...prev, settings: { ...settings, ...pending.current.settings } }));
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(({ music: _, ...rest }) => rest);
    }
  };
  const removeMusic = () => musicAction(api.removeMusic);

  const showLeftTab = (tab) => {
    setLeftTab(tab);
    localStorage.setItem('leftTab', tab);
  };
  const openProjectSettings = () => {
    showLeftTab('project');
    if (libraryCollapsed) {
      localStorage.setItem('libraryCollapsed', '0');
      setLibraryCollapsed(false);
    }
  };

  const flushAll = useCallback(() => Promise.all(Object.keys(pending.current).map(flush)), [flush]);

  const run = useCallback(
    async (fn) => {
      try {
        await flushAll();
        await fn();
      } catch (err) {
        notify(err.message);
      }
    },
    [flushAll, notify],
  );

  const addScene = (afterId = selectedId) =>
    run(async () => {
      const scene = await api.addScene({ after_id: afterId });
      await reload();
      selectScene(scene.scene_id, { seekTo: false });
    });

  /** The timeline's + buttons: a blank scene at `index` (0 = first), shown in the sidebar and preview. */
  const insertSceneAt = (index) =>
    run(async () => {
      const scene = await api.addScene({ index });
      await reload();
      selectScene(scene.scene_id);
    });

  /** Duplicate scenes (as one undo step); the copies become the selection. */
  const duplicateScenes = (ids) =>
    run(async () => {
      const copies = (await api.duplicateScenes(ids)).map((s) => s.scene_id);
      await reload();
      anchorId.current = copies[0];
      focusScene(copies[0], copies, { seekTo: false });
    });
  const duplicateScene = (id) => duplicateScenes([id]);

  /** Delete scenes (as one undo step), then select the scene after them (or before, at the end). */
  const deleteScenes = (ids) => {
    const indexes = ids.map((id) => scenes.findIndex((s) => s.scene_id === id)).filter((i) => i >= 0);
    if (!indexes.length) return;
    const last = Math.max(...indexes);
    const neighbour = scenes.slice(last + 1).find((s) => !ids.includes(s.scene_id)) ?? scenes.slice(0, last).findLast((s) => !ids.includes(s.scene_id));
    run(async () => {
      await api.deleteScenes(ids);
      setSelectedId(neighbour?.scene_id ?? null);
      await reload();
      notify(ids.length === 1 ? `Deleted scene ${indexes[0] + 1}` : `Deleted ${ids.length} scenes`, 'info', {
        label: 'Undo',
        onClick: () => actions.current.undo(),
      });
    });
  };
  const deleteScene = (id) => deleteScenes([id]);

  /** Remember a scene's three prompts so they can be pasted onto other scenes. */
  const copyPrompts = (id) => {
    const i = scenes.findIndex((s) => s.scene_id === id);
    if (i < 0) return;
    setCopiedPrompts({ ...Object.fromEntries(PROMPT_FIELDS.map((f) => [f, scenes[i][f]])), from: i + 1 });
    notify(`Copied the prompts of scene ${i + 1}`, 'info');
  };

  /** Replace the prompts of scenes `ids` with the copied ones (one undo step). */
  const pastePrompts = (ids) => {
    if (!copiedPrompts) return notify('Copy a scene\'s prompts first (right-click a scene, or Ctrl/⌘+C)', 'info');
    const prompts = Object.fromEntries(PROMPT_FIELDS.map((f) => [f, copiedPrompts[f]]));
    run(async () => {
      applyServer(await api.pastePrompts(ids, prompts));
      const where = ids.length === 1 ? `scene ${scenes.findIndex((s) => s.scene_id === ids[0]) + 1}` : `${ids.length} scenes`;
      notify(`Pasted the prompts of scene ${copiedPrompts.from} into ${where}`, 'info', { label: 'Undo', onClick: () => actions.current.undo() });
    });
  };

  const moveScene = (id, dir) =>
    run(async () => {
      const order = scenes.map((s) => s.scene_id);
      const i = order.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      applyServer(await api.reorder(order));
    });

  // ---- Undo / redo ------------------------------------------------------------------------------
  // The server keeps the history; unsaved edits are saved first so they become the step that's undone.

  const travel = (direction) =>
    run(async () => {
      const result = await (direction === 'undo' ? api.undo() : api.redo());
      if (!result.storyboard) return;
      applyServer(result.storyboard);
      notify(`${direction === 'undo' ? 'Undid' : 'Redid'}: ${result.label}`, 'info');
    });

  actions.current.duplicateScenes = duplicateScenes;
  actions.current.deleteScenes = deleteScenes;
  actions.current.copyPrompts = copyPrompts;
  actions.current.pastePrompts = pastePrompts;
  actions.current.undo = () => travel('undo');
  actions.current.redo = () => travel('redo');

  /** Drag-to-reorder on the timeline: apply the new order locally right away, then save it. */
  const reorderScenes = (order) => {
    setSb((prev) => ({ ...prev, scenes: order.map((id) => prev.scenes.find((s) => s.scene_id === id)) }));
    run(async () => {
      try {
        applyServer(await api.reorder(order));
      } catch (err) {
        await reload();
        throw err;
      }
    });
  };

  // ---- Library ----------------------------------------------------------------------------------
  // Uploads only ever go into the library. Assets reach the reel when the user drags them onto the
  // timeline or uses an explicit button.

  const addToLibraryState = (asset) => setSb((prev) => ({ ...prev, library: [...prev.library, asset] }));

  const uploadOne = async (file) => {
    const asset = await api.uploadToLibrary(file);
    addToLibraryState(asset);
    return asset;
  };

  /** Upload files into the library. Resolves with the assets that were added. */
  const uploadFiles = async (files) => {
    const entries = [...files].map((file, i) => ({ id: `${Date.now()}-${i}`, name: file.name, file }));
    setUploading((u) => [...u, ...entries.map(({ id, name }) => ({ id, name }))]);
    const created = [];
    const failed = [];
    for (const entry of entries) {
      try {
        created.push(await uploadOne(entry.file));
      } catch (err) {
        failed.push(err.message);
      } finally {
        setUploading((u) => u.filter((x) => x.id !== entry.id));
      }
    }
    if (failed.length) notify(failed.join(' · '));
    else if (created.length) notify(`Added ${created.length} file${created.length === 1 ? '' : 's'} to the library`, 'success');
    return created;
  };

  const misfitMessage = (asset, slot) => {
    if (slot === 'image') return `"${asset.name}" is a sound. Drop it on a Voice, SFX or Music track.`;
    if (asset.type === 'image') return `"${asset.name}" is an image. Drop it on the Image track or between scenes.`;
    return `"${asset.name}" has no sound.`;
  };

  const placeAsset = (sceneId, slot, asset) => {
    if (!assetFits(asset, slot)) return notify(misfitMessage(asset, slot));
    selectScene(sceneId, { seekTo: false });
    return mediaAction(sceneId, slot, () => api.useAsset(sceneId, asset.asset_id, slot));
  };

  const addAssetAsScene = (asset, index) => {
    if (!assetFits(asset, 'image')) return notify(misfitMessage(asset, 'image'));
    return run(async () => {
      const scene = await api.sceneFromAsset(asset.asset_id, index);
      await reload();
      selectScene(scene.scene_id, { seekTo: false });
    });
  };

  const setMusicAsset = (asset) => {
    if (!assetFits(asset, 'music')) return notify(misfitMessage(asset, 'music'));
    return musicAction(() => api.setMusic(asset.asset_id));
  };

  const deleteAsset = (asset) => {
    const uses = usage[asset.url]?.count || 0;
    const message = uses
      ? `"${asset.name}" is used in ${uses} place${uses > 1 ? 's' : ''} (on the reel or as a reference). Delete it and remove it from those places?`
      : `Delete "${asset.name}" from the library?`;
    if (!window.confirm(message)) return;
    run(async () => {
      await api.deleteAsset(asset.asset_id, uses > 0);
      await reload();
    });
  };

  const renameAsset = async (asset) => {
    const name = window.prompt('Rename. References are named in the prompt, so a character name like "Maya" works well.', asset.name);
    if (!name?.trim() || name.trim() === asset.name) return;
    run(async () => {
      await api.renameAsset(asset.asset_id, name.trim());
      await reload();
    });
  };

  /** Ask the user to pick a frame of a video; resolves with the new library image, or null if cancelled. */
  const requestSnapshot = (asset, purpose) => new Promise((resolve) => setSnapshotTarget({ asset, purpose, resolve }));

  const captureSnapshot = async (timeSec) => {
    const { asset, resolve } = snapshotTarget;
    try {
      const image = await api.snapshot(asset.asset_id, timeSec);
      addToLibraryState(image);
      notify(`Snapshot saved to the library: ${image.name}`, 'success');
      resolve(image);
    } catch (err) {
      notify(err.message);
      resolve(null);
    } finally {
      setSnapshotTarget(null);
    }
  };

  const cancelSnapshot = () => {
    snapshotTarget?.resolve(null);
    setSnapshotTarget(null);
  };

  const saveSceneToLibrary = (sceneId) =>
    run(async () => {
      const asset = await api.saveSceneToLibrary(sceneId);
      if (!library.some((a) => a.asset_id === asset.asset_id)) addToLibraryState(asset);
      notify(`Saved to the library as "${asset.name}"`, 'success');
    });

  /** Sidebar "Upload" buttons: the file goes into the library and is then used in that slot. */
  const uploadAndUse = (sceneId, slot, file) =>
    mediaAction(sceneId, slot, async () => {
      const asset = await uploadOne(file);
      return api.useAsset(sceneId, asset.asset_id, slot);
    });
  const uploadAndSetMusic = (file) =>
    musicAction(async () => {
      const asset = await uploadOne(file);
      return api.setMusic(asset.asset_id);
    });

  /** A library asset dropped on the timeline: onto a clip, onto Music, or between scenes (new scene at `index`). */
  const dropAsset = (assetId, target, index) => {
    const asset = library.find((a) => a.asset_id === assetId);
    if (!asset) return;
    if (target?.track === 'music') setMusicAsset(asset);
    else if (target?.sceneId != null) placeAsset(target.sceneId, target.track, asset);
    else addAssetAsScene(asset, index);
  };

  /** Files from the computer dropped on the timeline go to the library; onto a specific clip they're also used there. */
  const dropFiles = async (files, target) => {
    const created = await uploadFiles(files);
    const asset = created[0];
    if (!asset || !target) return;
    if (target.track === 'music') setMusicAsset(asset);
    else if (target.sceneId != null) placeAsset(target.sceneId, target.track, asset);
  };

  const importScript = (script, mode) => {
    if (mode === 'replace' && scenes.length && !window.confirm('Replace all scenes with the imported script? You can undo this.')) return;
    return run(async () => {
      const data = await api.importScript(script, mode);
      applyServer(data);
      setShowImport(false);
      if (mode === 'replace') setSelectedId(data.scenes[0]?.scene_id ?? null);
      seek(0);
      notify(`Script imported: ${data.scenes.length} scenes`, 'success');
    });
  };

  // ---- Background jobs (export / generate all) --------------------------------------------------

  const startJob = (fn) =>
    run(async () => {
      setJob(await fn());
    });

  // From the Generate missing dialog: only the items ticked there.
  const generatePicked = (ids) =>
    run(async () => {
      setJob(await api.generateMissing(ids));
      setShowGenerate(false);
    });

  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = setInterval(async () => {
      try {
        const j = await api.job();
        setJob(j);
        if (j.kind === 'generate') await reload();
        if (j.status === 'done' && j.kind === 'export') {
          setExportUrl(j.result.url);
          setPreviewMode('rendered');
          setPlaying(false);
          notify('Export finished: final_output.mp4', 'success');
        }
        if (j.status === 'done' && j.kind === 'generate') {
          const summary = describeGeneration(j.result);
          notify(summary.text, summary.ok ? 'success' : 'error', summary.outOfCredits ? { label: 'Generate missing', onClick: () => setShowGenerate(true) } : null);
        }
      } catch {
        // Server restarting; keep polling.
      }
    }, 800);
    return () => clearInterval(t);
  }, [job?.status, job?.id, reload, notify]);

  // ---- Context menus ----------------------------------------------------------------------------

  const openMenu = (e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const clipMenuItems = (sceneId, slot) => {
    const i = scenes.findIndex((s) => s.scene_id === sceneId);
    const scene = scenes[i];
    if (!scene) return [];
    const has = slot === 'image' ? Boolean(scene.image_url || scene.video_url) : Boolean(scene[`${slot}_url`]);
    const canGenerate = Boolean(scene[SLOT_PROMPT[slot]]?.trim());
    const slotBusy = Boolean(busy[`${sceneId}:${slot}`]);
    const label = slot === 'image' && scene.video_url ? 'video' : SLOT_LABEL[slot];
    const imageInLibrary = library.some((a) => a.url === scene.image_url);
    return [
      { heading: `Scene ${i + 1}` },
      {
        label: `${has && !scene.video_url ? 'Regenerate' : 'Generate'} ${SLOT_LABEL[slot]}`,
        icon: has ? RefreshCw : SLOT_ICON[slot],
        disabled: !canGenerate || slotBusy,
        onClick: () => regenerateWithConfirm(scene, slot),
      },
      ...(slot === 'image' && scene.image_url && !imageInLibrary
        ? [{ label: 'Save image to library', icon: BookmarkPlus, onClick: () => saveSceneToLibrary(sceneId) }]
        : []),
      { label: `Remove ${label}`, icon: X, disabled: !has || slotBusy, onClick: () => clearSlot(sceneId, slot) },
      '-',
      { label: 'Copy prompts', icon: ClipboardCopy, shortcut: `${MOD_KEY}C`, onClick: () => copyPrompts(sceneId) },
      pasteItem([sceneId]),
      '-',
      { label: 'Insert scene after', icon: Plus, onClick: () => addScene(sceneId) },
      { label: 'Duplicate scene', icon: Copy, shortcut: `${MOD_KEY}D`, onClick: () => duplicateScene(sceneId) },
      { label: 'Move earlier', icon: ArrowLeft, disabled: i === 0, onClick: () => moveScene(sceneId, -1) },
      { label: 'Move later', icon: ArrowRight, disabled: i === scenes.length - 1, onClick: () => moveScene(sceneId, 1) },
      '-',
      { label: 'Delete scene', icon: Trash2, danger: true, shortcut: 'Del', onClick: () => deleteScene(sceneId) },
    ];
  };

  const musicMenuItems = () => [
    { label: 'Music settings', icon: Settings2, onClick: () => setSidebarTab('music') },
    { label: 'Remove music', icon: X, danger: true, disabled: !sb.settings.music_url || Boolean(busy.music), onClick: removeMusic },
  ];

  const assetMenuItems = (asset) => {
    const visual = assetFits(asset, 'image');
    const target = selected ? `scene ${selectedIndex + 1}` : null;
    const use = (slot, label, icon) =>
      assetFits(asset, slot) && target ? [{ label: `${label} in ${target}`, icon, onClick: () => placeAsset(selected.scene_id, slot, asset) }] : [];
    return [
      { heading: asset.name },
      ...(visual
        ? [
            { label: 'Add as new scene at end', icon: Plus, onClick: () => addAssetAsScene(asset) },
            ...(target ? [{ label: `Insert after ${target}`, icon: Plus, onClick: () => addAssetAsScene(asset, selectedIndex + 1) }] : []),
            ...use('image', 'Use as picture', ImageIcon),
          ]
        : []),
      ...use('voiceover', 'Use as voiceover', AudioLines),
      ...use('sfx', 'Use as sound effect', Sparkles),
      ...(assetFits(asset, 'music') ? [{ label: 'Use as background music', icon: Music, onClick: () => setMusicAsset(asset) }] : []),
      ...(asset.type === 'video' ? [{ label: 'Take a snapshot…', icon: Camera, onClick: () => requestSnapshot(asset) }] : []),
      '-',
      { label: 'Rename…', icon: Pencil, onClick: () => renameAsset(asset) },
      { label: 'Delete from library', icon: Trash2, danger: true, onClick: () => deleteAsset(asset) },
    ];
  };

  const pasteItem = (ids) => ({
    label: copiedPrompts
      ? `Paste prompts of scene ${copiedPrompts.from}${ids.length > 1 ? ` into ${ids.length} scenes` : ''}`
      : 'Paste prompts',
    icon: ClipboardPaste,
    shortcut: `${MOD_KEY}V`,
    disabled: !copiedPrompts,
    onClick: () => pastePrompts(ids),
  });

  const groupMenuItems = (ids, sceneId) => [
    { heading: `${ids.length} scenes selected` },
    { label: 'Copy prompts of this scene', icon: ClipboardCopy, shortcut: `${MOD_KEY}C`, onClick: () => copyPrompts(sceneId) },
    pasteItem(ids),
    '-',
    { label: `Duplicate ${ids.length} scenes`, icon: Copy, shortcut: `${MOD_KEY}D`, onClick: () => duplicateScenes(ids) },
    { label: 'Select only this scene', icon: SquareDashedMousePointer, onClick: () => selectScene(sceneId, { seekTo: false }) },
    '-',
    { label: `Delete ${ids.length} scenes`, icon: Trash2, danger: true, shortcut: 'Del', onClick: () => deleteScenes(ids) },
  ];

  actions.current.clipMenu = (e, sceneId, slot) => {
    // Right-clicking inside a multi-selection acts on all of it; anywhere else selects just that scene.
    if (selectedIds.length > 1 && selectedIds.includes(sceneId)) {
      setSelectedId(sceneId);
      return openMenu(e, groupMenuItems(selectedIds, sceneId));
    }
    selectScene(sceneId, { seekTo: false });
    openMenu(e, clipMenuItems(sceneId, slot));
  };
  // Stable so the memoized timeline clips don't re-render on every App render.
  const onClipMenu = useCallback((e, sceneId, slot) => actions.current.clipMenu(e, sceneId, slot), []);
  const onResizeScene = useCallback((id, d) => patchScene(id, { duration_sec: d }), [patchScene]);

  // ---- Projects ---------------------------------------------------------------------------------
  // Switching saves pending edits, asks the server to open the other project, then reloads the page.

  const switchProject = (id) =>
    run(async () => {
      await api.openProject(id);
      window.location.reload();
    });

  const newProject = () => {
    const title = window.prompt('Name of the new video project:');
    if (!title?.trim()) return;
    run(async () => {
      await api.createProject(title.trim(), true);
      window.location.reload();
    });
  };

  const openProjectMenu = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let projects = [];
    try {
      ({ projects } = await api.projects());
    } catch (err) {
      return notify(err.message);
    }
    setMenu({
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        { heading: 'Projects' },
        ...projects.map((p) => ({
          label: p.title,
          icon: p.open ? Check : Clapperboard,
          shortcut: `${p.scenes} scene${p.scenes === 1 ? '' : 's'}`,
          onClick: () => !p.open && switchProject(p.id),
        })),
        '-',
        { label: 'New project…', icon: FolderPlus, onClick: newProject },
      ],
    });
  };

  // ---- Render -----------------------------------------------------------------------------------

  if (!sb) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        {loadError ? (
          <div className="text-center">
            <p className="text-red-400">Could not reach the backend: {loadError}</p>
            <p className="mt-1">Is the API running? Start everything with <code className="text-zinc-300">npm run dev</code>.</p>
            <button className="btn-secondary mt-4" onClick={reload}>Retry</button>
          </div>
        ) : (
          'Loading storyboard…'
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title={sb.settings.title}
        status={status}
        job={job}
        missing={countMissing(scenes)}
        videos={scenes.filter(wantsVideo).length}
        exportUrl={exportUrl}
        onImport={() => setShowImport(true)}
        onGenerateMissing={() => setShowGenerate(true)}
        onExport={() => startJob(api.exportVideo)}
        onDismissJob={() => setJob(null)}
        history={history}
        onOpenProjects={openProjectMenu}
        undoShortcut={`${MOD_KEY}Z`}
        redoShortcut={MOD_KEY === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'}
        onUndo={() => actions.current.undo()}
        onRedo={() => actions.current.redo()}
      />

      <ModelCatalogProvider status={status} onError={notify}>
      <div className="flex min-h-0 flex-1">
        <LeftPanel
          tab={leftTab}
          onTab={showLeftTab}
          collapsed={libraryCollapsed}
          onToggle={() => {
            localStorage.setItem('libraryCollapsed', libraryCollapsed ? '0' : '1');
            setLibraryCollapsed(!libraryCollapsed);
          }}
          width={leftWidth}
          onResize={setLeftWidth}
          resize={LEFT_PANEL}
          libraryCount={library.length}
          uploading={uploading}
          onUploadFiles={uploadFiles}
          library={
            <AssetLibrary
              library={library}
              usage={usage}
              uploading={uploading}
              onUploadFiles={uploadFiles}
              onDelete={deleteAsset}
              onRename={renameAsset}
              onSnapshot={(asset) => requestSnapshot(asset)}
              onAddAsScene={(asset) => addAssetAsScene(asset)}
              onSetMusic={setMusicAsset}
              onDragAsset={setDragAsset}
              onAssetMenu={(e, asset) => openMenu(e, assetMenuItems(asset))}
            />
          }
          project={
            <ProjectSettings
              settings={sb.settings}
              onChange={patchSettings}
              status={status}
              library={library}
              onRequestSnapshot={(asset) => requestSnapshot(asset, 'reference for every scene')}
              onUploadFiles={uploadFiles}
            />
          }
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <Preview
            scenes={scenes}
            starts={starts}
            total={total}
            time={time}
            seekToken={seekToken}
            setTime={setTime}
            seek={seek}
            playing={playing}
            setPlaying={setPlaying}
            settings={sb.settings}
            mode={previewMode}
            setMode={setPreviewMode}
            exportUrl={exportUrl}
          />
          <Timeline
            scenes={scenes}
            starts={starts}
            total={total}
            time={time}
            playing={playing}
            seek={seek}
            selectedIds={selectedIds}
            onSelect={clickScene}
            onResize={onResizeScene}
            onAdd={() => addScene()}
            onDropFiles={dropFiles}
            onDropAsset={dropAsset}
            dragAsset={dragAsset}
            settings={sb.settings}
            onSelectMusic={() => setSidebarTab('music')}
            onClipMenu={onClipMenu}
            onReorder={reorderScenes}
            onInsert={insertSceneAt}
            onMusicMenu={(e) => openMenu(e, musicMenuItems())}
            busy={busy}
          />
        </main>

        <aside className="relative flex shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/40" style={{ width: rightWidth }}>
          <PanelResizer edge="left" width={rightWidth} onResize={setRightWidth} {...RIGHT_PANEL} />
          <div className="flex shrink-0 gap-1 border-b border-zinc-800 p-1.5" role="tablist">
            {[
              ['visual', 'Visual', ImageIcon, 'text-image'],
              ['voice', 'Voice', AudioLines, 'text-voice'],
              ['sfx', 'SFX', Sparkles, 'text-sfx'],
              ['music', 'Music', Music, 'text-fuchsia-400'],
            ].map(([key, label, Icon, color]) => (
              <button
                key={key}
                role="tab"
                aria-selected={sidebarTab === key}
                onClick={() => setSidebarTab(key)}
                className={`btn flex-1 px-2 ${sidebarTab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
              >
                <Icon className={`size-3.5 ${sidebarTab === key ? color : ''}`} /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sidebarTab !== 'music' && selectedIds.length > 1 && (
              <div className="flex items-center gap-1 border-b border-zinc-800 bg-indigo-500/10 px-4 py-2 text-xs text-indigo-200">
                <span className="mr-auto font-medium">{selectedIds.length} scenes selected</span>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => duplicateScenes(selectedIds)} title={`Duplicate (${MOD_KEY}D)`}>
                  <Copy className="size-3.5" /> Duplicate
                </button>
                <button className="btn-ghost px-2 py-1 text-xs hover:!text-red-400" onClick={() => deleteScenes(selectedIds)} title="Delete (Del)">
                  <Trash2 className="size-3.5" /> Delete
                </button>
                <button className="icon-btn size-6" onClick={() => selectScene(selectedId, { seekTo: false })} title="Clear selection (Esc)" aria-label="Clear selection">
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {sidebarTab === 'music' ? (
              <div className="px-4 py-4">
                <MusicSettings
                  settings={sb.settings}
                  onChange={patchSettings}
                  busy={Boolean(busy.music)}
                  onUpload={uploadAndSetMusic}
                  onRemove={removeMusic}
                />
                <p className="mt-3 text-[11px] text-zinc-600">One track for the whole video. You can also drop a sound from the library onto the Music row of the timeline.</p>
              </div>
            ) : selected ? (
              <Inspector
                key={selected.scene_id}
                scene={selected}
                tab={sidebarTab}
                previousScene={scenes[selectedIndex - 1]}
                index={selectedIndex}
                count={scenes.length}
                start={starts[selectedIndex]}
                settings={sb.settings}
                library={library}
                busy={busy}
                errors={errors}
                onRequestSnapshot={(asset) => requestSnapshot(asset, `reference for scene ${selectedIndex + 1}`)}
                onUploadFiles={uploadFiles}
                onSaveToLibrary={() => saveSceneToLibrary(selected.scene_id)}
                onOpenProject={openProjectSettings}
                onChange={(patch) => patchScene(selected.scene_id, patch)}
                onRegenerate={(kind) => regenerate(selected.scene_id, kind)}
                onGenerateVideo={() => generateVideo(selected)}
                onChangeSettings={patchSettings}
                onGenerateSfxLayer={(layerId) => generateSfxLayer(selected.scene_id, layerId)}
                onUploadSfxLayer={(layerId, file) => uploadSfxLayer(selected.scene_id, layerId, file)}
                onGenerateShot={(shotId) => generateShot(selected.scene_id, shotId)}
                onUploadShot={(shotId, file) => uploadShot(selected.scene_id, shotId, file)}
                onUpload={(slot, file) => uploadAndUse(selected.scene_id, slot, file)}
                onClear={(slot) => clearSlot(selected.scene_id, slot)}
                onDelete={() => deleteScene(selected.scene_id)}
                onDuplicate={() => duplicateScene(selected.scene_id)}
                onMove={(dir) => moveScene(selected.scene_id, dir)}
              />
            ) : (
              <div className="p-6 text-center text-sm text-zinc-500">
                <p>No scenes yet.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <button className="btn-secondary" onClick={() => addScene()}>Add a scene</button>
                  <button className="btn-primary" onClick={() => setShowImport(true)}>Import a script</button>
                </div>
                <p className="mt-4 text-xs text-zinc-600">Or drag images and videos from the library onto the timeline.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {showGenerate && (
        <GenerateDialog
          settings={sb.settings}
          onChangeSettings={patchSettings}
          status={status}
          onCancel={() => setShowGenerate(false)}
          onGenerate={generatePicked}
        />
      )}
      </ModelCatalogProvider>

      {snapshotTarget && (
        <SnapshotModal asset={snapshotTarget.asset} purpose={snapshotTarget.purpose} onCancel={cancelSnapshot} onCapture={captureSnapshot} />
      )}

      {menu && <ContextMenu key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {showImport && <ScriptImport hasScenes={scenes.length > 0} onClose={() => setShowImport(false)} onImport={importScript} />}

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-2xl ${
            {
              error: 'border-red-500/40 bg-red-950 text-red-200',
              success: 'border-emerald-500/40 bg-emerald-950 text-emerald-200',
              info: 'border-zinc-700 bg-zinc-900 text-zinc-200',
            }[toast.tone]
          }`}
        >
          {toast.message}
          {toast.action && (
            <button
              className="ml-3 font-semibold underline-offset-2 hover:underline"
              onClick={() => {
                setToast(null);
                toast.action.onClick();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
