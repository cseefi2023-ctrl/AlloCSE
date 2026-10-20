import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Grid, IconButton, Link, MenuItem, Radio, RadioGroup, Snackbar, Stack, Tab, Tabs, TextField,
  Tooltip, Typography,
} from '@mui/material'
import AddLinkIcon from '@mui/icons-material/AddLink'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import LockIcon from '@mui/icons-material/LockOutlined'
import { useApp } from '../../App'
import { api, fmtDate, fmtDateTime, fmtShort, periodLabel, SUBJECT_STATUS, SUBJECT_STATUS_ORDER, todayIso } from '../../api'
import { DateField, ErrorAlert, Fold, MoreMenu, Section, Timeline } from '../../components'
import { palette } from '../../theme'
import Commitments from './Commitments'
import { RequestRow, SubjectChips } from './shared'

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
  const [attachOpen, setAttachOpen] = useState(false)
  const [picked, setPicked] = useState([])
  const [meetingId, setMeetingId] = useState('')
  const [more, setMore] = useState(false)
  const [edit, setEdit] = useState(null)
  const [merge, setMerge] = useState(null)

  const reloadFree = () => {
    api('/requests', { query: { open_only: true, without_subject: true } }).then(setFree).catch(() => {})
  }
  useEffect(() => {
    setS(null); setError(null); setAttachOpen(false); setPicked([])
    api(`/subjects/${id}`).then(setS).catch((e) => setError(e.message))
    api('/users').then(setUsers).catch(() => {})
    api('/meetings').then((ms) => setMeetings(ms.filter((m) => m.status === 'planifiee' && m.meeting_date >= todayIso()).reverse())).catch(() => {})
    api('/subjects', { query: { open_only: true } }).then(setSubjects).catch(() => {})
    reloadFree()
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
  const freeMeetings = meetings.filter((m) => !planned.has(m.id))
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
    if (ok) { setPicked([]); setAttachOpen(false); reloadFree() }
  }
  const detach = async (r) => {
    if (!window.confirm(`Détacher la demande « ${r.subject} » de ce sujet ?`)) return
    await run(async () => { await api(`/requests/${r.id}/subject`, { method: 'POST', body: { subject_id: null } }); return api(`/subjects/${id}`) }, 'Demande détachée')
    reloadFree()
  }
  const inscribe = () => run(async () => {
    await api(`/meetings/${meetingId}/items`, { method: 'POST', body: { subject_id: s.id } })
    setMeetingId('')
    return api(`/subjects/${id}`)
  }, 'Inscrit à l’ordre du jour')
  const openEdit = () => setEdit({
    title: s.title, description: s.description || '', category: s.category, kind: s.kind,
    temporality: s.temporality || 'actuel', situation_start: s.situation_start || '', situation_end: s.situation_end || '',
  })
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

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1, ml: -1 }}>
        <Button component={RouterLink} to="/elus/sujets" startIcon={<ArrowBackIcon />} size="small">Sujets du CSE</Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={openEdit}>Modifier</Button>
        <MoreMenu items={[
          { label: 'Fusionner avec un autre sujet', onClick: () => setMerge({ id: null }) },
          !heldMeeting && { label: 'Supprimer le sujet', danger: true, onClick: remove },
        ]} />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <SubjectChips s={s} />
      </Stack>
      <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{s.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {s.number} · {s.category} · créé le {fmtDate(s.created_at)}{s.created_by ? ` par ${s.created_by.full_name}` : ''}
      </Typography>
      {s.kind === 'signalement' && <Typography variant="body2" color="text.secondary">Situation {periodLabel(s) || 'sans date connue'}</Typography>}
      {!s.visible_to_all && (
        <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <LockIcon sx={{ fontSize: 16 }} /> Visible seulement par {s.viewers.map((v) => v.full_name).join(', ')}
        </Typography>
      )}
      {s.description
        ? <Typography sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.description}</Typography>
        : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Pas encore de description. <Link component="button" type="button" onClick={openEdit} sx={{ verticalAlign: 'baseline' }}>Ajouter le contexte</Link>
          </Typography>
        )}
      <ErrorAlert error={error} onClose={() => setError(null)} />

      <Section title={`Demandes des salariés${hasRequests ? ` (${s.request_count})` : ''}`} sx={{ mt: 3 }}>
        {!hasRequests && <Typography color="text.secondary" sx={{ mb: 1.5 }}>Aucune demande rattachée : question portée par les élus.</Typography>}
        <Stack spacing={1} sx={{ mb: 1.5 }}>
          {s.requests.map((r) => (
            <RequestRow key={r.id} r={r} showSubject={false} action={!closed && (
              <Tooltip title="Détacher du sujet"><IconButton aria-label="Détacher du sujet" onClick={() => detach(r)}><LinkOffIcon /></IconButton></Tooltip>
            )} />
          ))}
          {s.requests_hidden > 0 && (
            <Typography variant="body2" color="text.secondary">
              et {s.requests_hidden} demande{s.requests_hidden > 1 ? 's' : ''} à accès restreint (choix du salarié)
            </Typography>
          )}
        </Stack>
        {!closed && !attachOpen && (
          <Button variant="outlined" startIcon={<AddLinkIcon />} onClick={() => setAttachOpen(true)}>Rattacher des demandes</Button>
        )}
        <Collapse in={!closed && attachOpen} unmountOnExit>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Autocomplete multiple size="small" sx={{ flex: 1 }} options={free} value={picked} onChange={(_, v) => setPicked(v)} openOnFocus
              getOptionLabel={(r) => `${r.subject} (${r.tracking_code})`} isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText="Aucune demande sans sujet"
              renderInput={(p) => <TextField {...p} label="Demandes sans sujet" autoFocus />} />
            <Button variant="contained" disabled={!picked.length || busy} onClick={attach}>Rattacher</Button>
            <Button onClick={() => { setAttachOpen(false); setPicked([]) }}>Annuler</Button>
          </Stack>
        </Collapse>
      </Section>

      <Section title="Réponse et notes">
        <Stack spacing={1} sx={{ mb: 2 }}>
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
          <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="answer" label={hasRequests ? 'Répondre aux salariés' : 'Réponse de la direction'} disabled={closed} sx={{ textTransform: 'none', fontWeight: 700 }} />
            <Tab value="note" label="Note interne" sx={{ textTransform: 'none', fontWeight: 700 }} />
          </Tabs>
          <CardContent>
            {closed && mode === 'answer'
              ? <Alert severity="info">Sujet clos. Pour répondre, repassez-le « En cours » dans le suivi ci-dessous.</Alert>
              : <>
                <TextField multiline minRows={3} value={body} onChange={(e) => setBody(e.target.value)} label={mode === 'note' ? 'Note interne' : 'Réponse'}
                  helperText={mode === 'note' ? 'Visible seulement par les élus qui ont accès à ce sujet.'
                    : hasRequests ? (s.request_count > 1 ? `Envoyée à chacun des ${s.request_count} salariés concernés, qui la lisent avec leur numéro de suivi.` : 'Envoyée au salarié concerné, qui la lit avec son numéro de suivi.')
                      : 'Notez la réponse obtenue : le sujet passe en « Réponse apportée ».'} />
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mt: 1 }}>
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

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Suivi</Typography>
              <Stack spacing={2}>
                {s.assignee?.id !== user.id && !closed && (
                  <Button variant="outlined" onClick={() => patch({ take_charge: true }, 'Vous suivez ce sujet')}>Je suis ce sujet</Button>
                )}
                <TextField select size="small" label="Suivi par" value={s.assignee?.id || ''}
                  onChange={(e) => patch({ assignee_id: e.target.value }, 'Suivi attribué')}>
                  {allowed.map((u) => <MenuItem key={u.id} value={u.id}>{u.full_name}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Statut" value={s.status} onChange={(e) => patch({ status: e.target.value }, 'Statut modifié')}>
                  {SUBJECT_STATUS_ORDER.map((st) => <MenuItem key={st} value={st} disabled={st === 'inscrit_odj'}>{SUBJECT_STATUS[st].label}</MenuItem>)}
                </TextField>
              </Stack>
              <Button size="small" onClick={() => setMore(!more)} sx={{ mt: 1, ml: -1 }} aria-expanded={more}>
                {more ? 'Moins de réglages' : 'Échéance, priorité…'}
              </Button>
              <Collapse in={more} unmountOnExit>
                <Stack spacing={2} sx={{ pt: 1.5 }}>
                  <DateField label="Échéance" value={s.due_date} helperText="Date attendue de réponse. Videz le champ pour la retirer."
                    onCommit={(d) => patch({ due_date: d }, d ? 'Échéance enregistrée' : 'Échéance retirée')} />
                  <TextField select size="small" label="Priorité" value={s.priority} onChange={(e) => patch({ priority: e.target.value }, 'Priorité modifiée')}>
                    <MenuItem value="basse">Basse</MenuItem><MenuItem value="normale">Normale</MenuItem><MenuItem value="haute">Haute</MenuItem>
                  </TextField>
                </Stack>
              </Collapse>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Réunions</Typography>
              {s.agenda.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Pas encore inscrit à une réunion.</Typography>}
              {s.agenda.map((a) => (
                <Box key={a.item_id} sx={{ mb: 1.5 }}>
                  <Link component={RouterLink} to={`/elus/reunions/${a.meeting_id}`} sx={{ fontWeight: 700 }}>{a.meeting_title}</Link>
                  <Typography variant="body2" color="text.secondary">{fmtShort(a.meeting_date)}{a.discussed ? ', traité' : ''}</Typography>
                  {a.outcome && <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{a.outcome}</Typography>}
                </Box>
              ))}
              {!closed && (freeMeetings.length > 0 ? (
                <Stack direction="row" spacing={1}>
                  <TextField select size="small" label="Inscrire à" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                    {freeMeetings.map((m) => <MenuItem key={m.id} value={m.id}>{m.title}, {fmtShort(m.meeting_date)}</MenuItem>)}
                  </TextField>
                  <Button variant="contained" onClick={inscribe} disabled={!meetingId || busy}>Inscrire</Button>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Aucune réunion planifiée. <Link component={RouterLink} to="/elus/reunions">Planifier une réunion</Link>
                </Typography>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Commitments subject={s} onChange={setS} onToast={setToast} />

      <Fold title={`Historique (${s.events.length})`}>
        <Card><CardContent><Timeline events={[...s.events].map((e) => ({ ...e, public: true })).reverse()} showInternal /></CardContent></Card>
      </Fold>

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="sm" component="form" onSubmit={saveEdit}>
        <DialogTitle>Modifier le sujet</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Intitulé" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} inputProps={{ maxLength: 200 }} />
              <TextField label="Description" multiline minRows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                helperText="Contexte, ce que le CSE attend de la direction. Visible des élus seulement." />
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
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField type="date" label="Depuis / à partir du" value={edit.situation_start} InputLabelProps={{ shrink: true }}
                    onChange={(e) => setEdit({ ...edit, situation_start: e.target.value })} />
                  <TextField type="date" label="Jusqu’au" value={edit.situation_end} InputLabelProps={{ shrink: true }}
                    inputProps={{ min: edit.situation_start || undefined }}
                    onChange={(e) => setEdit({ ...edit, situation_end: e.target.value })} />
                </Stack>
              </>}
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
    </Box>
  )
}
