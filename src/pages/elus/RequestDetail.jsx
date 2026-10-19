import { useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, CircularProgress, Divider, FormControlLabel, Grid, Link,
  MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useApp } from '../../App'
import { api, fmtDate, fmtShort, periodLabel, STATUS, STATUS_ORDER } from '../../api'
import { ErrorAlert, KindChip, MessageList, Section, StatusChip, StatusTrack, Timeline } from '../../components'
import { mono } from '../../theme'
import { SubjectChip } from './shared'
import Commitments from './Commitments'

const MODES = {
  answer: { label: 'Répondre', hint: 'Réponse officielle : le salarié la lit avec son numéro de suivi. Inutile d’attendre la réunion si vous avez la réponse.', button: 'Envoyer la réponse' },
  message: { label: 'Question au salarié', hint: 'Demander une précision au salarié, sans clore le sujet.', button: 'Envoyer le message' },
  internal: { label: 'Note interne', hint: 'Visible uniquement par les élus autorisés à voir cette demande.', button: 'Ajouter la note' },
}

export default function RequestDetail() {
  const { id } = useParams()
  const { user } = useApp()
  const [r, setR] = useState(null)
  const [users, setUsers] = useState([])
  const [meetings, setMeetings] = useState([])
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('answer')
  const [body, setBody] = useState('')
  const [closeIt, setCloseIt] = useState(false)
  const [alsoLinked, setAlsoLinked] = useState(true)
  const [others, setOthers] = useState([])
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [meetingId, setMeetingId] = useState('')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    setR(null); setError(null)
    api(`/requests/${id}`).then(setR).catch((e) => setError(e.message))
    api('/users').then(setUsers).catch(() => {})
    api('/meetings').then((ms) => setMeetings(ms.filter((m) => m.status === 'planifiee'))).catch(() => {})
    api('/requests', { query: { open_only: true } }).then(setOthers).catch(() => {})
    setPick(null)
  }, [id])

  // Tri : nouveau sujet, association à un sujet existant, dissociation
  const triage = async (body, msg, otherId) => {
    try {
      await api(`/requests/${otherId || id}/triage`, body === null ? { method: 'DELETE' } : { method: 'POST', body })
      setR(await api(`/requests/${id}`)); setPick(null); setToast(msg)
      api('/requests', { query: { open_only: true } }).then(setOthers).catch(() => {})
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
        body: { body, internal: mode === 'internal', is_answer: mode === 'answer', close: mode === 'answer' && closeIt, also_linked: alsoLinked },
      }))
      setBody(''); setCloseIt(false)
      setToast(mode === 'internal' ? 'Note ajoutée' : 'Envoyé au salarié')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const addToAgenda = async () => {
    try {
      await api(`/meetings/${meetingId}/items`, { method: 'POST', body: { request_id: r.id } })
      setR(await api(`/requests/${id}`)); setMeetingId(''); setToast('Inscrite à l’ordre du jour')
    } catch (e) { setError(e.message) }
  }

  if (!r) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const allowed = users.filter((u) => u.is_active && (r.visible_to_all || r.viewers.some((v) => v.id === u.id)))
  const closed = r.status === 'close'
  const plannedIds = new Set(r.agenda.map((a) => a.meeting_id))
  const linkedTotal = r.linked.length + r.linked_hidden
  const kindLabel = (o) => (o.kind === 'signalement' ? 'Signalement' : 'Demande')
  const optionLabel = (o) => `${o.number || 'À trier'} · ${kindLabel(o)} · ${o.subject} (${o.tracking_code})`
  // Sujets auxquels associer cette demande (sujets principaux uniquement)
  const subjects = others.filter((o) => o.id !== r.id && !o.parent_id)
    .sort((a, b) => (!!b.number - !!a.number) || (b.id - a.id))
  // Demandes à rattacher à ce sujet
  const attachable = others.filter((o) => o.id !== r.id && o.parent_id !== r.id && !o.linked_count)

  return (
    <>
      <Button component={RouterLink} to="/elus/demandes" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>Demandes</Button>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <SubjectChip r={r} />
        <StatusChip status={r.status} />
        <KindChip kind={r.kind} temporality={r.temporality} />
      </Stack>
      <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{r.subject}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        <Box component="span" sx={{ fontFamily: mono }}>{r.tracking_code}</Box>, {r.category}, déposée le {fmtDate(r.created_at)}
        {r.kind === 'signalement' && <><br />Situation {periodLabel(r) || 'sans date connue'}</>}
      </Typography>
      <StatusTrack status={r.status} agenda={r.agenda.length > 0} />
      <ErrorAlert error={error} onClose={() => setError(null)} />

      <Grid container spacing={4}>
        <Grid item xs={12} md={8}>
          <Section title="Échanges">
            <MessageList viewer="elu" messages={[{ id: 'orig', author_type: r.origin === 'elu' ? 'elu' : 'salarie', author: r.origin === 'elu' ? r.created_by : null, body: r.description, created_at: r.created_at, internal: false, is_answer: false }, ...r.messages]} />
          </Section>

          <Card component="form" onSubmit={send} sx={{ mb: 4 }}>
            <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider' }}>
              {Object.entries(MODES).filter(([k]) => !(r.origin === 'elu' && k === 'message')).map(([k, m]) => <Tab key={k} value={k} label={m.label} disabled={closed && k !== 'internal'} sx={{ textTransform: 'none', fontWeight: 700 }} />)}
            </Tabs>
            <CardContent>
              {closed && mode !== 'internal'
                ? <Alert severity="info">Demande clôturée. Rouvrez-la (statut « En cours d’étude ») pour écrire au salarié.</Alert>
                : <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{MODES[mode].hint}</Typography>
                  <TextField multiline minRows={4} value={body} onChange={(e) => setBody(e.target.value)} label={MODES[mode].label} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ mt: 1.5 }}>
                    {mode === 'answer'
                      ? (
                        <Stack>
                          <FormControlLabel control={<Checkbox checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} />} label="Clôturer la demande" />
                          {linkedTotal > 0 && (
                            <FormControlLabel control={<Checkbox checked={alsoLinked} onChange={(e) => setAlsoLinked(e.target.checked)} />}
                              label={linkedTotal > 1 ? `Envoyer aussi aux ${linkedTotal} demandes associées` : 'Envoyer aussi à la demande associée'} />
                          )}
                        </Stack>
                      ) : <span />}
                    <Button type="submit" variant="contained" disabled={busy || !body.trim()}>{MODES[mode].button}</Button>
                  </Stack>
                </>}
            </CardContent>
          </Card>

          <Commitments r={r} onChange={setR} onToast={setToast} />

          <Section title="Historique">
            <Card><CardContent><Timeline events={[...r.events].reverse()} showInternal /></CardContent></Card>
          </Section>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Sujet</Typography>
              {!r.number && (
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    À trier : nouveau sujet, ou même sujet qu’une demande ou un signalement déjà reçu ? Le numéro de sujet est attribué à cette décision.
                  </Typography>
                  <Button variant="contained" onClick={() => triage({}, 'Nouveau sujet créé')}>Nouveau sujet</Button>
                  <Autocomplete size="small" options={subjects} value={pick} onChange={(_, v) => setPick(v)}
                    getOptionLabel={optionLabel} isOptionEqualToValue={(a, b) => a.id === b.id}
                    renderInput={(params) => <TextField {...params} label="Associer à un sujet existant" />} />
                  <Button variant="outlined" disabled={!pick} onClick={() => triage({ parent_id: pick.id }, 'Demande associée')}>Associer</Button>
                </Stack>
              )}
              {r.number && r.parent_id && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontFamily: mono, fontWeight: 700, fontSize: '1.25rem' }}>{r.number}</Typography>
                  {r.parent ? (
                    <Typography variant="body2">
                      Associée au {r.parent.kind === 'signalement' ? 'signalement' : 'sujet'}{' '}
                      <Link component={RouterLink} to={`/elus/demandes/${r.parent.id}`} sx={{ fontWeight: 700 }}>{r.parent.subject}</Link>
                      {' '}(<Box component="span" sx={{ fontFamily: mono }}>{r.parent.tracking_code}</Box>). Elle est traitée avec lui : ordre du jour, réponse, statut.
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">Associée à un sujet dont le demandeur a restreint l’accès.</Typography>
                  )}
                  <Button variant="outlined" onClick={() => triage(null, 'Demande dissociée : à trier')}>Dissocier</Button>
                </Stack>
              )}
              {r.number && !r.parent_id && (
                <Stack spacing={1.5}>
                  <Typography sx={{ fontFamily: mono, fontWeight: 700, fontSize: '1.25rem' }}>{r.number}</Typography>
                  {linkedTotal === 0
                    ? <Typography variant="body2" color="text.secondary">Aucune autre demande associée.</Typography>
                    : (
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                          Soulevé aussi par {linkedTotal} autre{linkedTotal > 1 ? 's' : ''} demande{linkedTotal > 1 ? 's' : ''}
                        </Typography>
                        {r.linked.map((c) => (
                          <Typography key={c.id} variant="body2">
                            <Link component={RouterLink} to={`/elus/demandes/${c.id}`}>{c.subject}</Link>
                            <Box component="span" sx={{ color: 'text.secondary' }}>{` · ${kindLabel(c)} · `}<Box component="span" sx={{ fontFamily: mono }}>{c.tracking_code}</Box></Box>
                          </Typography>
                        ))}
                        {r.linked_hidden > 0 && <Typography variant="body2" color="text.secondary">et {r.linked_hidden} à accès restreint</Typography>}
                      </Box>
                    )}
                  <Autocomplete size="small" options={attachable} value={pick} onChange={(_, v) => setPick(v)}
                    getOptionLabel={optionLabel} isOptionEqualToValue={(a, b) => a.id === b.id}
                    renderInput={(params) => <TextField {...params} label="Associer une autre demande à ce sujet" />} />
                  <Button variant="outlined" disabled={!pick} onClick={() => triage({ parent_id: r.id }, 'Demande associée à ce sujet', pick.id)}>Associer</Button>
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 2 }}>Traitement</Typography>
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
                {r.kind === 'signalement' && (
                  <Stack direction="row" spacing={1}>
                    <TextField type="date" size="small" label="Situation depuis" value={r.situation_start || ''} InputLabelProps={{ shrink: true }}
                      onChange={(e) => patch({ situation_start: e.target.value || null }, 'Période enregistrée')} />
                    <TextField type="date" size="small" label="Jusqu’au" value={r.situation_end || ''} InputLabelProps={{ shrink: true }}
                      inputProps={{ min: r.situation_start || undefined }}
                      onChange={(e) => patch({ situation_end: e.target.value || null }, 'Période enregistrée')} />
                  </Stack>
                )}
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField type="date" size="small" label="Échéance" value={r.due_date || ''} InputLabelProps={{ shrink: true }}
                    helperText="Date attendue de réponse (diagramme de suivi)"
                    onChange={(e) => e.target.value && patch({ due_date: e.target.value }, 'Échéance enregistrée')} />
                  {r.due_date && <Button size="small" onClick={() => patch({ due_date: null }, 'Échéance retirée')} sx={{ alignSelf: 'flex-start', mt: 0.5 }}>Retirer</Button>}
                </Stack>
                <TextField select size="small" label="Priorité" value={r.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  <MenuItem value="basse">Basse</MenuItem><MenuItem value="normale">Normale</MenuItem><MenuItem value="haute">Haute</MenuItem>
                </TextField>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Ordre du jour</Typography>
              {r.agenda.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Jamais inscrite à une réunion.</Typography>}
              {r.agenda.map((a) => (
                <Box key={a.meeting_id} sx={{ mb: 1.5 }}>
                  <Link component={RouterLink} to={`/elus/reunions/${a.meeting_id}`} sx={{ fontWeight: 700 }}>{a.meeting_title}</Link>
                  <Typography variant="body2" color="text.secondary">{fmtShort(a.meeting_date)}{a.discussed ? ', traitée' : ''}</Typography>
                  {a.outcome && <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{a.outcome}</Typography>}
                </Box>
              ))}
              {r.parent_id && (
                <Typography variant="body2" color="text.secondary">Passe à l’ordre du jour avec son sujet.</Typography>
              )}
              {!closed && !r.parent_id && (
                meetings.filter((m) => !plannedIds.has(m.id)).length > 0 ? (
                  <Stack direction="row" spacing={1}>
                    <TextField select size="small" label="Réunion" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                      {meetings.filter((m) => !plannedIds.has(m.id)).map((m) => <MenuItem key={m.id} value={m.id}>{m.title}, {fmtShort(m.meeting_date)}</MenuItem>)}
                    </TextField>
                    <Button variant="contained" onClick={addToAgenda} disabled={!meetingId}>Inscrire</Button>
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Aucune réunion planifiée disponible. <Link component={RouterLink} to="/elus/reunions">Planifier une réunion</Link>
                  </Typography>
                )
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h4" component="h2" sx={{ mb: 1.5 }}>Demandeur</Typography>
              {r.origin === 'elu' ? (
                <>
                  <Typography>{r.created_by?.full_name || r.requester_name}</Typography>
                  <Typography variant="body2" color="text.secondary">Question saisie par un élu du CSE</Typography>
                </>
              ) : r.anonymous ? <Typography>Anonyme</Typography> : (
                <>
                  <Typography>{r.requester_name || 'Nom non renseigné'}</Typography>
                  {r.requester_service && <Typography variant="body2" color="text.secondary">{r.requester_service}</Typography>}
                  {r.requester_email && <Link href={`mailto:${r.requester_email}`} variant="body2">{r.requester_email}</Link>}
                </>
              )}
              {r.notify && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Prévenu par e-mail de vos réponses, messages et de la clôture.
                </Typography>
              )}
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Visible par</Typography>
              <Typography variant="body2" color="text.secondary">
                {r.visible_to_all ? 'Tous les élus' : r.viewers.map((v) => v.full_name).join(', ')}
              </Typography>
              {!r.visible_to_all && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Choix du demandeur : ne partagez pas cette demande avec d’autres élus.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </>
  )
}
