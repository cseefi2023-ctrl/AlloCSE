import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' : l'application fonctionne quel que soit le nom du dépôt GitHub
// (https://<compte>.github.io/<depot>/).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
})
