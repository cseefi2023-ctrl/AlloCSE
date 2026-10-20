import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, CircularProgress, Divider, FormControlLabel, Grid, Link,
  MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useApp } from '../../App'
import { api, fmtDate, fmtShort, periodLabel, STATUS, STATUS_ORDER } from '../../api'
import { CommitmentChip, DateField, ErrorAlert, KindChip, MessageList, Section, StatusChip, StatusTrack, SubjectStatusChip, Timeline } from '../../components'
import { mono } from '../../theme'
import { SubjectChip } from './shared'

const MODES = {
  answer: { label: 'Répondre', hint: 'Réponse officielle : le salarié la lit avec son numéro de suivi. Inutile d’attendre la réunion si vous avez la réponse.', button: 'Envoyer la réponse' },
  message: { label: 'Question au salarié', hint: 'Demander une précision au salarié, sans répondre encore.', button: 'Envoyer le message' },
  internal: { label: 'Note interne', hint: 'Visible uniquement par les élus autorisés à voir cette demande.', button: 'Ajouter la note' },
}

export default function RequestDetail() {
  const { id } = useParams()
  const { user } = useApp()
  const [r, setR] = useState(null)
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('answer')
  const [body, setBody] = useState('')
  const [closeIt, setCloseIt] = useState(false)
  const [subjects, setSubjects] = useState([])
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    setR(null); setError(null)
    api(`/requests/${id}`).then(setR).catch((e) => setError(e.message))
    api('/users').then(setUsers).catch(() => {})
    api('/subjects', { query: { open_only: true } }).then(setSubjects).catch(() => {})
    setPick(null)
  }, [id])

  // Rattacher à un sujet existant, ou détacher
  const link = async (subjectId, msg) => {
    try {
      setR(await api(`/requests/${id}/subject`, { method: 'POST', body: { subject_id: subjectId } }))
      setPick(null); setToast(msg)
    } catch (e) { setError(e.message) }
  }

  const patch = async (data, msg) => {
    try { setR(await api(`/requests/${id}`, { method: 'PATCH', body: data })); if (msg) setToast(msg) } catch (e) { setError(e.message) }
  }

  const send = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      setR(await api(`/requests/${id}/messages`, {
        method: 'POST',
        body: { body, internal: mode === 'internal', is_answer: mode === 'answer', close: mode === 'answer' && closeIt },
      }))
      setBody(''); setCloseIt(false)
      setToast(mode === 'internal' ? 'Note ajoutée' : 'Envoyé au salarié')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (!r) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const allowed = users.filter((u) => u.is_active && (r.visible_to_all || r.viewers.some((v) => v.id === u.id)))
  const closed = r.status === 'close'
  const ref = r.subject_ref
  const subjectLabel = (o) => `${o.number} · ${o.title}`

  return (
    <>
      <Button component={RouterLink} to="/elus/demandes" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>Demandes</Button>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <SubjectChip r={r} />
        <StatusChip status={r.status} />
        <KindChip kind={r.kind} temporality={r.temporality} />
      </Stack>
      <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{r.subject}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        <Box component="span" sx={{ fontFamily: mono }}>{r.tracking_code}</Box>, {r.category}, déposée le {fmtDate(r.created_at)}
        {r.kind === 'signalement' && <><br />Situation {periodLabel(r) || 'sans date connue'}</>}
      </Typography>
      <StatusTrack status={r.status} agenda={r.agenda.length > 0} />
      <ErrorAlert error={error} onClose={() => setError(null)} />

      <Grid container spacing={4}>
        <Grid item xs={12} md={8}>
          <Section title="Échanges">
            <MessageList viewer="elu" messages={[{ id: 'orig', author_type: 'salarie', author: null, body: r.description, created_at: r.created_at, internal: false, is_answer: false }, ...r.messages]} />
          </Section>

          <Card component="form" onSubmit={send} sx={{ mb: 4 }}>
            <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider' }}>
              {Object.entries(MODES).map(([k, m]) => <Tab key={k} value={k} label={m.label} disabled={closed && k !== 'internal'} sx={{ textTransform: 'none', fontWeight: 700 }} />)}
            </Tabs>
            <CardContent>
              {closed && mode !== 'internal'
                ? <Alert severity="info">Demande clôturée. Rouvrez-la (statut « En cours d’étude ») pour écrire au salarié.</Alert>
                : <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{MODES[mode].hint}</Typography>
                  <TextField multiline minRows={4} value={body} onChange={(e) => setBody(e.target.value)} label={MODES[mode].label} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ mt: 1.5 }}>
                    {mode === 'answer'
                      ? (
                        <FormControlLabel control={<Checkbox checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} />} label="Clôturer la demande" />
                      ) : <span />}
                    <Button type="submit" variant="contained" disabled={busy || !body.trim()}>{MODES[mode].button}</Button>
                  </Stack>
                </>}
            </CardContent>
          </Card>

          {ref && !ref.restricted && r.commitments.length > 0 && (
            <Section title="Engagements de la direction" action={<Button size="small" component={RouterLink} to={`/elus/sujets/${ref.id}`}>Gérer sur le sujet</Button>}>
              <Stack spacing={1}>
                {r.commitments.map((c) => (
                  <Card key={c.id} sx={{ p: 1.5, borderColor: c.late ? 'error.main' : undefined }}>
                    <Typography sx={{ whiteSpace: 'pre-wrap' }}>{c.text}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <CommitmentChip c={c} />
                      <Typography variant="body2">Délai : {fmtDate(c.due_date)}</Typography>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Section>
          )}

          <Section title="Historique">
            <Card><CardContent><Timeline events={[...r.events].reverse()} showInternal /></CardContent></Card>
          </Section>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Sujet du CSE</Typography>
              {!ref && (
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    {r.status === 'nouvelle' || r.status === 'en_cours'
                      ? 'À trier. Vous pouvez répondre directement au salarié. Si la question doit être suivie ou portée devant la direction, créez un sujet ou rattachez-la à un sujet existant.'
                      : 'Aucun sujet : la demande est traitée directement avec le salarié.'}
                  </Typography>
                  {!closed && <Button variant="contained" onClick={() => navigate(`/elus/sujets/nouveau?demande=${r.id}`)}>Créer un sujet</Button>}
                  {!closed && <>
                    <Autocomplete size="small" options={subjects} value={pick} onChange={(_, v) => setPick(v)}
                      getOptionLabel={subjectLabel} isOptionEqualToValue={(a, b) => a.id === b.id}
                      noOptionsText="Aucun sujet en cours"
                      renderInput={(params) => <TextField {...params} label="Rattacher à un sujet existant" />} />
                    <Button variant="outlined" disabled={!pick} onClick={() => link(pick.id, 'Demande rattachée au sujet')}>Rattacher</Button>
                  </>}
                </Stack>
              )}
              {ref && ref.restricted && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontFamily: mono, fontWeight: 700 }}>{ref.number}</Typography>
                  <Typography variant="body2" color="text.secondary">Rattachée à un sujet réservé à d’autres élus.</Typography>
                </Stack>
              )}
              {ref && !ref.restricted && (
                <Stack spacing={1.5}>
                  <Box>
                    <Typography sx={{ fontFamily: mono, fontWeight: 700 }}>{ref.number}</Typography>
                    <Link component={RouterLink} to={`/elus/sujets/${ref.id}`} sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{ref.title}</Link>
                    <Box sx={{ mt: 0.75 }}><SubjectStatusChip status={ref.status} /></Box>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    Ordre du jour, réponse de la direction et engagements se gèrent sur la fiche du sujet. La réponse au sujet parvient à ce salarié.
                  </Typography>
                  {r.agenda.map((a) => (
                    <Box key={a.item_id}>
                      <Link component={RouterLink} to={`/elus/reunions/${a.meeting_id}`} sx={{ fontWeight: 700 }}>{a.meeting_title}</Link>
                      <Typography variant="body2" color="text.secondary">{fmtShort(a.meeting_date)}{a.discussed ? ', traité' : ''}</Typography>
                    </Box>
                  ))}
                  <Button variant="outlined" onClick={() => window.confirm('Détacher cette demande de son sujet ?') && link(null, 'Demande détachée du sujet')}>Détacher du sujet</Button>
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 2 }}>Traitement</Typography>
              <Stack spacing={2}>
                {r.assignee?.id !== user.id && !closed && (
                  <Button variant="outlined" onClick={() => patch({ take_charge: true }, 'Vous suivez cette demande')}>Je prends en charge</Button>
                )}
                <TextField select size="small" label="Suivie par" value={r.assignee?.id || ''}
                  onChange={(e) => patch({ assignee_id: e.target.value }, 'Suivi attribué')}>
                  {allowed.map((u) => <MenuItem key={u.id} value={u.id}>{u.full_name}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Statut" value={r.status} onChange={(e) => patch({ status: e.target.value }, 'Statut modifié')}>
                  {STATUS_ORDER.map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
                </TextField>
                {r.kind === 'signalement' && <>
                  <DateField label="Situation depuis" value={r.situation_start}
                    onCommit={(d) => patch({ situation_start: d }, d ? 'Début de la situation enregistré' : 'Début retiré')} />
                  <DateField label="Situation jusqu’au" value={r.situation_end} min={r.situation_start}
                    onCommit={(d) => patch({ situation_end: d }, d ? 'Fin de la situation enregistrée' : 'Fin retirée')} />
                </>}
                <DateField label="Échéance" value={r.due_date} helperText="Date attendue de réponse. Videz le champ pour la retirer."
                  onCommit={(d) => patch({ due_date: d }, d ? 'Échéance enregistrée' : 'Échéance retirée')} />
                <TextField select size="small" label="Priorité" value={r.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  <MenuItem value="basse">Basse</MenuItem><MenuItem value="normale">Normale</MenuItem><MenuItem value="haute">Haute</MenuItem>
                </TextField>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Demandeur</Typography>
              {r.anonymous ? <Typography>Anonyme</Typography> : (
                <>
                  <Typography>{r.requester_name || 'Nom non renseigné'}</Typography>
                  {r.requester_service && <Typography variant="body2" color="text.secondary">{r.requester_service}</Typography>}
                  {r.requester_email && <Link href={`mailto:${r.requester_email}`} variant="body2">{r.requester_email}</Link>}
                </>
              )}
              {r.notify && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Prévenu par e-mail de vos réponses, messages et de la clôture.
                </Typography>
              )}
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Visible par</Typography>
              <Typography variant="body2" color="text.secondary">
                {r.visible_to_all ? 'Tous les élus' : r.viewers.map((v) => v.full_name).join(', ')}
              </Typography>
              {!r.visible_to_all && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Choix du demandeur : ne partagez pas cette demande avec d’autres élus.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </>
  )
}
