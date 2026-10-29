import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
/** Every project (one video each) is a folder in here. */
export const PROJECTS_DIR = path.resolve(ROOT, process.env.PROJECTS_DIR || 'projects');

// The open project's folders. These are live ESM bindings: openProject() in projects.js re-points
// them, and every module reads them at call time, so they always refer to the open project.
export let PROJECT_ID = null;
export let PROJECT_DIR = null;
export let STORYBOARD_PATH = null;
export let MEDIA_DIR = null;
export let CLIPS_DIR = null;
export let EXPORTS_DIR = null;

export function setProjectPaths(id) {
  PROJECT_ID = id;
  PROJECT_DIR = path.join(PROJECTS_DIR, id);
  STORYBOARD_PATH = path.join(PROJECT_DIR, 'storyboard.json');
  MEDIA_DIR = path.join(PROJECT_DIR, 'media');
  CLIPS_DIR = path.join(PROJECT_DIR, 'clips');
  EXPORTS_DIR = path.join(PROJECT_DIR, 'exports');
}

/** Map a public "/media/..." URL back to a file on disk. Returns null for anything outside MEDIA_DIR. */
export function mediaUrlToPath(url) {
  if (!url || !url.startsWith('/media/')) return null;
  const clean = decodeURIComponent(url.split('?')[0].slice('/media/'.length));
  const file = path.resolve(MEDIA_DIR, clean);
  return file.startsWith(MEDIA_DIR + path.sep) ? file : null;
}

export function mediaPathToUrl(file) {
  return '/media/' + path.relative(MEDIA_DIR, file).split(path.sep).join('/');
}
