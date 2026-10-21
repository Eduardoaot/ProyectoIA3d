import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // three.js va en su propio archivo y solo se descarga al llegar al 3D.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
