import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, Collapse, FormControlLabel, FormGroup, MenuItem, Radio, RadioGroup, Stack,
  TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useApp } from '../../App'
import { api, fmtShort, MEETING_KINDS, todayIso } from '../../api'
import { ErrorAlert, Fold, KindChoice } from '../../components'
import { mono } from '../../theme'

// Nouveau sujet du CSE : de zéro (question ou alerte des élus), ou à partir de demandes de salariés
export default function NewSubject() {
  const { config, user } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const fromId = params.get('demande')
  const [meetings, setMeetings] = useState([])
  const [requests, setRequests] = useState([])
  const [form, setForm] = useState({
    kind: '', temporality: 'actuel', situation_start: '', situation_end: '', category: '', title: '', description: '',
    priority: 'normale', take_charge: true, visible_to_all: true, viewer_ids: [], meeting_id: '', requests: [],
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  useEffect(() => {
    api('/meetings').then((ms) => setMeetings(ms.filter((m) => m.status === 'planifiee' && m.meeting_date >= todayIso()).reverse())).catch(() => {})
    api('/requests', { query: { open_only: true, without_subject: true } }).then(setRequests).catch(() => {})
    if (fromId) {
      api(`/requests/${fromId}`).then((r) => setForm((f) => ({
        ...f, kind: r.kind, temporality: r.temporality || 'actuel', situation_start: r.situation_start || '',
        situation_end: r.situation_end || '', category: r.category, title: r.subject, priority: r.priority, requests: [r],
      }))).catch((e) => setError(e.message))
    }
  }, [fromId])

  const restricted = form.requests.some((r) => !r.visible_to_all)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!form.kind) return setError('Choisissez s’il s’agit d’une question ou d’une alerte.')
    setBusy(true)
    try {
      const body = { ...form, request_ids: form.requests.map((r) => r.id), meeting_id: form.meeting_id || null }
      delete body.requests
      for (const k of ['situation_start', 'situation_end']) if (!body[k] || body.kind !== 'signalement') body[k] = null
      const s = await api('/subjects', { method: 'POST', body })
      navigate(`/elus/sujets/${s.id}`, { replace: true })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const others = (config?.elus || []).filter((u) => u.id !== user.id)
  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ maxWidth: 720 }}>
      <Button component={RouterLink} to={fromId ? `/elus/demandes/${fromId}` : '/elus/sujets'} startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>
        {fromId ? 'Demande' : 'Sujets du CSE'}
      </Button>
      <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Nouveau sujet</Typography>

      <KindChoice audience="elus" value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} />
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
        <TextField label="Intitulé du sujet" value={form.title} onChange={set('title')} required inputProps={{ maxLength: 200 }}
          helperText="Tel qu’il apparaîtra à l’ordre du jour, sans nom de salarié."
          placeholder={form.kind === 'signalement' ? 'Ex. : travail du samedi sans consultation du CSE' : 'Ex. : calendrier des NAO 2027'} />
        <TextField select label="Thème" value={form.category} onChange={set('category')} required>
          {(config?.categories || []).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <TextField label="Description" value={form.description} onChange={set('description')} multiline minRows={3}
          helperText="Contexte, ce que le CSE attend de la direction. Visible des élus seulement." />
        <Autocomplete multiple options={requests.filter((r) => !form.requests.some((x) => x.id === r.id))} value={form.requests}
          onChange={(_, v) => setForm((f) => ({ ...f, requests: v }))}
          getOptionLabel={(r) => `${r.subject} (${r.tracking_code})`} isOptionEqualToValue={(a, b) => a.id === b.id}
          noOptionsText="Aucune demande sans sujet"
          renderTags={(value, getTagProps) => value.map((r, i) => (
            <Chip {...getTagProps({ index: i })} key={r.id} label={<span>{r.subject} <Box component="span" sx={{ fontFamily: mono, opacity: 0.7 }}>{r.tracking_code}</Box></span>} />
          ))}
          renderInput={(p) => <TextField {...p} label="Demandes rattachées (facultatif)" />} />
        {restricted && (
          <Alert severity="info">
            Une demande rattachée est à accès restreint : le sujet sera réservé aux élus que ce salarié a choisis.
          </Alert>
        )}
        <TextField select label="Inscrire à une réunion (facultatif)" value={form.meeting_id} onChange={set('meeting_id')}
          InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }}>
          <MenuItem value="">Plus tard</MenuItem>
          {meetings.map((m) => <MenuItem key={m.id} value={m.id}>{m.title}, {MEETING_KINDS[m.kind]?.toLowerCase()}, {fmtShort(m.meeting_date)}</MenuItem>)}
        </TextField>
      </Stack>
      <Fold title="Plus d’options : priorité, suivi, visibilité">
        <Stack spacing={2}>
          <TextField select label="Priorité" value={form.priority} onChange={set('priority')}>
            <MenuItem value="basse">Basse</MenuItem><MenuItem value="normale">Normale</MenuItem><MenuItem value="haute">Haute</MenuItem>
          </TextField>
          <FormControlLabel control={<Checkbox checked={form.take_charge} onChange={set('take_charge')} />} label="Je suis ce sujet" />
          {!restricted && <>
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
          </>}
        </Stack>
      </Fold>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <Button type="submit" variant="contained" size="large" disabled={busy}>Créer le sujet</Button>
    </Box>
  )
}
