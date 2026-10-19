import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Grid, IconButton, Link, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/EditNoteOutlined'
import PrintIcon from '@mui/icons-material/PrintOutlined'
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined'
import LockIcon from '@mui/icons-material/LockOutlined'
import AddIcon from '@mui/icons-material/Add'
import AutoAwesomeIcon from '@mui/icons-material/PlaylistAddOutlined'  // génération par modèles, sans IA
import RepeatIcon from '@mui/icons-material/Repeat'
import { api, download, fmtDate, MEETING_KINDS } from '../../api'
import { ErrorAlert, KindChip, Section, StatusChip } from '../../components'
import { mono } from '../../theme'
import { RecurrenceFields, SINGLE, fromItem, recurrenceLabel, toRule } from './Recurrence'
import { RequestRow } from './shared'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function printAgenda(m) {
  const w = window.open('', '_blank')
  if (!w) return
  const rows = m.items.map((it) => `<li><strong>${esc(it.title)}</strong>${it.category ? `<br><small>${esc(it.category)}${it.tracking_code ? `, ${esc(it.tracking_code)}` : ''}</small>` : ''}${it.wording ? `<p>${esc(it.wording)}</p>` : ''}${it.outcome ? `<p class="outcome"><em>Relevé de décision :</em> ${esc(it.outcome)}</p>` : ''}</li>`).join('')
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ordre du jour</title>
    <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#16213A}
    h1{font-size:24px;margin-bottom:4px}ol{padding-left:22px}li{margin:14px 0}small{color:#5B6B82}p{margin:6px 0 0;white-space:pre-wrap}.outcome{border-left:3px solid #9A6A00;padding-left:10px}</style></head>
    <body><h1>${esc(m.title)}</h1><div>Ordre du jour, réunion du ${esc(fmtDate(m.meeting_date))}</div><ol>${rows}</ol></body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

export default function MeetingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [m, setM] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [error, setError] = useState(null)
  const [free, setFree] = useState('')
  const [freeRec, setFreeRec] = useState(SINGLE)
  const [removing, setRemoving] = useState(null)
  const [edit, setEdit] = useState(null)
  const [toast, setToast] = useState(null)
  const [generating, setGenerating] = useState(false)

  const loadProposal = useCallback(() => api(`/meetings/${id}/proposal`).then(setProposal).catch(() => {}), [id])
  useEffect(() => {
    api(`/meetings/${id}`).then(setM).catch((e) => setError(e.message))
    loadProposal()
  }, [id, loadProposal])

  const call = async (path, opts, msg) => {
    try { setM(await api(`/meetings/${id}${path}`, opts)); if (msg) setToast(msg); loadProposal() } catch (e) { setError(e.message) }
  }
  const add = (request_id) => call('/items', { method: 'POST', body: { request_id } }, 'Ajoutée à l’ordre du jour')
  const generate = async () => {
    setGenerating(true)
    try {
      const before = m.items.length
      const next = await api(`/meetings/${id}/generate`, { method: 'POST', body: { include_fixed: true } })
      setM(next); loadProposal()
      const added = next.items.length - before
      setToast(added > 0 ? `Ordre du jour généré : ${added} point(s) ajouté(s)` : 'Ordre du jour déjà complet')
    } catch (e) { setError(e.message) } finally { setGenerating(false) }
  }
  const move = (idx, dir) => {
    const ids = m.items.map((i) => i.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    call('/order', { method: 'PUT', body: { item_ids: ids } })
  }
  const saveEdit = async (sendAsAnswer) => {
    // La règle n'est envoyée que si elle change : la renvoyer remettrait les occurrences retirées à la main
    const rule = toRule(edit.rec)
    const ruleChanged = JSON.stringify(rule) !== JSON.stringify(toRule(fromItem(edit)))
    const recurrence = edit.request_id ? {} : { recurring: edit.rec.recurring, recurrence: rule && ruleChanged ? rule : undefined }
    if (edit.request_id && edit.commit_due) {
      const text = (edit.commit_text || edit.outcome || edit.wording || edit.title).trim()
      try {
        await api(`/requests/${edit.request_id}/commitments`, { method: 'POST', body: { text, due_date: edit.commit_due, meeting_id: Number(id), public: edit.commit_public !== false } })
      } catch (e) { setError(e.message); return }
    }
    await call(`/items/${edit.id}`, { method: 'PATCH', body: { title: edit.request_id ? undefined : edit.title, wording: edit.wording || '', outcome: edit.outcome || '', discussed: edit.discussed, send_as_answer: sendAsAnswer, ...recurrence } },
      sendAsAnswer ? 'Réponse envoyée au salarié' : edit.commit_due ? 'Point et engagement enregistrés' : 'Point enregistré')
    setEdit(null)
  }
  const removeItem = (it, stopRecurring) => {
    setRemoving(null)
    call(`/items/${it.id}${stopRecurring ? '?stop_recurring=true' : ''}`, { method: 'DELETE' },
      stopRecurring ? 'Point retiré, il ne sera plus repris' : 'Point retiré')
  }
  const remove = async () => {
    if (!window.confirm('Supprimer cette réunion ? Les demandes non traitées repasseront « En cours d’étude ».')) return
    try { await api(`/meetings/${id}`, { method: 'DELETE' }); navigate('/elus/reunions') } catch (e) { setError(e.message) }
  }

  if (!m) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>
  const editable = m.status === 'planifiee'

  return (
    <>
      <Button component={RouterLink} to="/elus/reunions" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1, ml: -1 }}>Réunions</Button>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h2" component="h1">{m.title}</Typography>
          <Typography color="text.secondary">{MEETING_KINDS[m.kind]}, {fmtDate(m.meeting_date)}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {editable && m.kind === 'ordinaire' && (
            <Button variant="contained" startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
              disabled={generating} onClick={generate}>
              Générer l’ordre du jour
            </Button>
          )}
          <TextField select size="small" label="Type" value={m.kind} fullWidth={false} sx={{ minWidth: 190 }}
            onChange={(e) => call('', { method: 'PATCH', body: { kind: e.target.value } })}>
            {Object.entries(MEETING_KINDS).map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="État" value={m.status} fullWidth={false} sx={{ minWidth: 140 }}
            onChange={(e) => call('', { method: 'PATCH', body: { status: e.target.value } })}>
            <MenuItem value="planifiee">Planifiée</MenuItem><MenuItem value="tenue">Tenue</MenuItem><MenuItem value="annulee">Annulée</MenuItem>
          </TextField>
          <Tooltip title="Convocation et ordre du jour au format Word du CSE">
            <Button variant="outlined" startIcon={<DescriptionIcon />}
              onClick={() => download(`/meetings/${id}/odj.docx`, 'Ordre du jour.docx').catch((e) => setError(e.message))}>
              ODJ Word
            </Button>
          </Tooltip>
          <Tooltip title="Trame du procès-verbal (points de l’ODJ et relevés de décision) au format Word du CSE">
            <Button variant="outlined" startIcon={<DescriptionIcon />}
              onClick={() => download(`/meetings/${id}/pv.docx`, 'PV.docx').catch((e) => setError(e.message))}>
              PV Word
            </Button>
          </Tooltip>
          <Tooltip title="Imprimer l’ordre du jour"><IconButton onClick={() => printAgenda(m)} aria-label="Imprimer l’ordre du jour"><PrintIcon /></IconButton></Tooltip>
          <Tooltip title="Supprimer la réunion"><IconButton onClick={remove} aria-label="Supprimer la réunion"><DeleteIcon /></IconButton></Tooltip>
        </Stack>
      </Stack>
      <ErrorAlert error={error} onClose={() => setError(null)} />

      <Grid container spacing={4}>
        <Grid item xs={12} md={7}>
          <Section title="Ordre du jour">
            {m.items.length === 0 && <Typography color="text.secondary" sx={{ mb: 2 }}>{m.kind === 'ordinaire' ? 'Ordre du jour vide. Cliquez sur « Générer l’ordre du jour », ou ajoutez les points proposés un par un.' : 'Ordre du jour vide. Ajoutez les points proposés un par un, ou un point libre.'}</Typography>}
            <Stack component="ol" spacing={1} sx={{ p: 0, m: 0, listStyle: 'none' }}>
              {m.items.map((it, idx) => (
                <Card component="li" key={it.id}>
                  <Stack direction="row" alignItems="flex-start" spacing={1.5} sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '1.25rem', minWidth: 24, color: 'text.secondary' }}>{idx + 1}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {it.restricted ? (
                        <Typography color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><LockIcon fontSize="small" />{it.title}</Typography>
                      ) : (
                        <>
                          <Stack direction="row" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                            {it.status && <StatusChip status={it.status} />}
                            {it.kind && <KindChip kind={it.kind} temporality={it.temporality} />}
                            {it.recurring && <Tooltip title={`Repris sur les réunions suivantes du même type : ${recurrenceLabel(it.recurrence).toLowerCase()}`}><Chip size="small" color="primary" variant="outlined" icon={<RepeatIcon />} label={`Récurrent : ${recurrenceLabel(it.recurrence).toLowerCase()}`} sx={{ maxWidth: '100%' }} /></Tooltip>}
                            {it.discussed && <Chip size="small" color="success" variant="outlined" label="Traité" />}
                          </Stack>
                          {it.request_id
                            ? <Link component={RouterLink} to={`/elus/demandes/${it.request_id}`} sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{it.title}</Link>
                            : <Typography sx={{ fontWeight: 700 }}>{it.title}</Typography>}
                          {it.tracking_code && (
                            <Typography variant="body2" color="text.secondary">
                              <Box component="span" sx={{ fontFamily: mono }}>{it.number ? `Sujet ${it.number}` : it.tracking_code}</Box>, {it.category}
                              {it.linked_count > 0 && `, soulevé par ${it.linked_count + 1} salariés`}
                            </Typography>
                          )}
                          {it.wording && <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{it.wording}</Typography>}
                          {it.outcome && <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', borderLeft: 3, borderColor: 'secondary.main', pl: 1.5 }}>{it.outcome}</Typography>}
                        </>
                      )}
                    </Box>
                    <Stack direction={{ xs: 'column', sm: 'row' }}>
                      {!it.restricted && <Tooltip title="Formulation et relevé de décision"><IconButton size="small" aria-label="Modifier le point" onClick={() => setEdit({ ...it, wording: it.wording || '', outcome: it.outcome || '', rec: fromItem(it) })}><EditIcon /></IconButton></Tooltip>}
                      {editable && <>
                        <IconButton size="small" aria-label="Monter" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                        <IconButton size="small" aria-label="Descendre" disabled={idx === m.items.length - 1} onClick={() => move(idx, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                        {!it.restricted && <IconButton size="small" aria-label="Retirer de l’ordre du jour" onClick={() => (it.recurring ? setRemoving(it) : removeItem(it, false))}><DeleteIcon fontSize="small" /></IconButton>}
                      </>}
                    </Stack>
                  </Stack>
                </Card>
              ))}
            </Stack>
            {editable && (
              <Box component="form" sx={{ mt: 2 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  free.trim() && call('/items', { method: 'POST', body: { title: free, recurrence: toRule(freeRec) } },
                    freeRec.recurring ? 'Point ajouté, repris sur les réunions suivantes' : 'Point ajouté')
                    .then(() => { setFree(''); setFreeRec(SINGLE) })
                }}>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" label="Point libre (ex. Questions diverses)" value={free} onChange={(e) => setFree(e.target.value)} />
                  <Button type="submit" variant="outlined" disabled={!free.trim()} startIcon={<AddIcon />}>Ajouter</Button>
                </Stack>
                <Box sx={{ mt: 1.5 }}>
                  <RecurrenceFields value={freeRec} onChange={setFreeRec} kindLabel={MEETING_KINDS[m.kind].toLowerCase()} />
                </Box>
              </Box>
            )}
          </Section>
        </Grid>

        <Grid item xs={12} md={5}>
          {editable && (
            <Section title="Proposition">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Demandes ouvertes pas encore inscrites, classées par priorité, ancienneté et urgence des signalements, avec la formulation proposée pour l’ordre du jour.
              </Typography>
              {proposal?.items.length === 0 && <Typography color="text.secondary">Rien à proposer : toutes les demandes ouvertes sont inscrites ou traitées.</Typography>}
              <Stack spacing={1}>
                {proposal?.items.map((p) => (
                  <RequestRow key={p.request.id} r={p.request}
                    extra={<>
                      {p.reasons.length > 0 && <Typography variant="body2" sx={{ mt: 0.75 }}>{p.reasons.join(', ')}</Typography>}
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, fontStyle: 'italic' }}>{p.wording}</Typography>
                    </>}
                    action={<Tooltip title="Ajouter à l’ordre du jour"><IconButton color="primary" aria-label="Ajouter à l’ordre du jour" onClick={() => add(p.request.id)}><AddIcon /></IconButton></Tooltip>} />
                ))}
              </Stack>
              {proposal?.hidden_pending > 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  {proposal.hidden_pending} demande(s) en attente ne vous sont pas visibles (choix du demandeur). Les élus autorisés peuvent les inscrire.
                </Alert>
              )}
            </Section>
          )}
        </Grid>
      </Grid>

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="sm">
        <DialogTitle>Point de l’ordre du jour</DialogTitle>
        <DialogContent>
          {edit?.request_id
            ? <Typography sx={{ fontWeight: 700, mb: 2 }}>{edit?.title}</Typography>
            : <TextField label="Intitulé" value={edit?.title || ''} disabled={!editable} sx={{ mt: 1, mb: 2 }}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}
          <TextField multiline minRows={3} label="Formulation à l’ordre du jour" value={edit?.wording || ''} disabled={!editable}
            onChange={(e) => setEdit({ ...edit, wording: e.target.value })} />
          {editable && edit?.suggested_wording ? (
            <Button size="small" startIcon={<AutoAwesomeIcon />} sx={{ mt: 0.5, mb: 1.5 }}
              onClick={() => setEdit({ ...edit, wording: edit.suggested_wording })}>
              Reprendre la phrase type
            </Button>
          ) : <Box sx={{ mb: 2 }} />}
          <TextField multiline minRows={4} label="Relevé de décision : ce qui a été décidé ou répondu (repris dans le PV)" value={edit?.outcome || ''}
            onChange={(e) => setEdit({ ...edit, outcome: e.target.value })} />
          <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={!!edit?.discussed} onChange={(e) => setEdit({ ...edit, discussed: e.target.checked })} />} label="Point traité en réunion" />
          {edit?.request_id && (
            <Box sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Engagement de la direction</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Si la direction a annoncé un délai, indiquez-le : l’engagement est enregistré sur le sujet et suivi dans le Gantt.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
                <TextField type="date" size="small" label="Délai annoncé" InputLabelProps={{ shrink: true }} fullWidth={false}
                  value={edit.commit_due || ''} onChange={(e) => setEdit({ ...edit, commit_due: e.target.value })} sx={{ width: 180 }} />
                <FormControlLabel control={<Checkbox checked={edit.commit_public !== false} onChange={(e) => setEdit({ ...edit, commit_public: e.target.checked })} />}
                  label="Visible par le salarié" />
              </Stack>
              {edit.commit_due && (
                <TextField size="small" multiline sx={{ mt: 1.5 }} label="Engagement (par défaut : le relevé de décision)"
                  value={edit.commit_text ?? ''} placeholder={edit.outcome || ''} onChange={(e) => setEdit({ ...edit, commit_text: e.target.value })} />
              )}
            </Box>
          )}
          {edit && !edit.request_id && (editable || edit.recurring) && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>Répétition</Typography>
              <RecurrenceFields value={edit.rec} onChange={(rec) => setEdit({ ...edit, rec })}
                kindLabel={MEETING_KINDS[m.kind].toLowerCase()} disabled={!editable && !edit.recurring} />
              {edit.recurring && !edit.rec.recurring && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  En passant le point en « Unique », il est retiré des réunions suivantes et ne sera plus repris.
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setEdit(null)}>Annuler</Button>
          <Button variant="outlined" onClick={() => saveEdit(false)}>Enregistrer</Button>
          {edit?.request_id && (
            <Button variant="contained" disabled={!edit?.outcome?.trim()} onClick={() => saveEdit(true)}>Enregistrer et répondre au salarié</Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} fullWidth maxWidth="xs">
        <DialogTitle>Retirer un point récurrent</DialogTitle>
        <DialogContent>
          <Typography>« {removing?.title} » est repris sur toutes les réunions suivantes. Le retirer de cette réunion seulement, ou arrêter de le répéter ?</Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => setRemoving(null)}>Annuler</Button>
          <Button variant="outlined" onClick={() => removeItem(removing, false)}>Cette réunion seulement</Button>
          <Button variant="contained" color="error" onClick={() => removeItem(removing, true)}>Arrêter la répétition</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </>
  )
}
