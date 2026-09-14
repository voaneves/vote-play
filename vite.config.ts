import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /**
   * Subdiretório do GitHub Pages. Ao migrar para domínio próprio (Fase 7 do plan.md),
   * trocar por '/' — o basename do router lê este mesmo valor via import.meta.env.BASE_URL.
   */
  base: '/vote-play/',

  server: {
    host: '::',
    port: 8080,
  },

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
