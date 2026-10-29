import { prices } from './usage.js';
import { OMNI_TOKENS_PER_SECOND } from './gemini.js';

// What one generation is expected to cost, before it's made. Prices come from the editor's own table
// (usage.js plus the user's prices in the Usage panel), so an estimate and the Usage log agree. What
// each generation uses is worked out here:
//   ElevenLabs voice: credits per character, by model (ElevenLabs model docs, Oct 2026).
//   ElevenLabs sound: credits per second asked for (measured in this editor's usage log, Oct 2026).
//   Gemini image: output tokens per image by size (ai.google.dev pricing); input ≈ prompt + references.
//   Gemini Omni video: OMNI_TOKENS_PER_SECOND (720p), for the seconds asked for.
const HALF_CREDIT_TTS = /turbo|flash/;
const SFX_CREDITS_PER_SEC = 10;
const IMAGE_INPUT_TOKENS = 1120; // per reference image sent to a Gemini model
// An image check sends the picture plus about 300 tokens of instructions and gets a short JSON answer.
const CHECK_INPUT_TOKENS = 1120 + 300;
const CHECK_OUTPUT_TOKENS = 150;
const imageOutputTokens = (model, params = {}) =>
  /2\.5-flash-image/.test(model) ? 1290 : params.imageSize === '4K' ? 2000 : 1120;

/**
 * A cost calculator for a project's settings. Each method returns { usd } (null when the model has no
 * price; it's then added to `unpriced`), plus what it's based on.
 */
export async function costEstimator(settings) {
  const table = await prices();
  const elevenlabs = table.elevenlabs?.per_1k_credits;
  const unpriced = new Set();
  const perM = (tokens, price) => (tokens * (price || 0)) / 1e6;
  const credits = (n) => (elevenlabs == null ? null : (n / 1000) * elevenlabs);
  const missing = (model) => (unpriced.add(model), null);

  return {
    unpriced,
    elevenlabsRate: elevenlabs ?? null,

    /**
     * A picture from `prompt` with `refs` reference images (the reference model is used when there are any),
     * plus its image check if the project has one on (the first attempt; a retry costs it all again).
     */
    image(prompt, refs) {
      const picture = this.picture(prompt, refs);
      const checkModel = settings.image_check ? settings.image_check_model : null;
      if (!checkModel || picture.usd == null) return picture;
      const p = table[checkModel];
      if (!p) return { ...picture, usd: missing(checkModel) };
      return { ...picture, usd: picture.usd + perM(CHECK_INPUT_TOKENS, p.input) + perM(CHECK_OUTPUT_TOKENS, p.text_output) };
    },

    picture(prompt, refs) {
      const model = refs ? settings.reference_model : settings.image_model;
      const fullPrompt = prompt + (settings.style_prompt ? `. ${settings.style_prompt}` : '');
      const p = table[model];
      if (!p) return { model, usd: missing(model) };
      if (model.startsWith('gemini:')) {
        if (p.image_output == null) return { model, usd: missing(model) };
        const input = Math.ceil(fullPrompt.length / 4) + refs * IMAGE_INPUT_TOKENS;
        return { model, usd: perM(input, p.input) + perM(imageOutputTokens(model, settings.image_params?.[model]), p.image_output) };
      }
      return { model, usd: p.per_image ?? missing(model) };
    },

    voice(text) {
      const c = text.trim().length * (HALF_CREDIT_TTS.test(settings.tts_model) ? 0.5 : 1);
      return { model: settings.tts_model, credits: c, usd: credits(c) };
    },

    /** A sound effect `sec` seconds long (clamped to what ElevenLabs makes). */
    sfx(sec) {
      const c = Math.min(30, Math.max(0.5, sec)) * SFX_CREDITS_PER_SEC;
      return { model: settings.sfx_model, credits: c, usd: credits(c) };
    },

    /** A video clip for a scene `sceneSec` long (the model's duration setting wins). */
    video(sceneSec) {
      const model = settings.video_model;
      const p = table[model];
      const sec = settings.video_params?.[model]?.duration_hint ?? Math.min(10, Math.max(3, sceneSec));
      return { model, sec, usd: p?.video_output != null ? perM(sec * OMNI_TOKENS_PER_SECOND, p.video_output) : missing(model) };
    },
  };
}
