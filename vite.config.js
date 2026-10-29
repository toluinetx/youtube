import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Same .env the API server reads (all keys, not just VITE_*).
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const api = `http://localhost:${env.PORT || 3001}`;

  return {
    root: 'client',
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.WEB_PORT) || 5173,
      proxy: {
        '/api': api,
        '/media': api,
        '/exports': api,
      },
    },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
