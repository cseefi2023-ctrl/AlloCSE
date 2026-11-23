import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
let commit = (process.env.GITHUB_SHA || '').slice(0, 7)
if (!commit) { try { commit = execSync('git rev-parse --short HEAD').toString().trim() } catch { commit = '' } }
const built = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })

// Règles de sécurité de la page publiée. GitHub Pages ne permet pas d'envoyer des en-têtes HTTP :
// elles sont donc écrites dans index.html, au moment de la construction (pas en développement, où
// Vite a besoin de scripts intégrés à la page).
//  - Content-Security-Policy : seuls les scripts de l'application s'exécutent, et la page ne
//    dialogue qu'avec Supabase (adresses de public/config.js) ;
//  - referrer : l'adresse de la page n'est jamais transmise aux sites tiers.
function securityMeta() {
  const extra = new Set()
  try {
    const cfg = readFileSync(new URL('./public/config.js', import.meta.url), 'utf8')
    for (const [, origin] of cfg.matchAll(/supabaseUrl:\s*['"](https?:\/\/[^'"/]+)/g)) {
      if (!/\.supabase\.co$/.test(origin) && !/VOTRE|YOUR|XXX/i.test(origin)) extra.add(origin)
    }
  } catch { /* pas de configuration : Supabase seul */ }
  const sockets = [...extra].map((o) => o.replace(/^http/, 'ws'))
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // MUI place ses styles dans la page
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    ["connect-src 'self' https://*.supabase.co wss://*.supabase.co", ...extra, ...sockets].join(' '),
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'allocse-securite',
    apply: 'build',
    transformIndexHtml(html) {
      const tags = `\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />` +
        '\n    <meta name="referrer" content="no-referrer" />'
      if (!/<meta charset="UTF-8" \/>/.test(html)) throw new Error('index.html : <meta charset> introuvable')
      return html.replace(/<meta charset="UTF-8" \/>/, (m) => m + tags)
    },
  }
}

// base './' : l'application fonctionne quel que soit le nom du dépôt GitHub
// (https://<compte>.github.io/<depot>/).
export default defineConfig({
  base: './',
  plugins: [react(), securityMeta()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify([built, commit].filter(Boolean).join(' · ')),
  },
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
})
