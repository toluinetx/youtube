import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR, PROJECT_ID, ROOT, setProjectPaths } from './paths.js';
import { DEFAULT_SETTINGS, SEED_TITLE, readStoryboard, serialized } from './storyboard.js';
import { getJob } from './jobs.js';
import { broadcast } from './events.js';

// Each project (one video) is a folder in PROJECTS_DIR holding its own storyboard.json, media, render
// cache and exports. The server has one project open at a time; the editor and the API work on it.

const ACTIVE_PATH = path.join(PROJECTS_DIR, '.active');
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const conflict = (message) => Object.assign(new Error(message), { status: 409 });

function slugify(title) {
  const slug = String(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug || 'video';
}

function uniqueId(title) {
  const base = slugify(title);
  let id = base;
  for (let n = 2; fs.existsSync(path.join(PROJECTS_DIR, id)); n++) id = `${base}-${n}`;
  return id;
}

const storyboardOf = (id) => path.join(PROJECTS_DIR, id, 'storyboard.json');
const exists = (id) => ID.test(id) && fs.existsSync(storyboardOf(id));

/** Every project, most recently changed first: { id, title, scenes, duration_sec, aspect_ratio, updated_at, open }. */
export async function listProjects() {
  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const e of entries) {
    if (!e.isDirectory() || !exists(e.name)) continue;
    const file = storyboardOf(e.name);
    const { mtime } = await fsp.stat(file);
    let sb = {};
    try {
      sb = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      // Listed by folder name if its storyboard can't be read.
    }
    const scenes = Array.isArray(sb.scenes) ? sb.scenes : [];
    projects.push({
      id: e.name,
      title: sb.settings?.title || e.name,
      scenes: scenes.length,
      duration_sec: Math.round(scenes.reduce((t, s) => t + (Number(s.duration_sec) || 0), 0) * 10) / 10,
      aspect_ratio: sb.settings?.aspect_ratio || DEFAULT_SETTINGS.aspect_ratio,
      updated_at: mtime.toISOString(),
      open: e.name === PROJECT_ID,
    });
  }
  return projects.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Create an empty project called `title`. Resolves with its listing entry. */
export async function createProject(title) {
  const clean = String(title || '').trim().slice(0, 120);
  if (!clean) throw Object.assign(new Error('Give the project a title'), { status: 400 });
  const id = uniqueId(clean);
  await fsp.mkdir(path.join(PROJECTS_DIR, id), { recursive: true });
  const sb = { settings: { ...DEFAULT_SETTINGS, title: clean }, scenes: [], library: [] };
  await fsp.writeFile(storyboardOf(id), JSON.stringify(sb, null, 2) + '\n');
  return (await listProjects()).find((p) => p.id === id);
}

// Requests that change the open project (uploads, generations, edits) in progress. Switching projects
// waits for none, so a slow generation can never land in a different project.
let busy = 0;
export function trackBusy(req, res, next) {
  if (req.method === 'GET' || req.path.startsWith('/projects')) return next();
  busy++;
  res.on('close', () => busy--);
  next();
}

/** Make `id` the open project. Refuses while a job or another change is still running. */
export async function openProject(id) {
  if (!exists(id)) throw notFound(`No project "${id}"`);
  if (id === PROJECT_ID) return;
  const job = getJob();
  if (job.status === 'running') throw conflict(`Wait for the ${job.kind} job to finish before switching projects`);
  if (busy > 0) throw conflict('Wait for uploads and generations to finish before switching projects');
  await serialized(async () => {
    setProjectPaths(id);
    await fsp.writeFile(ACTIVE_PATH, id);
  });
  broadcast({ type: 'project', project: id });
}

/**
 * Pick the project to open at startup: the last one open, else the most recent, else a demo project.
 * A pre-projects `project/` folder (or PROJECT_DIR) is first moved into PROJECTS_DIR.
 */
export async function initProjects() {
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  await migrateLegacyProject();
  let id = await fsp.readFile(ACTIVE_PATH, 'utf8').then((s) => s.trim(), () => null);
  if (!id || !exists(id)) id = (await listProjects())[0]?.id;
  if (!id) {
    // First run: readStoryboard() seeds the demo storyboard.
    id = uniqueId(SEED_TITLE);
    setProjectPaths(id);
    await readStoryboard();
  }
  setProjectPaths(id);
  await fsp.writeFile(ACTIVE_PATH, id);
}

async function migrateLegacyProject() {
  const legacy = path.resolve(ROOT, process.env.PROJECT_DIR || 'project');
  if (legacy.startsWith(PROJECTS_DIR + path.sep) || !fs.existsSync(path.join(legacy, 'storyboard.json'))) return;
  let title = path.basename(legacy);
  try {
    title = JSON.parse(await fsp.readFile(path.join(legacy, 'storyboard.json'), 'utf8')).settings?.title || title;
  } catch {
    // Keep the folder name.
  }
  const id = uniqueId(title);
  try {
    await fsp.rename(legacy, path.join(PROJECTS_DIR, id));
    await fsp.writeFile(ACTIVE_PATH, id);
    console.log(`Moved ${path.relative(ROOT, legacy)}/ to ${path.relative(ROOT, PROJECTS_DIR)}/${id}/ (projects now live there)`);
  } catch (err) {
    console.warn(`  ! Could not move ${legacy} into ${PROJECTS_DIR}: ${err.message}. Move it there by hand to keep using it.`);
  }
}
