// Espace CSE ouvert : chaque entreprise cliente a sa propre base Supabase, séparée des autres.
// Le lien choisit l'espace : …/AlloCSE/?cse=efi . Sans paramètre : le dernier espace ouvert
// sur cet appareil, sinon l'espace par défaut (la démonstration, pour les prospects).
const LAST_KEY = 'allocse.espace'

function safeGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value) } catch { /* stockage indisponible */ }
}

const raw = (typeof window !== 'undefined' && window.ALLOCSE_CONFIG) || {}
// Ancienne configuration à un seul espace (supabaseUrl à la racine) : toujours acceptée
const TENANTS = raw.tenants || (raw.supabaseUrl
  ? { principal: { name: raw.name || 'AlloCSE', supabaseUrl: raw.supabaseUrl, supabaseAnonKey: raw.supabaseAnonKey } }
  : {})

const isConfigured = (t) => Boolean(t?.supabaseUrl && t?.supabaseAnonKey && !/VOTRE|YOUR|XXX/i.test(t.supabaseUrl + t.supabaseAnonKey))

function resolve() {
  const asked = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('cse') : null
  if (asked) return asked.trim().toLowerCase()
  const last = safeGet(LAST_KEY)
  if (last && TENANTS[last]) return last
  return raw.default && TENANTS[raw.default] ? raw.default : Object.keys(TENANTS)[0] || ''
}

const key = resolve()
const entry = TENANTS[key]

export const tenant = {
  key,
  name: entry?.name || 'AlloCSE',
  supabaseUrl: entry?.supabaseUrl,
  supabaseAnonKey: entry?.supabaseAnonKey,
  known: Boolean(entry),
  configured: isConfigured(entry),
  demo: Boolean(entry?.demo),
}

if (tenant.known) safeSet(LAST_KEY, key)

// Adresse de l'application pour cet espace (liens partagés, retours des e-mails)
export const appBaseUrl = () => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}?cse=${encodeURIComponent(tenant.key)}`
}

// Clé de stockage propre à l'espace : les sessions et numéros de suivi ne se mélangent pas
export const tenantStorageKey = (name) => `allocse.${tenant.key}.${name}`
