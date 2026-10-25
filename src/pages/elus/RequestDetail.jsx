import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, CircularProgress, Collapse, FormControlLabel, Grid, Link,
  MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import LockIcon from '@mui/icons-material/LockOutlined'
import { useApp } from '../../App'
import { api, euros, fmtDate, fmtShort, hasAmount, loanRequestState, periodLabel, STATUS, STATUS_ORDER } from '../../api'
import { CommitmentChip, DateField, ErrorAlert, Fold, MessageList, Section, SubjectStatusChip, Timeline } from '../../components'
import { mono } from '../../theme'
import { LoanAskDialog } from './Loans'
import { isToTriage, RequestChips } from './shared'

const MODES = {
  answer: { label: 'Répondre', hint: 'Le salarié lit la réponse avec son numéro de suivi.', button: 'Envoyer la réponse' },
  message: { label: 'Question au salarié', hint: 'Demander une précision au salarié, sans répondre encore.', button: 'Envoyer la question' },
  internal: { label: 'Note interne', hint: 'Visible seulement par les élus qui voient cette demande.', button: 'Ajouter la note' },
}
const join = (parts) => parts.filter(Boolean).join(' · ')

export default function RequestDetail() {
  const { id } = useParams()
  const { user } = useApp()
  const navigate = useNavigate()
  const [r, setR] = useState(null)
  const [users, setUsers] = useState([])
  const [subjects, setSubjects] = useState([])
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('answer')
  const [body, setBody] = useState('')
  const [closeIt, setCloseIt] = useState(false)
  const [attach, setAttach] = useState(false)
  const [pick, setPick] = useState(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [decide, setDecide] = useState(null) // demande d'emprunt : 'accept' | 'refuse'
  // Demande d'emprunt en attente : pas d'onglet « Répondre », la réponse passe par Accepter / Refuser
  const askPending = !!(r?.loan_request && !r.loan_request.decision)
  const activeMode = askPending && mode === 'answer' ? 'message' : mode

  useEffect(() => {
    setR(null); setError(null); setPick(null); setAttach(false)
    api(`/requests/${id}`).then(setR).catch((e) => setError(e.message))
    api('/users').then(setUsers).catch(() => {})
    api('/subjects', { query: { open_only: true } }).then(setSubjects).catch(() => {})
  }, [id])

  // Rattacher à un sujet existant, ou détacher
  const link = async (subjectId, msg) => {
    try {
      setR(await api(`/requests/${id}/subject`, { method: 'POST', body: { subject_id: subjectId } }))
      setPick(null); setAttach(false); setToast(msg)
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
        body: { body, internal: activeMode === 'internal', is_answer: activeMode === 'answer', close: activeMode === 'answer' && closeIt },
      }))
      setBody(''); setCloseIt(false)
      setToast(activeMode === 'internal' ? 'Note ajoutée' : 'Envoyé au salarié')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (!r) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const allowed = users.filter((u) => u.is_active && (r.visible_to_all || r.viewers.some((v) => v.id === u.id)))
  const closed = r.status === 'close'
  const ref = r.subject_ref
  const triage = isToTriage(r)
  const lr = r.loan_request
  const modes = Object.entries(MODES).filter(([k]) => !(askPending && k === 'answer'))

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Button component={RouterLink} to="/elus/demandes" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>Demandes</Button>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <RequestChips r={r} />
      </Stack>
      <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{r.subject}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
        <Box component="span" sx={{ fontFamily: mono }}>{r.tracking_code}</Box> · {r.category} · déposée le {fmtDate(r.created_at)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {r.anonymous ? 'Salarié anonyme' : join([r.requester_name || 'Nom non renseigné', r.requester_service])}
        {r.requester_email && <> · <Link href={`mailto:${r.requester_email}`}>{r.requester_email}</Link></>}
        {r.notify && ' · prévenu par e-mail'}
      </Typography>
      {r.kind === 'signalement' && (
        <Typography variant="body2" color="text.secondary">Situation {periodLabel(r) || 'sans date connue'}</Typography>
      )}
      {!r.visible_to_all && (
        <Alert severity="info" icon={<LockIcon />} sx={{ mt: 1.5 }}>
          Visible seulement par {r.viewers.map((v) => v.full_name).join(', ')} : choix du salarié, ne la partagez pas avec d’autres élus.
        </Alert>
      )}
      <ErrorAlert error={error} onClose={() => setError(null)} />
      {lr && <Box sx={{ mt: 3 }}><LoanCard r={r} closed={closed} onDecide={setDecide} /></Box>}

      <Section title="Échanges" sx={{ mt: 3 }}>
        <MessageList viewer="elu" messages={[{ id: 'orig', author_type: 'salarie', author: null, body: r.description, created_at: r.created_at, internal: false, is_answer: false }, ...r.messages]} />
      </Section>

      <Card component="form" onSubmit={send} sx={{ mb: 3 }}>
        <Tabs value={activeMode} onChange={(_, v) => setMode(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider' }}>
          {modes.map(([k, m]) => <Tab key={k} value={k} label={m.label} disabled={closed && k !== 'internal'} sx={{ textTransform: 'none', fontWeight: 700 }} />)}
        </Tabs>
        <CardContent>
          {closed && activeMode !== 'internal'
            ? <Alert severity="info">Demande clôturée. Pour écrire au salarié, repassez-la « En cours d’étude » dans le suivi ci-dessous.</Alert>
            : <>
              <TextField multiline minRows={3} value={body} onChange={(e) => setBody(e.target.value)} label={MODES[activeMode].label} helperText={MODES[activeMode].hint} />
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ mt: 1 }}>
                {activeMode === 'answer'
                  ? <FormControlLabel control={<Checkbox checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} />} label="Clôturer la demande" />
                  : <span />}
                <Button type="submit" variant="contained" disabled={busy || !body.trim()}>{MODES[activeMode].button}</Button>
              </Stack>
            </>}
        </CardContent>
      </Card>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {!lr && (
        <Grid item xs={12} sm={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Sujet du CSE</Typography>
              {!ref && (
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    {closed ? 'Traitée directement avec le salarié, sans sujet.'
                      : triage ? 'Répondez directement, ou créez un sujet pour la suivre et la porter en réunion.'
                        : 'Pas de sujet : traitée directement avec le salarié.'}
                  </Typography>
                  {!closed && <>
                    <Button variant="contained" onClick={() => navigate(`/elus/sujets/nouveau?demande=${r.id}`)}>Créer un sujet</Button>
                    {!attach && <Button variant="outlined" onClick={() => setAttach(true)}>Rattacher à un sujet existant</Button>}
                    <Collapse in={attach} unmountOnExit>
                      <Stack spacing={1}>
                        <Autocomplete size="small" options={subjects} value={pick} onChange={(_, v) => setPick(v)} openOnFocus
                          getOptionLabel={(o) => `${o.number} · ${o.title}`} isOptionEqualToValue={(a, b) => a.id === b.id}
                          noOptionsText="Aucun sujet en cours"
                          renderInput={(params) => <TextField {...params} label="Sujet" autoFocus />} />
                        <Stack direction="row" spacing={1}>
                          <Button variant="contained" disabled={!pick} onClick={() => link(pick.id, 'Demande rattachée au sujet')}>Rattacher</Button>
                          <Button onClick={() => { setAttach(false); setPick(null) }}>Annuler</Button>
                        </Stack>
                      </Stack>
                    </Collapse>
                  </>}
                </Stack>
              )}
              {ref && ref.restricted && (
                <>
                  <Typography sx={{ fontFamily: mono, fontWeight: 700 }}>{ref.number}</Typography>
                  <Typography variant="body2" color="text.secondary">Rattachée à un sujet réservé à d’autres élus.</Typography>
                </>
              )}
              {ref && !ref.restricted && (
                <Stack spacing={1.25} alignItems="flex-start">
                  <Box>
                    <Link component={RouterLink} to={`/elus/sujets/${ref.id}`} sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{ref.title}</Link>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <Typography variant="body2" sx={{ fontFamily: mono }}>{ref.number}</Typography>
                      <SubjectStatusChip status={ref.status} />
                    </Stack>
                  </Box>
                  {r.agenda.map((a) => (
                    <Typography key={a.item_id} variant="body2">
                      Réunion : <Link component={RouterLink} to={`/elus/reunions/${a.meeting_id}`}>{a.meeting_title}</Link>, {fmtShort(a.meeting_date)}{a.discussed ? ', traité' : ''}
                    </Typography>
                  ))}
                  <Typography variant="body2" color="text.secondary">La réponse donnée sur le sujet parvient aussi à ce salarié.</Typography>
                  <Button size="small" sx={{ ml: -1 }} onClick={() => window.confirm('Détacher cette demande de son sujet ?') && link(null, 'Demande détachée du sujet')}>
                    Détacher du sujet
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
        )}

        <Grid item xs={12} sm={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Suivi</Typography>
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
              </Stack>
              <Button size="small" onClick={() => setMore(!more)} sx={{ mt: 1, ml: -1 }} aria-expanded={more}>
                {more ? 'Moins de réglages' : 'Échéance, priorité…'}
              </Button>
              <Collapse in={more} unmountOnExit>
                <Stack spacing={2} sx={{ pt: 1.5 }}>
                  <DateField label="Échéance" value={r.due_date} helperText="Date attendue de réponse. Videz le champ pour la retirer."
                    onCommit={(d) => patch({ due_date: d }, d ? 'Échéance enregistrée' : 'Échéance retirée')} />
                  <TextField select size="small" label="Priorité" value={r.priority} onChange={(e) => patch({ priority: e.target.value }, 'Priorité modifiée')}>
                    <MenuItem value="basse">Basse</MenuItem><MenuItem value="normale">Normale</MenuItem><MenuItem value="haute">Haute</MenuItem>
                  </TextField>
                  {r.kind === 'signalement' && <>
                    <DateField label="Situation depuis" value={r.situation_start}
                      onCommit={(d) => patch({ situation_start: d }, d ? 'Début de la situation enregistré' : 'Début retiré')} />
                    <DateField label="Situation jusqu’au" value={r.situation_end} min={r.situation_start}
                      onCommit={(d) => patch({ situation_end: d }, d ? 'Fin de la situation enregistrée' : 'Fin retirée')} />
                  </>}
                </Stack>
              </Collapse>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {ref && !ref.restricted && r.commitments.length > 0 && (
        <Section title="Engagements de la direction" action={<Button size="small" component={RouterLink} to={`/elus/sujets/${ref.id}`}>Voir le sujet</Button>}>
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

      <Fold title={`Historique (${r.events.length})`}>
        <Card><CardContent><Timeline events={[...r.events].reverse()} showInternal /></CardContent></Card>
      </Fold>
      {lr && (
        <LoanAskDialog requestId={r.id} open={!!decide} initialMode={decide || 'accept'} onClose={() => setDecide(null)}
          onDone={(d, msg) => { setDecide(null); setR(d); setToast(msg) }} />
      )}
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Box>
  )
}

// Demande d'emprunt de matériel : ce qui est demandé, la réponse, le prêt
const LOAN_LINE = {
  attente: 'En attente de votre réponse',
  reserve: 'Accepté : matériel réservé',
  acceptee: 'Accepté',
  sorti: 'Matériel remis au salarié',
  retard: 'Retour en retard',
  rendu: 'Matériel rendu',
  annule: 'Réservation annulée',
  refusee: 'Refusé',
}

function LoanCard({ r, closed, onDecide }) {
  const lr = r.loan_request
  const st = loanRequestState(lr)
  const l = lr.loan
  return (
    <Card sx={st === 'attente' ? { borderColor: 'secondary.main', borderWidth: 2 } : undefined}>
      <CardContent>
        <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Demande d’emprunt</Typography>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {lr.equipment_name || 'Matériel supprimé'}{lr.quantity > 1 ? ` × ${lr.quantity}` : ''}
        </Typography>
        <Typography variant="body2">
          Du {fmtShort(l?.start_date || lr.start_date)} au {fmtShort(l?.due_date || lr.due_date)}
          {hasAmount(l ? l.deposit : lr.deposit) ? ` · caution ${euros(l ? l.deposit : lr.deposit)}` : ''}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>{LOAN_LINE[st]}</Typography>
        {st === 'attente' && lr.free != null && lr.free < lr.quantity && (
          <Alert severity="warning" sx={{ mt: 1 }}>{lr.free <= 0 ? 'Déjà réservé à ces dates.' : `Plus que ${lr.free} disponible${lr.free > 1 ? 's' : ''} à ces dates.`}</Alert>
        )}
        {st === 'attente' && !closed && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
            {lr.equipment_active && <Button variant="contained" onClick={() => onDecide('accept')}>Accepter</Button>}
            <Button variant="outlined" color="error" onClick={() => onDecide('refuse')}>Refuser</Button>
          </Stack>
        )}
        {l && <Button component={RouterLink} to={`/elus/prets?pret=${l.id}`} size="small" sx={{ mt: 1, ml: -1 }}>Voir le prêt</Button>}
      </CardContent>
    </Card>
  )
}
