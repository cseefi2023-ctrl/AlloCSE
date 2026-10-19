// Liste les espaces configurés dans public/config.js (utilisé par les workflows GitHub).
// Sortie : une ligne par espace « clé url clé_publique demo|- ». Option --demo : seulement les démonstrations.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const sandbox = { window: {} }
vm.runInNewContext(readFileSync(new URL('../public/config.js', import.meta.url), 'utf8'), sandbox)
const raw = sandbox.window.ALLOCSE_CONFIG || {}
const tenants = raw.tenants || (raw.supabaseUrl ? { principal: raw } : {})
const onlyDemo = process.argv.includes('--demo')
for (const [key, t] of Object.entries(tenants)) {
  if (!t.supabaseUrl || !t.supabaseAnonKey || /VOTRE|YOUR|XXX/i.test(t.supabaseUrl + t.supabaseAnonKey)) continue
  if (onlyDemo && !t.demo) continue
  console.log([key, t.supabaseUrl.replace(/\/+$/, ''), t.supabaseAnonKey, t.demo ? 'demo' : '-'].join(' '))
}
