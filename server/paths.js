import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const PROJECT_DIR = path.resolve(ROOT, process.env.PROJECT_DIR || 'project');
export const STORYBOARD_PATH = path.join(PROJECT_DIR, 'storyboard.json');
export const MEDIA_DIR = path.join(PROJECT_DIR, 'media');
export const CLIPS_DIR = path.join(PROJECT_DIR, 'clips');
export const EXPORTS_DIR = path.join(PROJECT_DIR, 'exports');
export const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

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
