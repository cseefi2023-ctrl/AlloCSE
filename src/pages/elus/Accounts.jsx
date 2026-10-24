import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem,
  Snackbar, Stack, Switch,
  Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { useApp } from '../../App'
import { adminUpdateElu, notificationStatus, sendTestMail, dataSummary, exportData, importData, loadSample, tenant, wipeData, signupUrl, customTemplates, getSettings, listElus, removeTemplate, updateSettings, uploadTemplate } from '../../api'
import { ErrorAlert, Section } from '../../components'
import { appBaseUrl } from '../../tenant'

const TABS = [['elus', 'Élus'], ['reglages', 'Réglages'], ['mails', 'E-mails'], ['donnees', 'Données']]

export default function Accounts() {
  const { user, refreshConfig } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('onglet')) ? params.get('onglet') : 'elus'
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null)
  const [toast, setToast] = useState(null)

  const load = () => listElus().then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  if (user.role !== 'admin') return <Navigate to="/elus" replace />

  const change = async (id, patch, msg) => {
    setError(null)
    try { await adminUpdateElu(id, patch); await load(); refreshConfig(); if (msg) setToast(msg); return true } catch (e) { setError(e.message); return false }
  }
  const save = async (e) => {
    e.preventDefault()
    const patch = { full_name: edit.full_name, mandate: edit.mandate ?? '', role: edit.role }
    if (edit.can_vote !== edit.was_voting) patch.can_vote = edit.can_vote
    if (await change(edit.id, patch, 'Compte modifié')) setEdit(null)
  }
  const signupLink = signupUrl()
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(signupLink); setToast('Lien copié') } catch { /* presse-papiers indisponible */ }
  }

  const pending = rows.filter((u) => !u.is_active && !u.validated_at)
  const others = rows.filter((u) => !pending.includes(u))

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Élus et réglages</Typography>
      <Tabs value={tab} onChange={(_, v) => setParams(v === 'elus' ? {} : { onglet: v }, { replace: true })}
        variant="scrollable" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map(([k, l]) => (
          <Tab key={k} value={k} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, px: 1.5 }}
            label={k === 'elus' && pending.length ? `${l} (${pending.length} à valider)` : l} />
        ))}
      </Tabs>
      <ErrorAlert error={error} onClose={() => setError(null)} />

      {tab === 'elus' && <>
        <Typography color="text.secondary" sx={{ mb: 2, maxWidth: '62ch' }}>
          Chaque élu crée son compte avec ce lien, puis vous le validez ici. En fin de mandat, désactivez son compte.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 3 }}>
          <TextField size="small" value={signupLink} label="Lien à envoyer aux élus" InputProps={{ readOnly: true }} />
          <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyLink} sx={{ flexShrink: 0 }}>Copier</Button>
        </Stack>

        {pending.length > 0 && (
          <Section title="À valider">
            <Stack spacing={1}>
              {pending.map((u) => (
                <Card key={u.id} sx={{ borderColor: 'secondary.main' }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1.5} sx={{ p: 2 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>{u.full_name}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{u.mandate ? `${u.mandate}, ` : ''}{u.email}</Typography>
                    </Box>
                    <Button variant="contained" onClick={() => change(u.id, { is_active: true }, `${u.full_name} peut maintenant se connecter`)}>Valider</Button>
                  </Stack>
                </Card>
              ))}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Ne validez que les personnes que vous reconnaissez comme élues : le lien d’inscription est public.
            </Typography>
          </Section>
        )}

        <Section title="Comptes">
          <Stack spacing={1}>
            {others.map((u) => (
              <Card key={u.id} sx={{ opacity: u.is_active ? 1 : 0.6 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ fontWeight: 700 }}>{u.full_name}</Typography>
                      {u.role === 'admin' && <Chip size="small" label="Admin" />}
                      {u.can_vote === false && <Chip size="small" variant="outlined" label="Sans droit de vote" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" noWrap>{u.mandate ? `${u.mandate}, ` : ''}{u.email}</Typography>
                  </Box>
                  <Button size="small" onClick={() => setEdit({ ...u, mandate: u.mandate || '', can_vote: u.can_vote !== false, was_voting: u.can_vote !== false })}>Modifier</Button>
                  <Tooltip title={u.is_active ? 'Compte actif' : 'Compte désactivé'}>
                    <Switch checked={u.is_active} disabled={u.id === user.id}
                      onChange={() => change(u.id, { is_active: !u.is_active }, u.is_active ? 'Compte désactivé' : 'Compte réactivé')}
                      inputProps={{ 'aria-label': `Compte de ${u.full_name} actif` }} />
                  </Tooltip>
                </Stack>
              </Card>
            ))}
          </Stack>
        </Section>
      </>}

      {tab === 'reglages' && <SettingsCard onSaved={() => { refreshConfig(); setToast('Réglages enregistrés') }} />}
      {tab === 'mails' && <MailCard />}
      {tab === 'donnees' && <DataCard />}

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="xs" component="form" onSubmit={save}>
        <DialogTitle>Modifier le compte</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Nom et prénom" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
              <TextField label="Mandat (ex. Secrétaire, Titulaire)" value={edit.mandate} onChange={(e) => setEdit({ ...edit, mandate: e.target.value })} />
              <TextField select label="Rôle" value={edit.role} disabled={edit.id === user.id} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <MenuItem value="elu">Élu</MenuItem>
                <MenuItem value="admin">Administrateur (valide les comptes, règle l’appli)</MenuItem>
              </TextField>
              <FormControlLabel control={<Checkbox checked={edit.can_vote} onChange={(e) => setEdit({ ...edit, can_vote: e.target.checked })} />}
                label={<span>Droit de vote
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
                    Pour les votes en ligne entre élus. Décochez par exemple pour un représentant syndical.
                  </Typography></span>} />
              <Typography variant="body2" color="text.secondary">{edit.email}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>Annuler</Button>
          <Button type="submit" variant="contained">Enregistrer</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Box>
  )
}

// Points fixes : une ligne « Intitulé » puis, en dessous, les lignes de formulation
const fixedToText = (list) => (list || []).map((e) => (typeof e === 'string' ? e : [e.titre, e.formulation].filter(Boolean).join('\n'))).join('\n\n')
const textToFixed = (text) => text.split(/\n\s*\n/).map((bloc) => bloc.split('\n').map((l) => l.trim()).filter(Boolean))
  .filter((ls) => ls.length).map(([titre, ...rest]) => ({ titre, formulation: rest.join('\n') || null }))

const WORDINGS = [
  ['demande', 'Demande'],
  ['signalement_actuel', 'Signalement d’une situation actuelle'],
  ['signalement_a_venir', 'Signalement d’une situation à venir'],
]

function SettingsCard({ onSaved }) {
  const { config } = useApp()
  const [s, setS] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    getSettings().then((d) => setS({
      ...d,
      categoriesText: d.categories.join('\n'),
      debutText: fixedToText(d.odj_fixed_points?.debut),
      finText: fixedToText(d.odj_fixed_points?.fin),
    })).catch((e) => setError(e.message))
  }, [])
  if (!s) return <ErrorAlert error={error} />
  const setWord = (k, v) => setS({ ...s, word_settings: { ...s.word_settings, [k]: v } })
  const setWording = (k, v) => setS({ ...s, odj_wordings: { ...s.odj_wordings, [k]: v } })

  const save = async (e) => {
    e.preventDefault()
    setError(null)
    const categories = s.categoriesText.split('\n').map((c) => c.trim()).filter(Boolean)
    if (!categories.length) return setError('Gardez au moins un thème.')
    try {
      await updateSettings({
        organisation: s.organisation.trim(),
        contact: s.contact?.trim() || null,
        categories,
        odj_wordings: s.odj_wordings,
        odj_fixed_points: { debut: textToFixed(s.debutText), fin: textToFixed(s.finText) },
        word_settings: s.word_settings,
      })
      onSaved()
    } catch (err) { setError(err.message) }
  }

  return (
    <Box>
      <Card component="form" onSubmit={save}>
        <CardContent>
          <Stack spacing={2.5}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Entreprise" value={s.organisation} onChange={(e) => setS({ ...s, organisation: e.target.value })} />
              <TextField label="E-mail de contact du CSE" value={s.contact || ''} onChange={(e) => setS({ ...s, contact: e.target.value })} />
            </Stack>
            <TextField label="Thèmes proposés aux salariés (un par ligne)" multiline minRows={6} value={s.categoriesText}
              onChange={(e) => setS({ ...s, categoriesText: e.target.value })}
              helperText="Renommer un thème ne modifie pas les demandes déjà déposées." />

            <Typography variant="h4" component="h3" sx={{ pt: 1 }}>Ordre du jour</Typography>
            <Typography variant="body2" color="text.secondary">
              Phrases types utilisées par « Générer l’ordre du jour ». Variables : {'{sujet}'}, {'{categorie}'}, {'{periode}'}, {'{code}'}.
              L’identité du demandeur n’y figure jamais.
            </Typography>
            {WORDINGS.map(([k, label]) => (
              <TextField key={k} label={label} multiline minRows={2} value={s.odj_wordings?.[k] || ''}
                onChange={(e) => setWording(k, e.target.value)} />
            ))}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField label="Points fixes en début d’ordre du jour" multiline minRows={6} value={s.debutText}
                onChange={(e) => setS({ ...s, debutText: e.target.value })}
                helperText="Un point par paragraphe : l’intitulé, puis ses lignes de formulation. Une ligne vide entre deux points." />
              <TextField label="Points fixes en fin d’ordre du jour" multiline minRows={6} value={s.finText}
                onChange={(e) => setS({ ...s, finText: e.target.value })} helperText="Même présentation, par ex. « Questions diverses »." />
            </Stack>

            <Typography variant="h4" component="h3" sx={{ pt: 1 }}>Documents Word</Typography>
            <TextField label="Heure et lieu (après la date dans la convocation)" value={s.word_settings?.heure_et_lieu || ''}
              onChange={(e) => setWord('heure_et_lieu', e.target.value)} helperText="Ex. : à 9h en salle Le Puy" />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Titre des questions reportées" value={s.word_settings?.titre_reportes || ''} onChange={(e) => setWord('titre_reportes', e.target.value)} />
              <TextField label="Titre des questions CSE" value={s.word_settings?.titre_questions || ''} onChange={(e) => setWord('titre_questions', e.target.value)} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Sous-titre par thème" value={s.word_settings?.sous_titre_categorie || ''} onChange={(e) => setWord('sous_titre_categorie', e.target.value)} helperText="{categorie} = nom du thème" />
              <TextField label="Sous-titre des points à accès restreint" value={s.word_settings?.sous_titre_autres || ''} onChange={(e) => setWord('sous_titre_autres', e.target.value)} />
            </Stack>
          </Stack>
          <ErrorAlert error={error} onClose={() => setError(null)} />
          <Button type="submit" variant="contained" sx={{ mt: 2 }}>Enregistrer les réglages</Button>
        </CardContent>
      </Card>
      {config?.demo
        ? <Alert severity="info" sx={{ mt: 2 }}>Démonstration : les modèles Word neutres sont utilisés, l’envoi de modèles est désactivé.</Alert>
        : <TemplatesCard />}
    </Box>
  )
}

// Modèles Word du CSE : stockés dans l'espace privé Supabase (jamais sur GitHub)
function TemplatesCard() {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState(null)
  const load = () => customTemplates().then(setState).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const upload = async (kind, file) => {
    if (!file) return
    setError(null); setDone(null); setBusy(kind)
    try { await uploadTemplate(kind, file); await load(); setDone(`Modèle ${kind === 'odj' ? 'd’ordre du jour' : 'de PV'} enregistré.`) } catch (e) { setError(e.message) } finally { setBusy(null) }
  }
  const reset = async (kind) => {
    if (!window.confirm('Revenir au modèle neutre fourni avec AlloCSE ?')) return
    setError(null); setDone(null)
    try { await removeTemplate(kind); await load() } catch (e) { setError(e.message) }
  }

  const rows = [
    ['odj', 'Convocation et ordre du jour', '{{SECTION}}, {{TEXTE}}, {{SOUS_TITRE}}, {{POINT}}'],
    ['pv', 'Trame du procès-verbal', '{{SECTION}}, {{TEXTE}}, {{GROUPE}}, {{POINT}}'],
  ]
  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="h4" component="h3" sx={{ mb: 1 }}>Modèles Word du CSE</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: '70ch' }}>
          Vos modèles (logo, destinataires, signataires) sont conservés dans l’espace privé de la base,
          lisibles seulement par les élus validés. Sans modèle, AlloCSE utilise un modèle neutre.
          Un modèle doit garder ses repères entre accolades doubles.
        </Typography>
        <Stack spacing={1.5}>
          {rows.map(([kind, label, markers]) => (
            <Stack key={kind} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}
              sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700 }}>{label}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {state == null ? '…' : state[kind] ? 'Modèle du CSE en place' : 'Modèle neutre (aucun modèle envoyé)'}. Repères : {markers}
                </Typography>
              </Box>
              <Button component="label" variant="outlined" disabled={busy === kind}>
                {busy === kind ? 'Envoi…' : state?.[kind] ? 'Remplacer' : 'Envoyer le modèle'}
                <input hidden type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => { upload(kind, e.target.files[0]); e.target.value = '' }} />
              </Button>
              {state?.[kind] && <Button onClick={() => reset(kind)}>Modèle neutre</Button>}
            </Stack>
          ))}
        </Stack>
        <ErrorAlert error={error} onClose={() => setError(null)} />
        {done && <Alert severity="success" sx={{ mt: 2 }} onClose={() => setDone(null)}>{done}</Alert>}
      </CardContent>
    </Card>
  )
}

// Données de l'espace : repartir de zéro, puis charger un jeu de données préparé à l'avance
function DataCard() {
  const { config } = useApp()
  const [sum, setSum] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(null)
  const [wipe, setWipe] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [shift, setShift] = useState(true)
  const load = () => dataSummary().then(setSum).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const act = async (name, fn, message) => {
    setError(null); setDone(null); setBusy(name)
    try { setSum(await fn()); setDone(message) } catch (e) { setError(e.message) } finally { setBusy(null) }
  }
  const doExport = () => act('export', async () => {
    const data = await exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `allocse-${tenant.key}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    return dataSummary()
  }, 'Fichier exporté. Gardez-le en lieu sûr : il contient toutes les demandes.')
  const doImport = (file) => file && act('import', async () => {
    let data
    try { data = JSON.parse(await file.text()) } catch { throw new Error('Ce fichier n’est pas un export AlloCSE.') }
    return importData(data, shift)
  }, 'Jeu de données chargé.')
  const doWipe = (e) => {
    e.preventDefault()
    setWipe(false)
    act('wipe', () => wipeData(confirm), 'Espace vidé : vous repartez de zéro.')
    setConfirm('')
  }

  const empty = sum?.empty
  return (
    <Box>
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: '70ch' }}>
            Pour une présentation : exportez un jeu de données préparé, videz l’espace pour partir de zéro,
            puis rechargez le fichier d’un clic. Les comptes des élus, les réglages et les modèles Word ne sont jamais effacés.
          </Typography>
          <Typography sx={{ mb: 2 }}>
            {sum == null ? '…' : empty ? <strong>L’espace est vide.</strong>
              : <>Actuellement : <strong>{sum.requests}</strong> demande{sum.requests > 1 ? 's' : ''}, <strong>{sum.subjects}</strong> sujet{sum.subjects > 1 ? 's' : ''}, <strong>{sum.meetings}</strong> réunion{sum.meetings > 1 ? 's' : ''}, <strong>{sum.commitments}</strong> engagement{sum.commitments > 1 ? 's' : ''}
                {sum.votes != null && <>, <strong>{sum.votes}</strong> vote{sum.votes > 1 ? 's' : ''}, <strong>{sum.loans}</strong> prêt{sum.loans > 1 ? 's' : ''} de matériel</>}.</>}
          </Typography>
          <Stack spacing={1.5}>
            <DataRow title="Exporter" text="Télécharge toutes les données de l’espace dans un fichier .json.">
              <Button variant="outlined" onClick={doExport} disabled={!!busy || empty}>{busy === 'export' ? 'Export…' : 'Exporter'}</Button>
            </DataRow>
            <DataRow title="Repartir de zéro" text="Efface les demandes, sujets, réunions, engagements, votes, matériel et prêts. Exportez d’abord si vous voulez les retrouver.">
              <Button color="error" variant="outlined" onClick={() => setWipe(true)} disabled={!!busy || empty || sum == null}>Vider l’espace</Button>
            </DataRow>
            <DataRow title="Charger un fichier" text={<>
              Recharge un export dans l’espace vide.
              <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, cursor: 'pointer' }}>
                <Switch size="small" checked={shift} onChange={(e) => setShift(e.target.checked)} />
                Décaler les dates à aujourd’hui (les délais et réunions gardent le même écart)
              </Box></>}>
              <Button component="label" variant="contained" disabled={!!busy || !empty}>
                {busy === 'import' ? 'Chargement…' : 'Charger un fichier'}
                <input hidden type="file" accept=".json,application/json" onChange={(e) => { doImport(e.target.files[0]); e.target.value = '' }} />
              </Button>
            </DataRow>
            <DataRow title="Exemple AlloCSE" text="Remplit l’espace vide avec un exemple fictif : demandes de salariés, sujets du CSE, deux réunions, engagements de la direction, votes, prêts de matériel.">
              <Button variant="outlined" disabled={!!busy || !empty} onClick={() => act('sample', loadSample, 'Exemple chargé.')}>
                {busy === 'sample' ? 'Chargement…' : 'Charger l’exemple'}
              </Button>
            </DataRow>
          </Stack>
          {!empty && sum && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Pour charger un fichier ou l’exemple, videz d’abord l’espace.</Typography>}
          {config?.demo && <Alert severity="info" sx={{ mt: 2 }}>Démonstration : l’exemple est rechargé automatiquement chaque nuit.</Alert>}
          <ErrorAlert error={error} onClose={() => setError(null)} />
          {done && <Alert severity="success" sx={{ mt: 2 }} onClose={() => setDone(null)}>{done}</Alert>}
        </CardContent>
      </Card>

      <Dialog open={wipe} onClose={() => setWipe(false)} fullWidth maxWidth="xs" component="form" onSubmit={doWipe}>
        <DialogTitle>Vider l’espace ?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Toutes les demandes ({sum?.requests}), sujets, réunions, engagements, votes et prêts seront définitivement effacés,
            y compris pour les salariés qui suivent leur demande. Tapez <strong>EFFACER</strong> pour confirmer.
          </Typography>
          <TextField autoFocus fullWidth label="Confirmation" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWipe(false)}>Annuler</Button>
          <Button type="submit" color="error" variant="contained" disabled={confirm.trim().toUpperCase() !== 'EFFACER'}>Effacer</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function DataRow({ title, text, children }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}
      sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" component="div">{text}</Typography>
      </Box>
      {children}
    </Stack>
  )
}

// E-mails envoyés aux salariés qui ont demandé à être prévenus (via Brevo)
function MailCard() {
  const [st, setSt] = useState(null)
  const [form, setForm] = useState({ mail_from: '', app_url: '' })
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => notificationStatus().then((x) => {
    setSt(x)
    setForm({ mail_from: x.mail_from || '', app_url: x.app_url || appBaseUrl() })
  }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault()
    setError(null); setDone(null)
    try {
      await updateSettings({ mail_from: form.mail_from.trim() || null, app_url: form.app_url.trim() || null })
      await load(); setDone('Réglages des e-mails enregistrés.')
    } catch (err) { setError(err.message) }
  }
  const test = async () => {
    setError(null); setDone(null); setBusy(true)
    try { setSt(await sendTestMail()); setDone('E-mail de test mis en file : il part dans la minute, à votre adresse de connexion.') } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const ready = st && st.ready_extensions && st.key_configured && st.mail_from
  return (
    <Box>
      <Card component="form" onSubmit={save}>
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: '70ch' }}>
            Un salarié qui l’a demandé reçoit un e-mail quand vous lui répondez, quand vous lui écrivez (précisions attendues)
            et quand sa demande est close. L’e-mail ne contient jamais la réponse : il invite à la lire dans AlloCSE.
            Les envois partent dans la minute, via Brevo.
          </Typography>
          {st && (
            <Alert severity={st.is_demo ? 'info' : ready ? 'success' : 'warning'} sx={{ mb: 2 }}>
              {st.is_demo ? 'Démonstration : aucun e-mail n’est envoyé.'
                : !st.ready_extensions ? 'Les extensions pg_net et pg_cron ne sont pas actives dans la base.'
                : !st.key_configured ? <>La clé Brevo n’est pas encore enregistrée : dans Supabase, <strong>Integrations &gt; Vault &gt; Add new secret</strong>, nom <code>brevo_api_key</code>, valeur : une clé API Brevo (SMTP et API &gt; Clés API).</>
                : !st.mail_from ? 'Indiquez l’adresse d’expédition ci-dessous.'
                : <>Envois actifs. {st.subscribers} demande{st.subscribers > 1 ? 's' : ''} en cours avec suivi par e-mail, {st.sent_30d} e-mail{st.sent_30d > 1 ? 's' : ''} envoyé{st.sent_30d > 1 ? 's' : ''} ces 30 derniers jours{st.pending ? `, ${st.pending} en cours d’envoi` : ''}.</>}
              {st.failed > 0 && <Box sx={{ mt: 0.5 }}>{st.failed} échec{st.failed > 1 ? 's' : ''} ce mois-ci. Dernière erreur : {st.last_error}</Box>}
            </Alert>
          )}
          <Stack spacing={2}>
            <TextField label="Adresse d’expédition" type="email" value={form.mail_from}
              onChange={(e) => setForm({ ...form, mail_from: e.target.value })}
              helperText="L’adresse validée comme expéditeur dans Brevo." />
            <TextField label="Adresse de l’appli (lien « Voir ma demande »)" value={form.app_url}
              onChange={(e) => setForm({ ...form, app_url: e.target.value })}
              helperText="Normalement l’adresse de cet espace, déjà proposée." />
          </Stack>
          <ErrorAlert error={error} onClose={() => setError(null)} />
          {done && <Alert severity="success" sx={{ mt: 2 }} onClose={() => setDone(null)}>{done}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
            <Button type="submit" variant="contained">Enregistrer</Button>
            <Button variant="outlined" onClick={test} disabled={busy || !ready}>M’envoyer un e-mail de test</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
