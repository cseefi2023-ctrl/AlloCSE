import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Link, Snackbar,
  Stack, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckIcon from '@mui/icons-material/Check'
import { api, fmtDate, fmtShort } from '../../api'
import { ErrorAlert, MoreMenu, Section } from '../../components'
import { deadlineLabel, VoteChips, VoteOutcome } from './Votes'

export default function VoteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [v, setV] = useState(null)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tallyOpen, setTallyOpen] = useState(false)
  const [tally, setTally] = useState([])
  const [edit, setEdit] = useState(null)

  const show = (x) => { setV(x); setTally((x.counts || x.options.map(() => '')).map(String)) }
  useEffect(() => {
    setV(null); setError(null); setTallyOpen(false)
    api(`/votes/${id}`).then(show).catch((e) => setError(e.message))
  }, [id])

  const run = async (fn, msg) => {
    setBusy(true); setError(null)
    try { const r = await fn(); if (r) show(r); if (msg) setToast(msg); return true } catch (e) { setError(e.message); return false } finally { setBusy(false) }
  }

  if (!v) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const online = v.mode === 'en_ligne'
  const open = v.status === 'ouvert'
  const cast = (i) => {
    if (v.secret && !window.confirm(`Bulletin secret : votre vote ne pourra plus être modifié. Voter « ${v.options[i]} » ?`)) return
    run(() => api(`/votes/${id}/ballot`, { method: 'POST', body: { choice: i } }), 'Vote enregistré')
  }
  const close = () => window.confirm('Clore le vote maintenant ? Plus personne ne pourra voter et les résultats s’afficheront.')
    && run(() => api(`/votes/${id}/close`, { method: 'POST' }), 'Vote clos')
  const remove = async () => {
    if (!window.confirm('Supprimer ce vote ?')) return
    try { await api(`/votes/${id}`, { method: 'DELETE' }); navigate('/elus/votes', { replace: true }) } catch (e) { setError(e.message) }
  }
  const saveTally = async (e) => {
    e.preventDefault()
    if (await run(() => api(`/votes/${id}`, { method: 'PATCH', body: { tally: tally.map((x) => Number(x || 0)) } }), 'Résultat enregistré')) {
      setTallyOpen(false)
    }
  }
  const saveEdit = async (e) => {
    e.preventDefault()
    if (await run(() => api(`/votes/${id}`, { method: 'PATCH', body: edit }), 'Vote modifié')) setEdit(null)
  }
  const editable = !online || v.voters_count === 0
  const pct = v.eligible_count ? Math.round((v.voters_count / v.eligible_count) * 100) : 0

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1, ml: -1 }}>
        <Button component={RouterLink} to="/elus/votes" startIcon={<ArrowBackIcon />} size="small">Votes</Button>
        <Box sx={{ flex: 1 }} />
        {editable && <Button size="small" onClick={() => setEdit({ title: v.title, description: v.description || '' })}>Modifier</Button>}
        <MoreMenu items={[
          online && open && v.can_manage && { label: 'Clore le vote maintenant', onClick: close },
          v.can_manage && { label: 'Supprimer le vote', danger: true, onClick: remove },
        ]} />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <VoteChips v={v} />
      </Stack>
      <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{v.title}</Typography>
      {v.description && <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v.description}</Typography>}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {online
          ? (open ? (deadlineLabel(v.deadline) ? `Vote ouvert ${deadlineLabel(v.deadline)}` : 'Vote ouvert, sans date limite')
            : `Vote clos${v.closed_at ? ` le ${fmtShort(v.closed_at)}` : ''}`)
          : v.meeting
            ? <>Réunion : <Link component={RouterLink} to={`/elus/reunions/${v.meeting.id}`}>{v.meeting.title}</Link>, {fmtShort(v.meeting.meeting_date)}</>
            : 'Réunion non précisée'}
        {v.subject && !v.subject.restricted && <> · Sujet : <Link component={RouterLink} to={`/elus/sujets/${v.subject.id}`}>{v.subject.number}</Link></>}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Créé{v.created_by ? ` par ${v.created_by.full_name}` : ''} le {fmtDate(v.created_at)}
      </Typography>
      <ErrorAlert error={error} onClose={() => setError(null)} />

      {online && open && (
        <Section title="Votre vote" sx={{ mt: 3 }}>
          {v.can_vote ? (
            <Stack spacing={1}>
              {v.options.map((o, i) => (
                <Button key={o} size="large" variant={v.my_choice === i ? 'contained' : 'outlined'} disabled={busy}
                  startIcon={v.my_choice === i ? <CheckIcon /> : null} onClick={() => cast(i)}
                  sx={{ justifyContent: 'flex-start', textAlign: 'left' }}>
                  {o}
                </Button>
              ))}
              <Typography variant="body2" color="text.secondary">
                {v.secret ? 'Bulletin secret : personne ne saura ce que vous avez voté, et votre vote ne pourra plus être changé.'
                  : v.i_voted ? 'Vous pouvez changer votre vote jusqu’à la clôture.'
                    : 'Vote nominatif : à la clôture, les élus voient ce que chacun a voté.'}
              </Typography>
            </Stack>
          ) : (
            <Alert severity={v.i_voted ? 'success' : 'info'}>
              {v.i_voted ? 'Vous avez voté. Bulletin secret : votre vote ne peut plus être changé.'
                : 'Votre compte n’a pas le droit de vote pour les votes en ligne (réglage de l’administrateur).'}
            </Alert>
          )}
        </Section>
      )}

      {online && (
        <Section title="Participation" sx={open ? undefined : { mt: 3 }}>
          <Card sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>
              {v.voters_count} élu{v.voters_count > 1 ? 's' : ''} sur {v.eligible_count} {v.voters_count > 1 ? 'ont' : 'a'} voté
            </Typography>
            <LinearProgress variant="determinate" value={pct} sx={{ my: 1, height: 8, borderRadius: 4 }} aria-label="Participation" />
            {v.voters?.length > 0 && <Typography variant="body2">Ont voté : {v.voters.join(', ')}</Typography>}
            {open && v.not_voted?.length > 0 && <Typography variant="body2" color="text.secondary">Pas encore : {v.not_voted.join(', ')}</Typography>}
            {open && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Les résultats s’afficheront à la clôture du vote.</Typography>}
          </Card>
        </Section>
      )}

      {v.counts && !tallyOpen && (
        <Section title="Résultat" sx={online ? undefined : { mt: 3 }}>
          <Card sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
              <VoteOutcome v={v} size="medium" />
              <Typography variant="body2" color="text.secondary">
                {v.total} votant{v.total > 1 ? 's' : ''}{v.standard ? ' · adoptée si les « pour » dépassent la moitié des votants' : ''}
              </Typography>
            </Stack>
            {v.options.map((o, i) => <ResultBar key={o} label={o} n={v.counts[i]} total={v.total} names={v.by_option?.[i]} />)}
            {!online && <Button size="small" sx={{ mt: 0.5, ml: -1 }} onClick={() => setTallyOpen(true)}>Corriger le résultat</Button>}
          </Card>
        </Section>
      )}

      {!online && (!v.recorded || tallyOpen) && (
        <Section title={v.recorded ? 'Corriger le résultat' : 'Résultat du vote'} sx={{ mt: 3 }}>
          <Card component="form" onSubmit={saveTally} sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Nombre de voix des élus qui ont voté en séance.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {v.options.map((o, i) => (
                <TextField key={o} type="number" label={o} value={tally[i] ?? ''} inputProps={{ min: 0, max: 999, inputMode: 'numeric' }}
                  onChange={(e) => setTally(tally.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button type="submit" variant="contained" disabled={busy}>Enregistrer le résultat</Button>
              {v.recorded && <Button onClick={() => { setTallyOpen(false); show(v) }}>Annuler</Button>}
            </Stack>
          </Card>
        </Section>
      )}

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="sm" component="form" onSubmit={saveEdit}>
        <DialogTitle>Modifier le vote</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Question soumise au vote" value={edit.title} inputProps={{ maxLength: 300 }}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              <TextField label="Détails" multiline minRows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={busy}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Box>
  )
}

function ResultBar({ label, n, total, names }) {
  const pct = total ? Math.round((n / total) * 100) : 0
  return (
    <Box sx={{ mb: 1.25 }}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{label}</Typography>
        <Typography sx={{ flexShrink: 0 }}>{n} <Box component="span" sx={{ color: 'text.secondary' }}>({pct} %)</Box></Typography>
      </Stack>
      <Box sx={{ height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden', mt: 0.5 }}>
        <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: 'primary.main' }} />
      </Box>
      {names?.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{names.join(', ')}</Typography>}
    </Box>
  )
}
