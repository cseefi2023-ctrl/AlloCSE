import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
let commit = (process.env.GITHUB_SHA || '').slice(0, 7)
if (!commit) { try { commit = execSync('git rev-parse --short HEAD').toString().trim() } catch { commit = '' } }
const built = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })

// base './' : l'application fonctionne quel que soit le nom du dépôt GitHub
// (https://<compte>.github.io/<depot>/).
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify([built, commit].filter(Boolean).join(' · ')),
  },
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
})
