import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECTS_DIR, PROJECT_ID } from './paths.js';
import { subscription } from './elevenlabs.js';

// Every paid API call the editor makes is logged here, for all projects, with what the provider
// reported about it (tokens, credits, run time). Costs are worked out when the log is read, from
// the price table below plus the user's own prices, so fixing a price fixes past entries too.

const LOG_PATH = path.join(PROJECTS_DIR, '.usage.jsonl');
const PRICES_PATH = path.join(PROJECTS_DIR, '.prices.json');

// USD. Gemini: per 1M tokens (ai.google.dev/gemini-api/docs/pricing, paid tier, Oct 2026).
// Replicate: per output image for models with a fixed price (replicate.com/pricing).
// ElevenLabs: per 1,000 credits; the API's pay-as-you-go rate (plans differ).
const NANO_BANANA_PRO = { input: 2, text_output: 12, image_output: 120 };
const NANO_BANANA_2 = { input: 0.5, text_output: 3, image_output: 60 };
export const DEFAULT_PRICES = {
  'gemini:gemini-3-pro-image': NANO_BANANA_PRO,
  'gemini:gemini-3-pro-image-preview': NANO_BANANA_PRO,
  'gemini:nano-banana-pro-preview': NANO_BANANA_PRO,
  'gemini:gemini-3.1-flash-image': NANO_BANANA_2,
  'gemini:gemini-3.1-flash-image-preview': NANO_BANANA_2,
  'gemini:gemini-3.1-flash-lite-image': { input: 0.25, text_output: 1.5, image_output: 30 },
  'gemini:gemini-2.5-flash-image': { input: 0.3, image_output: 30 },
  // Image check (vision). The alias follows Google's latest Flash model; priced as Gemini 3 Flash.
  'gemini:gemini-flash-latest': { input: 0.5, text_output: 3 },
  'gemini:gemini-omni-1.1-flash': { input: 1.5, text_output: 9, video_output: 17.5 },
  'black-forest-labs/flux-schnell': { per_image: 0.003 },
  'black-forest-labs/flux-dev': { per_image: 0.025 },
  'black-forest-labs/flux-1.1-pro': { per_image: 0.04 },
  elevenlabs: { per_1k_credits: 0.08 },
};

/** Which price fields apply to an entry, by provider (used by the price editor). */
export const PRICE_FIELDS = {
  gemini: ['input', 'text_output', 'image_output', 'video_output'],
  replicate: ['per_image', 'per_second'],
  elevenlabs: ['per_1k_credits'],
};

async function readPrices() {
  try {
    return JSON.parse(await fs.readFile(PRICES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** The price table: defaults overlaid with the user's prices. */
export async function prices() {
  const own = await readPrices();
  const keys = new Set([...Object.keys(DEFAULT_PRICES), ...Object.keys(own)]);
  return Object.fromEntries([...keys].map((k) => [k, { ...DEFAULT_PRICES[k], ...own[k] }]));
}

/** Set (or with null, clear) the user's price for `key` (a model id, or "elevenlabs"). */
export async function setPrice(key, price) {
  if (typeof key !== 'string' || !key || key.length > 200) throw Object.assign(new Error('key must be a model id'), { status: 400 });
  const own = await readPrices();
  if (price === null) delete own[key];
  else {
    if (typeof price !== 'object' || Array.isArray(price)) throw Object.assign(new Error('price must be an object'), { status: 400 });
    const clean = {};
    for (const [field, value] of Object.entries(price)) {
      if (value === null || value === '') continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${field} must be a number of 0 or more`), { status: 400 });
      clean[field] = n;
    }
    own[key] = clean;
  }
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.writeFile(PRICES_PATH, JSON.stringify(own, null, 2) + '\n');
  return prices();
}

let chain = Promise.resolve();

/**
 * Log one API call: { provider, kind, model, scene_id, units }. `units` holds what the provider
 * reported, e.g. { input_tokens, image_output_tokens }, { credits, characters } or { images, predict_time }.
 * Never throws: a logging problem mustn't fail a generation that already succeeded (and was paid for).
 */
export function recordUsage(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), project: PROJECT_ID, ...entry }) + '\n';
  chain = chain
    .then(() => fs.mkdir(PROJECTS_DIR, { recursive: true }))
    .then(() => fs.appendFile(LOG_PATH, line))
    .catch((err) => console.warn(`Couldn't log API usage: ${err.message}`));
  return chain;
}

const perM = (tokens, price) => ((tokens || 0) * (price || 0)) / 1e6;

/** Cost of one entry in USD, or null when a price it needs isn't known. */
export function costOf(entry, table) {
  const u = entry.units || {};
  const p = entry.provider === 'elevenlabs' ? table.elevenlabs : table[entry.model];
  if (!p) return null;
  switch (entry.provider) {
    case 'gemini': {
      const needs = [
        [u.input_tokens, p.input],
        [u.text_output_tokens, p.text_output],
        [u.image_output_tokens, p.image_output],
        [u.video_output_tokens, p.video_output],
      ];
      if (needs.some(([tokens, price]) => tokens > 0 && price == null)) return null;
      return needs.reduce((sum, [tokens, price]) => sum + perM(tokens, price), 0);
    }
    case 'replicate':
      if (p.per_image != null) return (u.images ?? 1) * p.per_image;
      if (p.per_second != null && u.predict_time != null) return u.predict_time * p.per_second;
      return null;
    case 'elevenlabs':
      return u.credits != null && p.per_1k_credits != null ? (u.credits / 1000) * p.per_1k_credits : null;
    default:
      return null;
  }
}

const BALANCE_TTL_MS = 60_000;
let balanceCache = null;

/**
 * What's left on each account, where the provider's API says: ElevenLabs credits (needs the key's
 * user_read permission). Replicate's API and Gemini API keys can't read balances or billing.
 */
export async function accountBalances() {
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value;
  const elevenlabs = process.env.ELEVENLABS_API_KEY
    ? await subscription().then((s) => ({ ok: true, ...s })).catch((err) => ({ ok: false, error: err.message }))
    : { ok: false, error: 'ELEVENLABS_API_KEY is not set' };
  const value = {
    elevenlabs,
    replicate: { ok: false, error: "Replicate's API doesn't report your credit balance." },
    gemini: { ok: false, error: 'A Gemini API key can\'t read billing. Your balance and spend are in Google Cloud Billing.' },
  };
  balanceCache = { at: Date.now(), value };
  return value;
}

/** The whole log, newest first, each entry with its `cost_usd` (null if unknown), plus the prices used. */
export async function usageReport() {
  let text = '';
  try {
    text = await fs.readFile(LOG_PATH, 'utf8');
  } catch {
    // Nothing logged yet.
  }
  const table = await prices();
  const entries = text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((e) => ({ ...e, cost_usd: costOf(e, table) }))
    // Newest first (estimated entries for older generations were added later, out of order).
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { entries, prices: table, price_fields: PRICE_FIELDS };
}
