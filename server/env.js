import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Imported first by index.js so every other module sees the .env values.
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  // No .env yet: the UI shows which keys are missing.
}
