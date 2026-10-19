import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Box, Button, Checkbox, Collapse, FormControlLabel, FormGroup, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useApp } from '../../App'
import { api, fmtShort, MEETING_KINDS, todayIso } from '../../api'
import { ErrorAlert, KindChoice } from '../../components'

// Question ou signalement saisi par un élu : à poser à la direction lors d'une prochaine réunion
export default function NewRequest() {
  const { config, user } = useApp()
  const navigate = useNavigate()
  const [meetings, setMeetings] = useState([])
  const [form, setForm] = useState({
    kind: '', temporality: 'actuel', situation_start: '', situation_end: '', category: '', subject: '', description: '',
    take_charge: true, visible_to_all: true, viewer_ids: [], meeting_id: '',
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  useEffect(() => {
    api('/meetings').then((ms) => setMeetings(ms.filter((m) => m.status === 'planifiee' && m.meeting_date >= todayIso()).reverse())).catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!form.kind) return setError('Choisissez s’il s’agit d’une demande ou d’un signalement.')
    setBusy(true)
    try {
      const body = { ...form }
      for (const k of ['situation_start', 'situation_end']) if (!body[k] || body.kind !== 'signalement') body[k] = null
      const r = await api('/requests', { method: 'POST', body })
      if (form.meeting_id) await api(`/meetings/${form.meeting_id}/items`, { method: 'POST', body: { request_id: r.id } })
      navigate(`/elus/demandes/${r.id}`, { replace: true })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const others = (config?.elus || []).filter((u) => u.id !== user.id)
  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ maxWidth: 720 }}>
      <Button component={RouterLink} to="/elus/demandes" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>Demandes</Button>
      <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Nouvelle question des élus</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: '62ch' }}>
        Une question à poser à la direction ou une situation à signaler, préparée par les élus pour une prochaine réunion.
        Elle suit ensuite le même parcours qu’une demande de salarié.
      </Typography>

      <KindChoice value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} />
      <Collapse in={form.kind === 'signalement'}>
        <RadioGroup value={form.temporality} onChange={set('temporality')} sx={{ mb: 2 }}>
          <FormControlLabel value="actuel" control={<Radio />} label="La situation existe déjà" />
          <FormControlLabel value="a_venir" control={<Radio />} label="La situation est annoncée ou se prépare" />
        </RadioGroup>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField type="date" label={form.temporality === 'a_venir' ? 'À partir du' : 'Depuis le'} value={form.situation_start}
            onChange={set('situation_start')} InputLabelProps={{ shrink: true }} />
          <TextField type="date" label="Jusqu’au" value={form.situation_end} onChange={set('situation_end')} InputLabelProps={{ shrink: true }} />
        </Stack>
      </Collapse>

      <Stack spacing={2} sx={{ mb: 3 }}>
        <TextField select label="Thème" value={form.category} onChange={set('category')} required>
          {(config?.categories || []).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <TextField label="Objet" value={form.subject} onChange={set('subject')} required inputProps={{ maxLength: 200 }}
          placeholder={form.kind === 'signalement' ? 'Ex. : travail le week-end sans information du CSE' : 'Ex. : calendrier des NAO'} />
        <TextField label="Détails" value={form.description} onChange={set('description')} required multiline minRows={4}
          helperText="Contexte, ce que le CSE attend de la direction." />
        <TextField select label="Inscrire à une réunion (facultatif)" value={form.meeting_id} onChange={set('meeting_id')}
          InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
          <MenuItem value="">Plus tard</MenuItem>
          {meetings.map((m) => <MenuItem key={m.id} value={m.id}>{m.title}, {MEETING_KINDS[m.kind]?.toLowerCase()}, {fmtShort(m.meeting_date)}</MenuItem>)}
        </TextField>
        <FormControlLabel control={<Checkbox checked={form.take_charge} onChange={set('take_charge')} />} label="Je suis cette question" />
        <RadioGroup value={form.visible_to_all ? 'all' : 'some'} onChange={(e) => setForm((f) => ({ ...f, visible_to_all: e.target.value === 'all' }))}>
          <FormControlLabel value="all" control={<Radio />} label="Visible par tous les élus" />
          <FormControlLabel value="some" control={<Radio />} label="Seulement par moi et les élus que je choisis" />
        </RadioGroup>
        <Collapse in={!form.visible_to_all}>
          <FormGroup sx={{ pl: 1 }}>
            {others.map((u) => (
              <FormControlLabel key={u.id} label={u.full_name} control={
                <Checkbox checked={form.viewer_ids.includes(u.id)} onChange={() => setForm((f) => ({
                  ...f, viewer_ids: f.viewer_ids.includes(u.id) ? f.viewer_ids.filter((x) => x !== u.id) : [...f.viewer_ids, u.id],
                }))} />} />
            ))}
          </FormGroup>
        </Collapse>
      </Stack>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <Button type="submit" variant="contained" size="large" disabled={busy}>Enregistrer la question</Button>
    </Box>
  )
}
