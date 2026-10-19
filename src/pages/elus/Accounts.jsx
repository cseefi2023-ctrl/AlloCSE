import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Snackbar, Stack, Switch,
  TextField, Tooltip, Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { useApp } from '../../App'
import { adminUpdateElu, customTemplates, getSettings, listElus, removeTemplate, updateSettings, uploadTemplate } from '../../api'
import { ErrorAlert, Section } from '../../components'

export default function Accounts() {
  const { user, refreshConfig } = useApp()
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
    if (await change(edit.id, { full_name: edit.full_name, mandate: edit.mandate ?? '', role: edit.role }, 'Compte modifié')) setEdit(null)
  }
  const signupLink = `${window.location.href.split('#')[0]}#/elus/connexion`
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(signupLink); setToast('Lien copié') } catch { /* presse-papiers indisponible */ }
  }

  const pending = rows.filter((u) => !u.is_active && !u.validated_at)
  const others = rows.filter((u) => !pending.includes(u))

  return (
    <>
      <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Élus</Typography>
      <Typography color="text.secondary" sx={{ mb: 2, maxWidth: '62ch' }}>
        Chaque élu crée son compte depuis l’espace élus, puis vous le validez ici. Les élus validés apparaissent dans la liste
        proposée aux salariés pour choisir qui peut lire leur demande. En fin de mandat, désactivez le compte.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 3 }}>
        <TextField size="small" value={signupLink} label="Lien à envoyer aux élus" InputProps={{ readOnly: true }} />
        <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyLink} sx={{ flexShrink: 0 }}>Copier</Button>
      </Stack>
      <ErrorAlert error={error} onClose={() => setError(null)} />

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
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap>{u.mandate ? `${u.mandate}, ` : ''}{u.email}</Typography>
                </Box>
                <Button size="small" onClick={() => setEdit({ ...u, mandate: u.mandate || '' })}>Modifier</Button>
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

      <SettingsCard onSaved={() => { refreshConfig(); setToast('Réglages enregistrés') }} />

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
    </>
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
    <Section title="Réglages">
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
      <TemplatesCard />
    </Section>
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
