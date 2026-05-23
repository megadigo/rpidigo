import { defineConfig } from 'vite'

export default defineConfig({
  base: './',   // relative asset paths — works in any subdirectory on any host
  server: {
    port: 5173,
  },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 5000,
  },
})
