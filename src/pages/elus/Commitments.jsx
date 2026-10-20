import { useState } from 'react'
import {
  Box, Button, Card, CardContent, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { api, fmtDate, fmtShort } from '../../api'
import { CommitmentChip, DateField, ErrorAlert } from '../../components'

// Engagements de la direction sur un sujet : ce qu'elle a promis, pour quand, et si c'est tenu
export default function Commitments({ subject: r, onChange, onToast }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ text: '', due_date: '', meeting_id: '', public: true })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn, msg) => {
    setError(null); setBusy(true)
    try { onChange(await fn()); if (msg) onToast(msg); return true } catch (e) { setError(e.message); return false } finally { setBusy(false) }
  }
  const add = async (e) => {
    e.preventDefault()
    const ok = await run(() => api(`/subjects/${r.id}/commitments`, { method: 'POST', body: { ...form, meeting_id: form.meeting_id || null } }), 'Engagement enregistré')
    if (ok) { setForm({ text: '', due_date: '', meeting_id: '', public: true }); setOpen(false) }
  }
  const update = (c, body, msg) => run(() => api(`/commitments/${c.id}`, { method: 'PATCH', body }), msg)
  const remove = (c) => window.confirm('Retirer cet engagement ?') && run(() => api(`/commitments/${c.id}`, { method: 'DELETE' }), 'Engagement retiré')

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, gap: 1 }}>
          <Typography variant="h4" component="h2">Engagements de la direction</Typography>
          {!open && <Button size="small" variant="outlined" onClick={() => setOpen(true)}>Ajouter</Button>}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Quand la direction répond avec un délai, notez-le ici : il apparaît dans le suivi (Gantt) jusqu’à ce qu’il soit tenu.
        </Typography>

        {r.commitments.length === 0 && !open && <Typography color="text.secondary">Aucun engagement enregistré.</Typography>}
        <Stack spacing={1.5}>
          {r.commitments.map((c) => (
            <Box key={c.id} sx={{ p: 1.5, border: 1, borderColor: c.late ? 'error.main' : 'divider', borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.text}</Typography>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <CommitmentChip c={c} />
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>Délai : {fmtDate(c.due_date)}</Typography>
                    {c.meeting && <Typography variant="body2" color="text.secondary">annoncé en réunion du {fmtShort(c.meeting.meeting_date)}</Typography>}
                    {!c.public && <Typography variant="body2" color="text.secondary">(non visible des salariés)</Typography>}
                  </Stack>
                </Box>
                <Tooltip title="Retirer"><IconButton size="small" aria-label="Retirer l’engagement" onClick={() => remove(c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.25 }} alignItems={{ sm: 'center' }}>
                {c.status !== 'tenu' && <Button size="small" variant="contained" disabled={busy} onClick={() => update(c, { status: 'tenu' }, 'Engagement tenu')}>Tenu</Button>}
                {c.status === 'en_attente' && <Button size="small" variant="outlined" disabled={busy} onClick={() => update(c, { status: 'non_tenu' }, 'Engagement non tenu')}>Non tenu</Button>}
                {c.status !== 'en_attente' && <Button size="small" disabled={busy} onClick={() => update(c, { status: 'en_attente' })}>Remettre en attente</Button>}
                {c.status === 'en_attente' && (
                  <DateField label="Reporter au" value={null} sx={{ width: 190 }}
                    onCommit={(d) => d && update(c, { due_date: d }, 'Délai reporté')} />
                )}
              </Stack>
            </Box>
          ))}
        </Stack>

        {open && (
          <Box component="form" onSubmit={add} sx={{ mt: 2 }}>
            <Stack spacing={1.5}>
              <TextField label="Ce que la direction s’engage à faire" multiline minRows={2} value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Ex. : réparation du portail par le prestataire" />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField type="date" label="Délai annoncé" InputLabelProps={{ shrink: true }} value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })} required />
                <TextField select label="Annoncé en réunion (facultatif)" value={form.meeting_id} InputLabelProps={{ shrink: true }}
                  SelectProps={{ displayEmpty: true }} onChange={(e) => setForm({ ...form, meeting_id: e.target.value })}>
                  <MenuItem value="">Hors réunion</MenuItem>
                  {r.agenda.map((a) => <MenuItem key={a.item_id} value={a.meeting_id}>{a.meeting_title}, {fmtShort(a.meeting_date)}</MenuItem>)}
                </TextField>
              </Stack>
              <FormControlLabel control={<Checkbox checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />}
                label="Visible des salariés dans leur suivi" />
              <Stack direction="row" spacing={1}>
                <Button type="submit" variant="contained" disabled={busy || !form.text.trim() || !form.due_date}>Enregistrer l’engagement</Button>
                <Button onClick={() => setOpen(false)}>Annuler</Button>
              </Stack>
            </Stack>
          </Box>
        )}
        <ErrorAlert error={error} onClose={() => setError(null)} />
      </CardContent>
    </Card>
  )
}
