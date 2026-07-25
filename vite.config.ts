import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/okobaudat-api': {
          target: 'https://oekobaudat.de/OEKOBAU.DAT',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/okobaudat-api/, ''),
        },
        '/api/section-export': {
          target: 'http://localhost:3901',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/section-export/, ''),
        },
        '/api/material-autofill': {
          target: 'http://localhost:3902',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/material-autofill/, ''),
        },
        '/api/routing': {
          target: 'http://localhost:3903',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/routing/, ''),
        },
      },
    },
  };
});
