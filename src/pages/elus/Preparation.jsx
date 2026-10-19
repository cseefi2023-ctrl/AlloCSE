import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Link, MenuItem,
  Stack, TextField, Typography,
} from '@mui/material'
import { api, fmtDate, MEETING_KINDS } from '../../api'
import { ErrorAlert, Section } from '../../components'

const NEXT_LABEL = { ordinaire: 'Prochaine plénière', extraordinaire: 'Prochaine extraordinaire' }

const progress = (m) => [
  `${m.item_count} point${m.item_count > 1 ? 's' : ''}`,
  m.missing_wording > 0 ? `${m.missing_wording} sans formulation` : null,
].filter(Boolean).join(', ')

// Planifier une réunion (type, intitulé, date), puis ouvrir sa préparation
export function PlanDialog({ open, initial, onClose }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(initial)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setForm(initial); setError(null) } }, [open, initial])

  const submit = async (e) => {
    e.preventDefault()
    try {
      const m = await api('/meetings', { method: 'POST', body: form })
      navigate(`/elus/reunions/${m.id}`)
    } catch (err) { setError(err.message) }
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Planifier une réunion</DialogTitle>
      <DialogContent>
        <ErrorAlert error={error} />
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(MEETING_KINDS).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
          </TextField>
          <TextField label="Intitulé" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <TextField label="Date" type="date" InputLabelProps={{ shrink: true }} value={form.meeting_date}
            onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="contained" disabled={!form.meeting_date || form.title.length < 3}>Planifier et préparer</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PreparationPanel() {
  const navigate = useNavigate()
  const [prep, setPrep] = useState(null)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)

  useEffect(() => { api('/meetings/preparation').then(setPrep).catch((e) => setError(e.message)) }, [])
  if (!prep) return <ErrorAlert error={error} />

  return (
    <Section title="Préparation des réunions">
      {(prep.to_triage > 0 || prep.pending > 0) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {prep.to_triage > 0 && <><Link component={RouterLink} to="/elus/demandes?tri=1" sx={{ fontWeight: 700 }}>{prep.to_triage} demande{prep.to_triage > 1 ? 's' : ''} à trier</Link> (nouveau sujet ou association). </>}
          {prep.pending > 0 && <>{prep.pending} sujet{prep.pending > 1 ? 's' : ''} en attente d’inscription à une réunion.</>}
        </Alert>
      )}
      <Grid container spacing={1.5}>
        {prep.kinds.map(({ kind, next, suggestion }) => (
          <Grid item xs={12} sm={6} key={kind}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 1 }}>
                <Typography variant="overline" color="text.secondary">{NEXT_LABEL[kind]}</Typography>
                {next ? (
                  <>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h4" component="p">{next.title}</Typography>
                      <Typography color="text.secondary">{fmtDate(next.meeting_date)}</Typography>
                      <Typography variant="body2" sx={{ mt: 0.5 }}>{progress(next)}</Typography>
                    </Box>
                    <Button variant={next.item_count ? 'outlined' : 'contained'} onClick={() => navigate(`/elus/reunions/${next.id}`)}>
                      {next.item_count ? 'Poursuivre la préparation' : 'Débuter la préparation'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Box sx={{ flex: 1 }}>
                      <Typography color="text.secondary">Aucune réunion planifiée.</Typography>
                      <Typography variant="body2" color="text.secondary">Proposition : {fmtDate(suggestion.meeting_date)}</Typography>
                    </Box>
                    <Button variant="contained" onClick={() => setPlan({ kind, ...suggestion })}>Débuter la préparation</Button>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      {prep.others.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Typography variant="overline" color="text.secondary">Autres réunions planifiées</Typography>
          {prep.others.map((m) => (
            <Card key={m.id}>
              <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ p: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{m.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{MEETING_KINDS[m.kind]}, {fmtDate(m.meeting_date)}, {progress(m)}</Typography>
                </Box>
                <Button variant="outlined" onClick={() => navigate(`/elus/reunions/${m.id}`)} sx={{ flexShrink: 0 }}>
                  {m.item_count ? 'Poursuivre' : 'Débuter'}
                </Button>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      <PlanDialog open={!!plan} initial={plan || { kind: 'ordinaire', title: '', meeting_date: '' }} onClose={() => setPlan(null)} />
    </Section>
  )
}
