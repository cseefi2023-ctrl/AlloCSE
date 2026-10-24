import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { api, MEETING_KINDS } from '../../api'
import { ErrorAlert } from '../../components'

const DEFAULT_TITLE = { ordinaire: 'CSE ordinaire', extraordinaire: 'CSE extraordinaire', autre: 'Réunion CSE' }

// Propositions de date et d'intitulé par type de réunion (renvoyées par /meetings/preparation)
export const suggestionsOf = (prep) => Object.fromEntries((prep?.kinds || []).map((k) => [k.kind, k.suggestion]))

// Prochaine réunion planifiée, tous types confondus
export const nextMeetingOf = (prep) => [...(prep?.kinds || []).map((k) => k.next).filter(Boolean), ...(prep?.others || [])]
  .sort((a, b) => String(a.meeting_date).localeCompare(String(b.meeting_date)))[0] || null

// Planifier une réunion (type, intitulé, date proposés), puis ouvrir sa préparation
export function PlanDialog({ open, suggestions, onClose }) {
  const navigate = useNavigate()
  const fill = (kind) => ({
    kind,
    title: suggestions?.[kind]?.title || DEFAULT_TITLE[kind],
    meeting_date: suggestions?.[kind]?.meeting_date || '',
  })
  const [form, setForm] = useState(fill('ordinaire'))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setForm(fill('ordinaire')); setError(null); setBusy(false); setTouched(false) } }, [open])
  // Les propositions peuvent arriver après l'ouverture : reprises tant que rien n'a été saisi
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !touched) setForm((x) => fill(x.kind)) }, [suggestions])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const m = await api('/meetings', { method: 'POST', body: form })
      navigate(`/elus/reunions/${m.id}`)
    } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Planifier une réunion</DialogTitle>
      <DialogContent>
        <ErrorAlert error={error} />
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Type" value={form.kind} onChange={(e) => setForm(fill(e.target.value))}>
            {Object.entries(MEETING_KINDS).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
          </TextField>
          <TextField label="Date" type="date" InputLabelProps={{ shrink: true }} value={form.meeting_date}
            onChange={(e) => { setTouched(true); setForm({ ...form, meeting_date: e.target.value }) }} />
          <TextField label="Intitulé" value={form.title} onChange={(e) => { setTouched(true); setForm({ ...form, title: e.target.value }) }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="contained" disabled={busy || !form.meeting_date || form.title.trim().length < 3}>Planifier</Button>
      </DialogActions>
    </Dialog>
  )
}
