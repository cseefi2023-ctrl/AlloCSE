import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Box, Button, Card, CardActionArea, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, MenuItem, Radio, RadioGroup, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import LockIcon from '@mui/icons-material/LockOutlined'
import { api, fmtShort, MEETING_KINDS, todayIso } from '../../api'
import { ErrorAlert, Section, useNarrow } from '../../components'
import { palette } from '../../theme'
import { MeetingsHeader } from './shared'

const tint = (c) => ({ bgcolor: `${c}1F`, color: c, border: `1px solid ${c}55` })
const SHOWN = 10

const plusDays = (n) => {
  const d = new Date(`${todayIso()}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// Date limite enregistrée au lendemain 0 h (heure de Paris) : affichée « jusqu'au 30 octobre inclus »
export function deadlineLabel(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const tz = { timeZone: 'Europe/Paris' }
  const hm = d.toLocaleTimeString('fr-FR', { ...tz, hour: '2-digit', minute: '2-digit' })
  if (hm === '00:00') {
    return `jusqu’au ${new Date(d.getTime() - 60000).toLocaleDateString('fr-FR', { ...tz, day: 'numeric', month: 'long' })} inclus`
  }
  return `jusqu’au ${d.toLocaleString('fr-FR', { ...tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
}

export const countsLine = (v) => (v.counts ? v.options.map((o, i) => `${o} ${v.counts[i]}`).join(' · ') : null)

// Résultat : adoptée / rejetée (pour, contre, abstention) ou réponse la plus choisie
export function VoteOutcome({ v, size = 'small' }) {
  if (v.result === 'adopte') return <Chip size={size} label="Adoptée" sx={tint(palette.ok)} />
  if (v.result === 'rejete') return <Chip size={size} label="Rejetée" sx={tint(palette.alert)} />
  if (v.winners?.length === 1) return <Chip size={size} label={`Choix : ${v.winners[0]}`} sx={{ ...tint(palette.ok), maxWidth: '100%' }} />
  if (v.winners?.length > 1) return <Chip size={size} label={`Égalité : ${v.winners.join(', ')}`} variant="outlined" sx={{ maxWidth: '100%' }} />
  if (v.status === 'clos' && v.mode === 'en_ligne') return <Chip size={size} label="Aucun vote" variant="outlined" />
  return null
}

export function VoteStateChip({ v }) {
  if (v.mode === 'en_ligne' && v.status === 'ouvert') {
    if (v.can_vote && !v.i_voted) {
      return <Chip size="small" label="À voter" sx={{ bgcolor: `${palette.signal}33`, color: 'text.primary', border: `1px solid ${palette.signal}` }} />
    }
    if (v.i_voted) return <Chip size="small" label="Vous avez voté" sx={tint(palette.ok)} />
    return <Chip size="small" label="En cours" variant="outlined" />
  }
  if (v.mode === 'seance' && !v.recorded) return <Chip size="small" label="Résultat à noter" variant="outlined" sx={{ borderStyle: 'dashed' }} />
  return <VoteOutcome v={v} />
}

export function VoteChips({ v }) {
  return (
    <>
      <VoteStateChip v={v} />
      <Chip size="small" variant="outlined" label={v.mode === 'en_ligne' ? 'En ligne' : 'En séance'} />
      {v.secret && <Chip size="small" variant="outlined" icon={<LockIcon />} label="Bulletin secret" />}
    </>
  )
}

export function VoteRow({ v, showMeeting = true, extra }) {
  const meta = v.mode === 'en_ligne'
    ? [v.status === 'ouvert' ? deadlineLabel(v.deadline) || 'sans date limite' : v.closed_at && `clos le ${fmtShort(v.closed_at)}`,
      `${v.voters_count} votant${v.voters_count > 1 ? 's' : ''} sur ${v.eligible_count}`, extra]
    : [showMeeting && (v.meeting ? `${v.meeting.title}, ${fmtShort(v.meeting.meeting_date)}` : 'réunion non précisée'), extra]
  return (
    <Card>
      <CardActionArea component={RouterLink} to={`/elus/votes/${v.id}`} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
          <VoteChips v={v} />
        </Stack>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{v.title}</Typography>
        {meta.some(Boolean) && <Typography variant="body2" color="text.secondary">{meta.filter(Boolean).join(' · ')}</Typography>}
        {v.counts && <Typography variant="body2" sx={{ mt: 0.25 }}>{countsLine(v)}</Typography>}
      </CardActionArea>
    </Card>
  )
}

export default function Votes() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  useEffect(() => { api('/votes').then(setRows).catch((e) => setError(e.message)) }, [])

  const online = rows?.filter((v) => v.mode === 'en_ligne' && v.status === 'ouvert') || []
  const toRecord = (rows?.filter((v) => v.mode === 'seance' && !v.recorded) || [])
    .sort((a, b) => String(a.meeting?.meeting_date || '9').localeCompare(String(b.meeting?.meeting_date || '9')))
  const done = rows?.filter((v) => v.status === 'clos') || []

  return (
    <Box sx={{ maxWidth: 860 }}>
      <MeetingsHeader action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Nouveau vote</Button>} />
      <ErrorAlert error={error} />
      {rows && rows.length === 0 && (
        <Card sx={{ p: 2.5, mb: 3 }}>
          <Typography sx={{ mb: 0.5 }}>Aucun vote pour l’instant.</Typography>
          <Typography variant="body2" color="text.secondary">
            « Nouveau vote » : un vote en séance (vous notez le nombre de voix pendant la réunion),
            ou un vote en ligne entre élus (chacun vote dans l’appli avant une date limite).
          </Typography>
        </Card>
      )}
      {online.length > 0 && (
        <Section title="En ligne, en cours">
          <Stack spacing={1}>{online.map((v) => <VoteRow key={v.id} v={v} />)}</Stack>
        </Section>
      )}
      {toRecord.length > 0 && (
        <Section title="En séance, résultat à noter">
          <Stack spacing={1}>{toRecord.map((v) => <VoteRow key={v.id} v={v} />)}</Stack>
        </Section>
      )}
      {done.length > 0 && (
        <Section title="Résultats">
          <Stack spacing={1}>{(all ? done : done.slice(0, SHOWN)).map((v) => <VoteRow key={v.id} v={v} />)}</Stack>
          {done.length > SHOWN && !all && <Button onClick={() => setAll(true)} sx={{ mt: 1 }}>Voir les {done.length} résultats</Button>}
        </Section>
      )}
      <NewVoteDialog open={open} onClose={() => setOpen(false)} />
    </Box>
  )
}

// Nouveau vote. meeting : réunion déjà choisie (depuis la page de la réunion), avec ses points
export function NewVoteDialog({ open, onClose, meeting, itemId, onCreated }) {
  const navigate = useNavigate()
  const fresh = () => ({
    mode: meeting ? 'seance' : 'en_ligne', title: '', description: '', meeting_id: meeting?.id || '', agenda_item_id: itemId || '',
    secret: false, custom: false, options: ['', ''], deadline: plusDays(7), withTally: false, tally: ['', '', ''],
  })
  const [f, setF] = useState(fresh)
  const [meetings, setMeetings] = useState([])
  const [items, setItems] = useState(meeting?.items || [])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const narrow = useNarrow()
  const set = (patch) => setF((x) => ({ ...x, ...patch }))

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setF(fresh()); setError(null); setBusy(false) } }, [open])
  useEffect(() => {
    if (!open || meeting) return
    api('/meetings').then((ms) => {
      const usable = ms.filter((m) => m.status !== 'annulee')
      setMeetings(usable)
      // Par défaut : la prochaine réunion planifiée, sinon la plus récente
      const next = usable.filter((m) => m.status === 'planifiee' && m.meeting_date >= todayIso()).reverse()[0] || usable[0]
      if (next) setF((x) => (x.meeting_id ? x : { ...x, meeting_id: next.id }))
    }).catch(() => {})
  }, [open, meeting])
  useEffect(() => {
    if (!open) return
    if (meeting && f.meeting_id === meeting.id) { setItems(meeting.items || []); return }
    if (!f.meeting_id) { setItems([]); return }
    api(`/meetings/${f.meeting_id}`).then((m) => setItems(m.items)).catch(() => setItems([]))
  }, [open, f.meeting_id, meeting])

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (f.title.trim().length < 3) return setError('Indiquez la question soumise au vote.')
    const body = { title: f.title, description: f.description, mode: f.mode, secret: f.secret }
    if (f.mode === 'seance') {
      body.meeting_id = f.meeting_id || null
      body.agenda_item_id = f.agenda_item_id || null
      if (f.withTally) body.tally = f.tally.map((x) => Number(x || 0))
    } else {
      body.deadline = f.deadline || null
      if (f.custom) body.options = f.options
    }
    setBusy(true)
    try {
      const v = await api('/votes', { method: 'POST', body })
      onClose()
      if (onCreated) onCreated(v)
      else navigate(`/elus/votes/${v.id}`)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const meetingChoices = meeting ? [meeting] : meetings
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={narrow} component="form" onSubmit={submit}>
      <DialogTitle>Nouveau vote</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <ToggleButtonGroup exclusive fullWidth color="primary" value={f.mode} onChange={(_, m) => m && set({ mode: m })} aria-label="Type de vote">
              <ToggleButton value="en_ligne" sx={{ fontWeight: 700 }}>En ligne entre élus</ToggleButton>
              <ToggleButton value="seance" sx={{ fontWeight: 700 }}>En séance</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {f.mode === 'en_ligne'
                ? 'Chaque élu vote dans l’appli jusqu’à la date limite. Les résultats s’affichent à la clôture.'
                : 'Le vote a lieu pendant la réunion : vous notez ensuite le nombre de voix, repris dans le PV.'}
            </Typography>
          </Box>
          <TextField label="Question soumise au vote" value={f.title} onChange={(e) => set({ title: e.target.value })} required
            inputProps={{ maxLength: 300 }}
            placeholder={f.mode === 'en_ligne' ? 'Ex. : destination de la sortie familiale' : 'Ex. : avis du CSE sur le projet de réorganisation'} />
          <TextField label="Détails (facultatif)" value={f.description} onChange={(e) => set({ description: e.target.value })} multiline minRows={2} />

          {f.mode === 'en_ligne' ? <>
            <RadioGroup value={f.custom ? 'libre' : 'pca'} onChange={(e) => set({ custom: e.target.value === 'libre' })}>
              <FormControlLabel value="pca" control={<Radio />} label="Pour / Contre / Abstention" />
              <FormControlLabel value="libre" control={<Radio />} label="Choix libres (par exemple plusieurs devis)" />
            </RadioGroup>
            <Collapse in={f.custom} unmountOnExit>
              <Stack spacing={1}>
                {f.options.map((o, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="center">
                    <TextField size="small" label={`Réponse ${i + 1}`} value={o} inputProps={{ maxLength: 120 }}
                      onChange={(e) => set({ options: f.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                    {f.options.length > 2 && (
                      <Tooltip title="Retirer"><IconButton aria-label={`Retirer la réponse ${i + 1}`} onClick={() => set({ options: f.options.filter((_, j) => j !== i) })}><CloseIcon /></IconButton></Tooltip>
                    )}
                  </Stack>
                ))}
                {f.options.length < 8 && (
                  <Button size="small" startIcon={<AddIcon />} onClick={() => set({ options: [...f.options, ''] })} sx={{ alignSelf: 'flex-start' }}>
                    Ajouter une réponse
                  </Button>
                )}
              </Stack>
            </Collapse>
            <TextField type="date" label="Date limite (incluse)" InputLabelProps={{ shrink: true }} value={f.deadline}
              inputProps={{ min: todayIso() }} onChange={(e) => set({ deadline: e.target.value })}
              helperText="Videz le champ pour clore le vote vous-même." />
          </> : <>
            <TextField select label="Réunion" value={f.meeting_id} disabled={!!meeting} InputLabelProps={{ shrink: true }}
              SelectProps={{ displayEmpty: true }} onChange={(e) => set({ meeting_id: e.target.value, agenda_item_id: '' })}>
              <MenuItem value="">Non précisée</MenuItem>
              {meetingChoices.map((m) => (
                <MenuItem key={m.id} value={m.id}>{m.title}, {fmtShort(m.meeting_date)} ({MEETING_KINDS[m.kind]?.toLowerCase()})</MenuItem>
              ))}
            </TextField>
            {items.length > 0 && (
              <TextField select label="Point de l’ordre du jour (facultatif)" value={f.agenda_item_id} InputLabelProps={{ shrink: true }}
                SelectProps={{ displayEmpty: true }} onChange={(e) => set({ agenda_item_id: e.target.value })}>
                <MenuItem value="">Aucun point en particulier</MenuItem>
                {items.filter((it) => !it.restricted).map((it, i) => <MenuItem key={it.id} value={it.id}>{i + 1}. {it.title}</MenuItem>)}
              </TextField>
            )}
            <FormControlLabel control={<Switch checked={f.withTally} onChange={(e) => set({ withTally: e.target.checked })} />}
              label="Noter le résultat maintenant" />
            <Collapse in={f.withTally} unmountOnExit>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                {['Pour', 'Contre', 'Abstention'].map((o, i) => (
                  <TextField key={o} type="number" label={o} value={f.tally[i]} inputProps={{ min: 0, max: 999, inputMode: 'numeric' }}
                    onChange={(e) => set({ tally: f.tally.map((x, j) => (j === i ? e.target.value : x)) })} />
                ))}
              </Stack>
            </Collapse>
          </>}
          <FormControlLabel control={<Checkbox checked={f.secret} onChange={(e) => set({ secret: e.target.checked })} />}
            label={<span>Bulletin secret
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
                {f.mode === 'en_ligne'
                  ? 'Personne ne voit qui a voté quoi ; un vote ne peut plus être changé.'
                  : 'Mentionné dans le PV.'}
              </Typography></span>} />
        </Stack>
        <ErrorAlert error={error} onClose={() => setError(null)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="contained" disabled={busy}>Créer le vote</Button>
      </DialogActions>
    </Dialog>
  )
}
