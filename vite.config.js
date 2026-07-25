import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // <-- Add this line here
  server: {
    proxy: {
      '/okobaudat-api': {
        target: 'https://oekobaudat.de/OEKOBAU.DAT',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/okobaudat-api/, ''),
      },
      '/api/section-export': {
        target: 'http://localhost:3901',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/section-export/, ''),
      },
      '/api/material-autofill': {
        target: 'http://localhost:3902',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/material-autofill/, ''),
      },
      '/api/routing': {
        target: 'http://localhost:3903',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/routing/, ''),
      },
    },
  },
})