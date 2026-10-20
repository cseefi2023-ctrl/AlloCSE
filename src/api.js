// Accès aux données AlloCSE via Supabase.
//
// Les pages appellent `api('/meetings/12/items', { method: 'POST', body })` comme avec la
// version serveur : ce module traduit chaque route en appel aux fonctions SQL de
// supabase/schema.sql, qui portent toutes les règles (droits, visibilité, ODJ…).
import { createClient } from '@supabase/supabase-js'
import { buildWordDocument, missingMarkers } from './word'
import { appBaseUrl, tenant, tenantStorageKey } from './tenant'

export { tenant }
export const isConfigured = tenant.configured

export const supabase = isConfigured
  ? createClient(tenant.supabaseUrl, tenant.supabaseAnonKey, {
    // PKCE : les liens reçus par e-mail reviennent en ?code=… (compatible avec les routes en #)
    auth: { persistSession: true, storageKey: tenantStorageKey('auth'), flowType: 'pkce' },
  })
  : null

const CODES_KEY = tenantStorageKey('mesCodes')
function safeGet(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* stockage indisponible */ }
}

// Numéros de suivi déposés depuis cet appareil (confort uniquement)
export const myCodes = {
  list() {
    try { return JSON.parse(safeGet(CODES_KEY) || '[]') } catch { return [] }
  },
  add(code, subject) {
    const list = myCodes.list().filter((c) => c.code !== code)
    list.unshift({ code, subject, date: new Date().toISOString() })
    safeSet(CODES_KEY, JSON.stringify(list.slice(0, 20)))
  },
  remove(code) {
    safeSet(CODES_KEY, JSON.stringify(myCodes.list().filter((c) => c.code !== code)))
  },
}

// Coordonnées du salarié retenues sur cet appareil (nom, service, e-mail), pour ne pas les retaper
const IDENTITY_KEY = CODES_KEY + ':identite'
export const myIdentity = {
  get() {
    try { return JSON.parse(safeGet(IDENTITY_KEY) || 'null') } catch { return null }
  },
  save(v) { safeSet(IDENTITY_KEY, JSON.stringify(v)) },
  clear() { try { localStorage.removeItem(IDENTITY_KEY) } catch { /* stockage indisponible */ } },
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const SQL_STATUS = { P0002: 404, 42501: 403, 23505: 409, 22023: 400 }
const FRIENDLY = [
  [/invalid login credentials/i, 'Identifiants incorrects.'],
  [/already registered|already been registered|already exists/i, 'Un compte existe déjà avec cet e-mail.'],
  [/email not confirmed/i, 'Confirmez d’abord votre adresse e-mail grâce au lien reçu par e-mail.'],
  [/password should be at least/i, 'Le mot de passe doit faire au moins 8 caractères.'],
  [/rate limit|too many/i, 'Trop de tentatives, réessayez dans quelques minutes.'],
  [/failed to fetch|networkerror|load failed/i, 'Serveur injoignable. Vérifiez votre connexion internet, puis réessayez.'],
  [/jwt expired|invalid jwt/i, 'Session expirée, reconnectez-vous.'],
  [/permission denied/i, 'Action non autorisée.'],
]

function toError(error) {
  if (error instanceof ApiError) return error
  const msg = error?.message || String(error)
  const status = SQL_STATUS[error?.code] || error?.status || 500
  for (const [re, fr] of FRIENDLY) if (re.test(msg)) return new ApiError(status, fr)
  return new ApiError(status, msg)
}

async function run(promise) {
  let res
  try { res = await promise } catch (e) { throw toError(e) }
  if (res.error) throw toError(res.error)
  return res.data
}
const rpc = (name, args) => run(supabase.rpc(name, args))
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1'

// ---------- Traduction des routes de la version serveur ----------

const ROUTES = [
  ['GET', /^\/public\/config$/, () => rpc('public_config')],
  ['POST', /^\/public\/requests$/, (_, b) => rpc('submit_request', { p: b })],
  ['GET', /^\/public\/requests\/([^/]+)$/, async ([code]) => {
    const d = await rpc('track_request', { p_code: decodeURIComponent(code) })
    if (!d) throw new ApiError(404, 'Aucune demande ne correspond à ce numéro de suivi.')
    return d
  }],
  ['POST', /^\/public\/requests\/([^/]+)\/messages$/, ([code], b) => rpc('add_public_message', { p_code: decodeURIComponent(code), p_body: b.body })],

  ['GET', /^\/requests$/, (_, __, q) => rpc('search_requests', {
    p: {
      status: q.status ? String(q.status).split(',') : null,
      kind: q.kind || null,
      q: q.q || null,
      mine: truthy(q.mine),
      open_only: truthy(q.open_only),
      to_triage: truthy(q.to_triage),
      without_subject: truthy(q.without_subject),
    },
  })],
  ['POST', /^\/requests\/(\d+)\/subject$/, ([id], b) => rpc('link_request', { p_request_id: Number(id), p_subject_id: b?.subject_id ?? null })],

  ['GET', /^\/subjects$/, (_, __, q) => rpc('search_subjects', {
    p: {
      status: q.status ? String(q.status).split(',') : null,
      q: q.q || null,
      mine: truthy(q.mine),
      open_only: truthy(q.open_only),
    },
  })],
  ['POST', /^\/subjects$/, (_, b) => rpc('create_subject', { p: b })],
  ['GET', /^\/subjects\/(\d+)$/, ([id]) => rpc('get_subject', { p_id: Number(id) })],
  ['PATCH', /^\/subjects\/(\d+)$/, ([id], b) => rpc('update_subject', { p_id: Number(id), p: b })],
  ['DELETE', /^\/subjects\/(\d+)$/, ([id]) => rpc('delete_subject', { p_id: Number(id) }).then(() => null)],
  ['POST', /^\/subjects\/(\d+)\/requests$/, ([id], b) => rpc('add_subject_requests', { p_id: Number(id), p: b })],
  ['POST', /^\/subjects\/(\d+)\/notes$/, ([id], b) => rpc('add_subject_note', { p_id: Number(id), p: b })],
  ['POST', /^\/subjects\/(\d+)\/merge$/, ([id], b) => rpc('merge_subjects', { p_id: Number(id), p_into: Number(b.into) })],
  ['POST', /^\/subjects\/(\d+)\/commitments$/, ([id], b) => rpc('add_commitment', { p_subject_id: Number(id), p: b })],
  ['PATCH', /^\/commitments\/(\d+)$/, ([id], b) => rpc('update_commitment', { p_id: Number(id), p: b })],
  ['DELETE', /^\/commitments\/(\d+)$/, ([id]) => rpc('delete_commitment', { p_id: Number(id) })],
  ['GET', /^\/requests\/stats$/, () => rpc('dashboard_stats')],
  ['GET', /^\/requests\/timeline$/, (_, __, q) => rpc('timeline', { p_include_answered: truthy(q.include_answered) })],
  ['GET', /^\/requests\/(\d+)$/, ([id]) => rpc('get_request', { p_id: Number(id) })],
  ['PATCH', /^\/requests\/(\d+)$/, ([id], b) => rpc('update_request', { p_id: Number(id), p: b })],
  ['POST', /^\/requests\/(\d+)\/messages$/, ([id], b) => rpc('add_message', { p_id: Number(id), p: b })],

  ['GET', /^\/meetings$/, () => rpc('list_meetings')],
  ['POST', /^\/meetings$/, (_, b) => rpc('create_meeting', { p: b })],
  ['GET', /^\/meetings\/preparation$/, () => rpc('preparation')],
  ['GET', /^\/meetings\/(\d+)$/, ([id]) => rpc('get_meeting', { p_id: Number(id) })],
  ['PATCH', /^\/meetings\/(\d+)$/, ([id], b) => rpc('update_meeting', { p_id: Number(id), p: b })],
  ['DELETE', /^\/meetings\/(\d+)$/, ([id]) => rpc('delete_meeting', { p_id: Number(id) }).then(() => null)],
  ['GET', /^\/meetings\/(\d+)\/proposal$/, ([id]) => rpc('propose_agenda', { p_meeting_id: Number(id) })],
  ['POST', /^\/meetings\/(\d+)\/items$/, ([id], b) => rpc('add_agenda_item', { p_meeting_id: Number(id), p: b })],
  ['POST', /^\/meetings\/(\d+)\/generate$/, ([id], b) => rpc('generate_agenda', { p_meeting_id: Number(id), p_include_fixed: b?.include_fixed ?? true })],
  ['PATCH', /^\/meetings\/\d+\/items\/(\d+)$/, ([item], b) => rpc('update_agenda_item', { p_item_id: Number(item), p: b })],
  ['DELETE', /^\/meetings\/\d+\/items\/(\d+)$/, ([item], _, q) => rpc('remove_agenda_item', { p_item_id: Number(item), p_stop_recurring: truthy(q.stop_recurring) })],
  ['PUT', /^\/meetings\/(\d+)\/order$/, ([id], b) => rpc('reorder_agenda', { p_meeting_id: Number(id), p_item_ids: b.item_ids })],

  ['GET', /^\/users$/, () => listElus()],
]

export async function api(path, { method = 'GET', body, query } = {}) {
  if (!supabase) throw new ApiError(503, 'AlloCSE n’est pas encore relié à sa base de données.')
  const [pathname, qs] = path.split('?')
  const params = { ...Object.fromEntries(new URLSearchParams(qs || '')), ...(query || {}) }
  // JSON.parse(JSON.stringify()) retire les champs undefined, comme le faisait fetch
  const payload = body === undefined ? {} : JSON.parse(JSON.stringify(body))
  for (const [m, re, handler] of ROUTES) {
    const match = m === method && re.exec(pathname)
    if (match) return handler(match.slice(1), payload, params)
  }
  throw new ApiError(404, `Fonction inconnue : ${method} ${pathname}`)
}

// Documents Word : construits dans le navigateur à partir du modèle du CSE
export async function download(path) {
  const match = /^\/meetings\/(\d+)\/(odj|pv)\.docx$/.exec(path)
  if (!match) throw new ApiError(404, 'Document inconnu.')
  const data = await rpc('meeting_word_data', { p_id: Number(match[1]) })
  const template = await loadTemplate(match[2])
  const { blob, filename } = await buildWordDocument(match[2], template, data)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- Modèles Word (stockage privé Supabase, sinon modèle neutre fourni) ----------

export const TEMPLATE_FILES = { odj: 'modele_odj.docx', pv: 'modele_pv.docx' }
const BUCKET = 'modeles'

async function loadTemplate(kind) {
  const name = TEMPLATE_FILES[kind]
  if ((await customTemplates())[kind]) {
    const { data } = await supabase.storage.from(BUCKET).download(name)
    if (data) return data.arrayBuffer()
  }
  const res = await fetch(`./modeles/${name}`)
  if (!res.ok) throw new ApiError(500, `Modèle Word introuvable : ${name}`)
  return res.arrayBuffer()
}

export async function customTemplates() {
  const { data } = await supabase.storage.from(BUCKET).list('', { limit: 20 })
  const names = new Set((data || []).map((f) => f.name))
  return Object.fromEntries(Object.entries(TEMPLATE_FILES).map(([k, n]) => [k, names.has(n)]))
}

export async function uploadTemplate(kind, file) {
  if (!/\.docx$/i.test(file.name)) throw new ApiError(400, 'Choisissez un fichier Word (.docx).')
  // Vérifie les repères avant d'enregistrer : un modèle incomplet ne doit pas remplacer l'actuel
  const missing = await missingMarkers(kind, await file.arrayBuffer())
  if (missing.length) throw new ApiError(400, `Repères absents du modèle : ${missing.map((m) => `{{${m}}}`).join(', ')}`)
  return run(supabase.storage.from(BUCKET).upload(TEMPLATE_FILES[kind], file, {
    upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }))
}

export const removeTemplate = (kind) => run(supabase.storage.from(BUCKET).remove([TEMPLATE_FILES[kind]]))

// ---------- Élus : authentification et comptes ----------

export const auth = {
  async session() {
    const { data } = await supabase.auth.getSession()
    return data.session
  },
  onChange(cb) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event))
    return () => data.subscription.unsubscribe()
  },
  signIn: (email, password) => run(supabase.auth.signInWithPassword({ email: email.trim(), password })),
  signUp: (email, password, fullName, mandate) => run(supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { full_name: fullName.trim(), mandate: mandate?.trim() || null },
      emailRedirectTo: appBaseUrl(),
    },
  })),
  signOut: () => supabase.auth.signOut(),
  setNewPassword: (password) => run(supabase.auth.updateUser({ password })),
  async changePassword(email, current, next) {
    await run(supabase.auth.signInWithPassword({ email, password: current }))
      .catch(() => { throw new ApiError(400, 'Mot de passe actuel incorrect.') })
    return run(supabase.auth.updateUser({ password: next }))
  },
  resetPassword: (email) => run(supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appBaseUrl() })),
}

export const getPublicConfig = () => rpc('public_config')
export const getMyElu = (userId) => run(supabase.from('elus').select('*').eq('id', userId).maybeSingle())
export const listElus = () => run(supabase.from('elus').select('*').order('is_active', { ascending: false }).order('full_name'))
export const adminUpdateElu = (id, patch) => rpc('admin_update_elu', {
  p_id: id,
  p_full_name: patch.full_name ?? null,
  p_mandate: patch.mandate ?? null,
  p_role: patch.role ?? null,
  p_is_active: patch.is_active ?? null,
})
export const updateMyProfile = (fullName, mandate) => rpc('update_my_profile', { p_full_name: fullName, p_mandate: mandate || null })
export const getSettings = () => run(supabase.from('settings').select('*').eq('id', 1).single())
export const updateSettings = (patch) => run(supabase.from('settings').update(patch).eq('id', 1))

// ---------- Données de l'espace (administrateurs) ----------

export const dataSummary = () => rpc('admin_data_summary')
export const wipeData = (confirm) => rpc('admin_wipe_data', { p_confirm: confirm })
export const loadSample = () => rpc('admin_load_sample')
export const exportData = () => rpc('admin_export_data')
export const importData = (data, shift) => rpc('admin_import_data', { p: data, p_shift: Boolean(shift) })

// ---------- E-mails aux salariés (administrateurs) ----------

export const notificationStatus = () => rpc('admin_notification_status')
export const sendTestMail = () => rpc('admin_send_test_mail')

// ---------- Démonstration ----------

export const DEMO_ACCOUNTS = [
  { email: 'demo-admin@allocse.app', label: 'Administrateur', who: 'Camille Durand, secrétaire du CSE' },
  { email: 'demo-elu@allocse.app', label: 'Élu', who: 'Lucas Bernard, titulaire' },
]
export const DEMO_PASSWORD = 'demo-allocse'
export const demoReset = () => rpc('demo_reset')

// ---------- Affichage ----------

export const STATUS = {
  nouvelle: { label: 'Nouvelle', color: '#5B6B82' },
  en_cours: { label: 'En cours d’étude', color: '#2F5FA8' },
  inscrite_odj: { label: 'À l’ordre du jour', color: '#9A6A00' },
  repondue: { label: 'Réponse apportée', color: '#2E7D5B' },
  close: { label: 'Clôturée', color: '#3F4756' },
}
export const STATUS_ORDER = ['nouvelle', 'en_cours', 'inscrite_odj', 'repondue', 'close']

// Sujets du CSE
export const SUBJECT_STATUS = {
  ouvert: { label: 'En cours', color: '#2F5FA8' },
  inscrit_odj: { label: 'À l’ordre du jour', color: '#9A6A00' },
  repondu: { label: 'Réponse apportée', color: '#2E7D5B' },
  clos: { label: 'Clos', color: '#5B6B82' },
}
export const SUBJECT_STATUS_ORDER = ['ouvert', 'inscrit_odj', 'repondu', 'clos']

export const MEETING_KINDS = { ordinaire: 'Plénière (ordinaire)', extraordinaire: 'Extraordinaire', autre: 'Autre réunion' }

// Une date seule (AAAA-MM-JJ) est lue en heure locale, pas en UTC
const asDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d))
export const fmtDate = (d) => asDate(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
export const fmtDateTime = (d) => asDate(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export const fmtShort = (d) => asDate(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Lien de suivi partageable (fonctionne sur GitHub Pages grâce au #)
export const trackingUrl = (code) => `${appBaseUrl()}#/suivi/${code}`
export const signupUrl = () => `${appBaseUrl()}#/elus/connexion`

// Période d'un signalement : « depuis le 12 septembre 2026 », « du … au … », ou '' si inconnue
export function periodLabel(r) {
  const s = r.situation_start && fmtDate(r.situation_start)
  const e = r.situation_end && fmtDate(r.situation_end)
  if (s && e) return `du ${s} au ${e}`
  if (s) return r.temporality === 'a_venir' ? `à partir du ${s}` : `depuis le ${s}`
  if (e) return `jusqu’au ${e}`
  return ''
}
