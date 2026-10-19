import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Grid, IconButton, Link, MenuItem, Radio, RadioGroup, Snackbar, Stack, Tab, Tabs, TextField,
  Tooltip, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import LockIcon from '@mui/icons-material/LockOutlined'
import { useApp } from '../../App'
import { api, fmtDate, fmtDateTime, fmtShort, periodLabel, SUBJECT_STATUS, SUBJECT_STATUS_ORDER, todayIso } from '../../api'
import { ErrorAlert, Section, SubjectStatusChip, Timeline } from '../../components'
import { mono, palette } from '../../theme'
import Commitments from './Commitments'
import { RequestRow } from './shared'

export default function SubjectDetail() {
  const { id } = useParams()
  const { user, config } = useApp()
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [users, setUsers] = useState([])
  const [meetings, setMeetings] = useState([])
  const [free, setFree] = useState([])
  const [subjects, setSubjects] = useState([])
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [mode, setMode] = useState('answer')
  const [body, setBody] = useState('')
  const [closeIt, setCloseIt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState([])
  const [meetingId, setMeetingId] = useState('')
  const [edit, setEdit] = useState(null)
  const [merge, setMerge] = useState(null)

  const reloadLists = () => {
    api('/requests', { query: { open_only: true, without_subject: true } }).then(setFree).catch(() => {})
  }
  useEffect(() => {
    setS(null); setError(null)
    api(`/subjects/${id}`).then(setS).catch((e) => setError(e.message))
    api('/users').then(setUsers).catch(() => {})
    api('/meetings').then((ms) => setMeetings(ms.filter((m) => m.status === 'planifiee' && m.meeting_date >= todayIso()).reverse())).catch(() => {})
    api('/subjects', { query: { open_only: true } }).then(setSubjects).catch(() => {})
    reloadLists()
  }, [id])

  const run = async (fn, msg) => {
    setError(null); setBusy(true)
    try { const r = await fn(); if (r) setS(r); if (msg) setToast(msg); return true } catch (e) { setError(e.message); return false } finally { setBusy(false) }
  }
  const patch = (data, msg) => run(() => api(`/subjects/${id}`, { method: 'PATCH', body: data }), msg)

  if (!s) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const closed = s.status === 'clos'
  const allowed = users.filter((u) => u.is_active && (s.visible_to_all || s.viewers.some((v) => v.id === u.id)))
  const planned = new Set(s.agenda.map((a) => a.meeting_id))
  const hasRequests = s.request_count > 0
  const heldMeeting = s.agenda.some((a) => a.meeting_status === 'tenue')

  const send = async (e) => {
    e.preventDefault()
    const ok = await run(() => api(`/subjects/${id}/notes`, { method: 'POST', body: { body, answer: mode === 'answer', close: mode === 'answer' && closeIt } }),
      mode === 'answer' ? (hasRequests ? 'Réponse transmise aux salariés' : 'Réponse enregistrée') : 'Note ajoutée')
    if (ok) { setBody(''); setCloseIt(false) }
  }
  const attach = async () => {
    const ok = await run(() => api(`/subjects/${id}/requests`, { method: 'POST', body: { request_ids: picked.map((r) => r.id) } }),
      picked.length > 1 ? 'Demandes rattachées' : 'Demande rattachée')
    if (ok) { setPicked([]); reloadLists() }
  }
  const detach = async (r) => {
    if (!window.confirm(`Détacher la demande « ${r.subject} » de ce sujet ?`)) return
    await run(async () => { await api(`/requests/${r.id}/subject`, { method: 'POST', body: { subject_id: null } }); return api(`/subjects/${id}`) }, 'Demande détachée')
    reloadLists()
  }
  const inscribe = () => run(async () => {
    await api(`/meetings/${meetingId}/items`, { method: 'POST', body: { subject_id: s.id } })
    setMeetingId('')
    return api(`/subjects/${id}`)
  }, 'Inscrit à l’ordre du jour')
  const saveEdit = async (e) => {
    e.preventDefault()
    const { title, description, category, kind, temporality, situation_start, situation_end } = edit
    const ok = await patch({ title, description, category, kind, temporality,
      situation_start: kind === 'signalement' ? situation_start || null : undefined,
      situation_end: kind === 'signalement' ? situation_end || null : undefined }, 'Sujet mis à jour')
    if (ok) setEdit(null)
  }
  const doMerge = async () => {
    try {
      const r = await api(`/subjects/${id}/merge`, { method: 'POST', body: { into: merge.id } })
      setMerge(null); navigate(`/elus/sujets/${r.id}`, { replace: true }); setToast(`Sujet fusionné dans ${r.number}`)
    } catch (e) { setError(e.message) }
  }
  const remove = async () => {
    if (!window.confirm('Supprimer ce sujet ? Ses demandes restent, sans sujet.')) return
    try { await api(`/subjects/${id}`, { method: 'DELETE' }); navigate('/elus/sujets', { replace: true }) } catch (e) { setError(e.message) }
  }

  const kindLabel = s.kind === 'signalement' ? (s.temporality === 'a_venir' ? 'Alerte (à venir)' : 'Alerte (actuelle)') : 'Question'
  return (
    <>
      <Button component={RouterLink} to="/elus/sujets" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>Sujets du CSE</Button>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Chip size="small" variant="outlined" sx={{ fontFamily: mono }} label={s.number} />
        <SubjectStatusChip status={s.status} />
        <Chip size="small" variant="outlined" label={kindLabel} />
        {!s.visible_to_all && <Tooltip title="Sujet réservé à certains élus"><LockIcon fontSize="small" color="action" aria-label="Accès restreint" /></Tooltip>}
      </Stack>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere', flex: 1 }}>{s.title}</Typography>
        <Button size="small" onClick={() => setEdit({ title: s.title, description: s.description || '', category: s.category, kind: s.kind,
          temporality: s.temporality || 'actuel', situation_start: s.situation_start || '', situation_end: s.situation_end || '' })}>Modifier</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        {s.category}, créé le {fmtDate(s.created_at)}{s.created_by ? ` par ${s.created_by.full_name}` : ''}
        {s.kind === 'signalement' && <><br />Situation {periodLabel(s) || 'sans date connue'}</>}
      </Typography>
      <ErrorAlert error={error} onClose={() => setError(null)} />

      <Grid container spacing={4}>
        <Grid item xs={12} md={8}>
          <Section title="Description">
            <Card><CardContent>
              {s.description
                ? <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.description}</Typography>
                : <Typography color="text.secondary">Pas encore de description. Ajoutez le contexte et ce que le CSE attend de la direction.</Typography>}
            </CardContent></Card>
          </Section>

          <Section title={`Demandes des salariés${hasRequests ? ` (${s.request_count})` : ''}`}>
            {!hasRequests && <Typography color="text.secondary" sx={{ mb: 1.5 }}>Aucune demande rattachée : question portée par les élus.</Typography>}
            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {s.requests.map((r) => (
                <RequestRow key={r.id} r={r} action={!closed && (
                  <Tooltip title="Détacher du sujet"><IconButton aria-label="Détacher du sujet" onClick={() => detach(r)}><LinkOffIcon /></IconButton></Tooltip>
                )} />
              ))}
              {s.requests_hidden > 0 && (
                <Typography variant="body2" color="text.secondary">
                  et {s.requests_hidden} demande{s.requests_hidden > 1 ? 's' : ''} à accès restreint (choix du salarié)
                </Typography>
              )}
            </Stack>
            {!closed && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Autocomplete multiple size="small" sx={{ flex: 1 }} options={free} value={picked} onChange={(_, v) => setPicked(v)}
                  getOptionLabel={(r) => `${r.subject} (${r.tracking_code})`} isOptionEqualToValue={(a, b) => a.id === b.id}
                  noOptionsText="Aucune demande sans sujet"
                  renderInput={(p) => <TextField {...p} label="Rattacher des demandes sans sujet" />} />
                <Button variant="outlined" disabled={!picked.length || busy} onClick={attach}>Rattacher</Button>
              </Stack>
            )}
          </Section>

          <Section title="Réponse et notes">
            <Stack spacing={1} sx={{ mb: 2 }}>
              {s.notes.length === 0 && <Typography color="text.secondary">Aucune note pour l’instant.</Typography>}
              {s.notes.map((n) => (
                <Box key={n.id} sx={{ p: 1.5, borderRadius: 2, border: 1,
                  borderColor: n.is_answer ? `${palette.ok}66` : 'divider', bgcolor: n.is_answer ? `${palette.ok}14` : 'background.paper' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                    {n.is_answer ? 'Réponse' : 'Note interne'}{n.author ? `, ${n.author.full_name}` : ''}
                    <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>{` · ${fmtDateTime(n.created_at)}`}</Box>
                  </Typography>
                  <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</Typography>
                </Box>
              ))}
            </Stack>
            <Card component="form" onSubmit={send}>
              <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tab value="answer" label={hasRequests ? 'Répondre aux salariés' : 'Réponse de la direction'} disabled={closed} sx={{ textTransform: 'none', fontWeight: 700 }} />
                <Tab value="note" label="Note interne" sx={{ textTransform: 'none', fontWeight: 700 }} />
              </Tabs>
              <CardContent>
                {closed && mode === 'answer'
                  ? <Alert severity="info">Sujet clos. Rouvrez-le (statut « En cours ») pour répondre.</Alert>
                  : <>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      {mode === 'note' ? 'Visible uniquement par les élus qui ont accès à ce sujet.'
                        : hasRequests ? `La réponse est envoyée à chacun des ${s.request_count} salarié${s.request_count > 1 ? 's' : ''} concerné${s.request_count > 1 ? 's' : ''}, qui la lit avec son numéro de suivi.`
                          : 'Notez la réponse obtenue : le sujet passe en « Réponse apportée ».'}
                    </Typography>
                    <TextField multiline minRows={3} value={body} onChange={(e) => setBody(e.target.value)} label={mode === 'note' ? 'Note interne' : 'Réponse'} />
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mt: 1.5 }}>
                      {mode === 'answer'
                        ? <FormControlLabel control={<Checkbox checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} />} label="Clore le sujet" />
                        : <span />}
                      <Button type="submit" variant="contained" disabled={busy || !body.trim()}>
                        {mode === 'note' ? 'Ajouter la note' : hasRequests ? 'Envoyer la réponse' : 'Enregistrer la réponse'}
                      </Button>
                    </Stack>
                  </>}
              </CardContent>
            </Card>
          </Section>

          <Commitments subject={s} onChange={setS} onToast={setToast} />

          <Section title="Historique">
            <Card><CardContent><Timeline events={[...s.events].map((e) => ({ ...e, public: true })).reverse()} showInternal /></CardContent></Card>
          </Section>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 2 }}>Suivi</Typography>
              <Stack spacing={2}>
                {s.assignee?.id !== user.id && !closed && (
                  <Button variant="outlined" onClick={() => patch({ take_charge: true }, 'Vous suivez ce sujet')}>Je suis ce sujet</Button>
                )}
                <TextField select size="small" label="Suivi par" value={s.assignee?.id || ''}
                  onChange={(e) => patch({ assignee_id: e.target.value }, 'Suivi attribué')}>
                  {allowed.map((u) => <MenuItem key={u.id} value={u.id}>{u.full_name}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Statut" value={s.status} onChange={(e) => patch({ status: e.target.value }, 'Statut modifié')}
                  helperText="« À l’ordre du jour » se met tout seul quand le sujet est inscrit à une réunion.">
                  {SUBJECT_STATUS_ORDER.map((st) => <MenuItem key={st} value={st} disabled={st === 'inscrit_odj'}>{SUBJECT_STATUS[st].label}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Priorité" value={s.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  <MenuItem value="basse">Basse</MenuItem><MenuItem value="normale">Normale</MenuItem><MenuItem value="haute">Haute</MenuItem>
                </TextField>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField type="date" size="small" label="Échéance" value={s.due_date || ''} InputLabelProps={{ shrink: true }}
                    helperText="Date attendue de réponse (suivi)"
                    onChange={(e) => e.target.value && patch({ due_date: e.target.value }, 'Échéance enregistrée')} />
                  {s.due_date && <Button size="small" onClick={() => patch({ due_date: null }, 'Échéance retirée')} sx={{ alignSelf: 'flex-start', mt: 0.5 }}>Retirer</Button>}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Réunions</Typography>
              {s.agenda.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Jamais inscrit à une réunion.</Typography>}
              {s.agenda.map((a) => (
                <Box key={a.item_id} sx={{ mb: 1.5 }}>
                  <Link component={RouterLink} to={`/elus/reunions/${a.meeting_id}`} sx={{ fontWeight: 700 }}>{a.meeting_title}</Link>
                  <Typography variant="body2" color="text.secondary">{fmtShort(a.meeting_date)}{a.discussed ? ', traité' : ''}</Typography>
                  {a.outcome && <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{a.outcome}</Typography>}
                </Box>
              ))}
              {!closed && (meetings.filter((m) => !planned.has(m.id)).length > 0 ? (
                <Stack direction="row" spacing={1}>
                  <TextField select size="small" label="Réunion" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                    {meetings.filter((m) => !planned.has(m.id)).map((m) => <MenuItem key={m.id} value={m.id}>{m.title}, {fmtShort(m.meeting_date)}</MenuItem>)}
                  </TextField>
                  <Button variant="contained" onClick={inscribe} disabled={!meetingId || busy}>Inscrire</Button>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Aucune réunion planifiée disponible. <Link component={RouterLink} to="/elus/reunions">Planifier une réunion</Link>
                </Typography>
              ))}
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1 }}>Visible par</Typography>
              <Typography variant="body2" color="text.secondary">
                {s.visible_to_all ? 'Tous les élus' : s.viewers.map((v) => v.full_name).join(', ')}
              </Typography>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Autres actions</Typography>
              <Stack spacing={1}>
                <Button variant="outlined" onClick={() => setMerge({ id: null })}>Fusionner avec un autre sujet</Button>
                {!heldMeeting && <Button color="error" onClick={remove}>Supprimer le sujet</Button>}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="sm" component="form" onSubmit={saveEdit}>
        <DialogTitle>Modifier le sujet</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Intitulé" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} inputProps={{ maxLength: 200 }} />
              <TextField select label="Thème" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                {[...new Set([...(config?.categories || []), edit.category])].map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
              <RadioGroup row value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                <FormControlLabel value="demande" control={<Radio />} label="Question" />
                <FormControlLabel value="signalement" control={<Radio />} label="Alerte" />
              </RadioGroup>
              {edit.kind === 'signalement' && <>
                <RadioGroup row value={edit.temporality} onChange={(e) => setEdit({ ...edit, temporality: e.target.value })}>
                  <FormControlLabel value="actuel" control={<Radio />} label="Existe déjà" />
                  <FormControlLabel value="a_venir" control={<Radio />} label="Annoncée ou se prépare" />
                </RadioGroup>
                <Stack direction="row" spacing={1}>
                  <TextField type="date" label="Depuis / à partir du" value={edit.situation_start} InputLabelProps={{ shrink: true }}
                    onChange={(e) => setEdit({ ...edit, situation_start: e.target.value })} />
                  <TextField type="date" label="Jusqu’au" value={edit.situation_end} InputLabelProps={{ shrink: true }}
                    onChange={(e) => setEdit({ ...edit, situation_end: e.target.value })} />
                </Stack>
              </>}
              <TextField label="Description" multiline minRows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={busy}>Enregistrer</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!merge} onClose={() => setMerge(null)} fullWidth maxWidth="sm">
        <DialogTitle>Fusionner avec un autre sujet</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Les demandes, notes, engagements et passages en réunion de <strong>{s.number}</strong> sont transférés dans le sujet choisi,
            puis {s.number} disparaît. Les salariés concernés sont prévenus dans leur suivi.
          </Typography>
          <Autocomplete options={subjects.filter((o) => o.id !== s.id)} value={merge?.id ? merge : null}
            onChange={(_, v) => setMerge(v || { id: null })}
            getOptionLabel={(o) => `${o.number} · ${o.title}`} isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(p) => <TextField {...p} label="Fusionner dans" />} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMerge(null)}>Annuler</Button>
          <Button variant="contained" disabled={!merge?.id} onClick={doMerge}>Fusionner</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </>
  )
}
