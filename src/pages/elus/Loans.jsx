import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardActionArea, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, InputAdornment, Link, MenuItem, Radio, RadioGroup, Snackbar, Stack, Switch, TextField, Typography,
  useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { api, borrowUrl, euros, fmtDate, fmtShort, hasAmount, isIsoDate, plusDays, todayIso } from '../../api'
import { ErrorAlert, MoreMenu, Section, useNarrow } from '../../components'
import { mono, palette } from '../../theme'
import { FilterChips, LoanRequestChip, LoansHeader, tint } from './shared'

const hasDeposit = (l) => hasAmount(l.deposit)
const RETURN_STATES = { bon: 'Bon état', abime: 'Abîmé', incomplet: 'Incomplet' }
// « Pas disponible », « Disponible », « 1 sur 3 disponible », « 2 sur 3 disponibles » (sur ces dates)
const freeLabel = (free, total) => (free <= 0 ? 'Pas disponible sur ces dates.'
  : total > 1 ? `${free} sur ${total} disponible${free > 1 ? 's' : ''} sur ces dates.` : 'Disponible sur ces dates.')

export default function Loans({ view }) {
  return view === 'materiel' ? <EquipmentView /> : <LoansView />
}

// ---------- Prêts ----------

const VIEWS = { en_cours: 'En cours', rendus: 'Rendus', tous: 'Tous' }

function LoansView() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const vue = VIEWS[params.get('vue')] ? params.get('vue') : 'en_cours'
  const askId = Number(params.get('demande')) || null
  const loanId = Number(params.get('pret')) || null
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [asks, setAsks] = useState([])
  const [equipment, setEquipment] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [current, setCurrent] = useState(null)
  const [toast, setToast] = useState(null)

  // Seule la dernière liste demandée s'affiche (un rechargement plus lent ne remplace pas la vue choisie entre-temps)
  const seq = useRef(0)
  const load = useCallback(() => {
    const n = ++seq.current
    return api('/loans', { query: { vue, q } })
      .then((x) => { if (n === seq.current) setRows(x) })
      .catch((e) => { if (n === seq.current) setError(e.message) })
  }, [vue, q])
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  const loadEquipment = () => api('/equipment').then(setEquipment).catch(() => setEquipment([]))
  const loadAsks = () => api('/requests', { query: { loans_todo: true } }).then(setAsks).catch(() => setAsks([]))
  useEffect(() => { loadEquipment(); loadAsks() }, [])
  // Lien direct vers un prêt (depuis la fiche d'une demande)
  useEffect(() => {
    if (!loanId) return
    api('/loans', { query: { vue: 'tous' } }).then((all) => setCurrent(all.find((l) => l.id === loanId) || null)).catch(() => {})
  }, [loanId])

  const without = (key) => { const p = new URLSearchParams(params); p.delete(key); setParams(p, { replace: true }) }
  const saved = (msg) => { setToast(msg); load(); loadEquipment(); loadAsks() }
  const active = (equipment || []).filter((e) => e.active)
  const late = rows?.filter((l) => l.late) || []
  const toHand = rows?.filter((l) => l.to_hand) || []
  const out = rows?.filter((l) => l.status === 'sorti' && !l.late) || []
  const reserved = rows?.filter((l) => l.status === 'reserve' && !l.to_hand) || []
  const list = (items) => <Stack spacing={1}>{items.map((l) => <LoanRow key={l.id} l={l} onOpen={setCurrent} />)}</Stack>
  const needle = q.trim().toLowerCase()
  const shownAsks = asks.filter((r) => !needle || [r.requester_name, r.loan_request.equipment_name, r.subject]
    .some((x) => (x || '').toLowerCase().includes(needle)))
  // Demande en attente : le dialogue d'acceptation ; déjà répondue (le salarié a réécrit) : la fiche de la demande
  const openAsk = (r) => (r.loan_request.decision ? navigate(`/elus/demandes/${r.id}`) : setParams({ ...Object.fromEntries(params), demande: r.id }))

  return (
    <Box sx={{ maxWidth: 860 }}>
      <LoansHeader action={active.length > 0 && (
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)} aria-label="Nouveau prêt" sx={{ flexShrink: 0 }}>
          Nouveau<Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>&nbsp;prêt</Box>
        </Button>
      )} />
      {equipment && active.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Commencez par décrire le matériel que le CSE prête (tente, barbecue, appareil à raclette…) dans l’onglet « Matériel ».
        </Alert>
      )}
      <TextField size="small" fullWidth placeholder="Rechercher (salarié, matériel…)" value={q} onChange={(e) => setQ(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
        inputProps={{ 'aria-label': 'Rechercher un prêt' }} sx={{ mb: 1.5 }} />
      <Box sx={{ mb: 2.5 }}>
        <FilterChips value={vue} onChange={(v) => setParams(v === 'en_cours' ? {} : { vue: v }, { replace: true })}
          options={Object.entries(VIEWS).map(([value, label]) => ({ value, label }))} />
      </Box>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      {vue === 'en_cours' && shownAsks.length > 0 && (
        <Section title="Demandes des salariés">
          <Stack spacing={1}>{shownAsks.map((r) => <LoanAskRow key={r.id} r={r} onOpen={openAsk} />)}</Stack>
        </Section>
      )}
      {rows && rows.length === 0 && (
        <Box sx={{ py: 5, textAlign: 'center' }}>
          <Typography color="text.secondary">{q ? 'Aucun prêt ne correspond à cette recherche.' : vue === 'en_cours' ? 'Aucun prêt en cours.' : 'Aucun prêt.'}</Typography>
        </Box>
      )}
      {vue === 'en_cours' ? <>
        {late.length > 0 && <Section title="En retard">{list(late)}</Section>}
        {toHand.length > 0 && <Section title="À remettre au salarié">{list(toHand)}</Section>}
        {out.length > 0 && <Section title="Sortis">{list(out)}</Section>}
        {reserved.length > 0 && <Section title="Réservés">{list(reserved)}</Section>}
      </> : rows && list(rows)}

      <NewLoanDialog open={creating} equipment={active} onClose={() => setCreating(false)}
        onSaved={(l) => { setCreating(false); saved(l.status === 'sorti' ? 'Prêt enregistré' : 'Réservation enregistrée') }} />
      <LoanDialog loan={current} onClose={() => { setCurrent(null); if (loanId) without('pret') }}
        onSaved={(l, msg) => { setCurrent(l); saved(msg) }}
        onDeleted={() => { setCurrent(null); if (loanId) without('pret'); saved('Prêt supprimé') }} />
      <LoanAskDialog requestId={askId} open={!!askId} onClose={() => without('demande')}
        onDone={(_, msg) => { without('demande'); saved(msg) }} />
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Box>
  )
}

// Demande d'emprunt d'un salarié, dans la liste des prêts
function LoanAskRow({ r, onOpen }) {
  const lr = r.loan_request
  const short = lr.free != null && lr.free < lr.quantity
  return (
    <Card sx={{ borderColor: lr.decision ? undefined : palette.signal }}>
      <CardActionArea onClick={() => onOpen(r)} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
          {lr.decision ? <Chip size="small" label="Nouveau message du salarié" sx={tint(palette.alert)} /> : <LoanRequestChip lr={lr} />}
          {short && <Chip size="small" label={lr.free <= 0 ? 'Déjà réservé à ces dates' : `Plus que ${lr.free} disponible${lr.free > 1 ? 's' : ''}`} sx={tint(palette.alert)} />}
        </Stack>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {lr.equipment_name || 'Matériel supprimé'}{lr.quantity > 1 ? ` × ${lr.quantity}` : ''}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {[r.requester_name, `du ${fmtShort(lr.start_date)} au ${fmtShort(lr.due_date)}`, `demandé le ${fmtShort(r.created_at)}`].filter(Boolean).join(' · ')}
        </Typography>
      </CardActionArea>
    </Card>
  )
}

// Texte proposé pour répondre au salarié (modifiable)
function acceptText(r, f) {
  const lr = r.loan_request
  const q = Number(f.quantity) || 1
  return `Bonjour ${r.requester_name || ''},\n\nC’est d’accord pour ${lr.equipment_name}${q > 1 ? ` (× ${q})` : ''} du ${fmtDate(f.start_date)} `
    + `au ${fmtDate(f.due_date)} : le matériel vous est réservé.`
    + (hasAmount(f.deposit) ? ` Une caution de ${euros(f.deposit)} vous sera demandée au retrait.` : '')
}
function refuseText(r) {
  const lr = r.loan_request
  return `Bonjour ${r.requester_name || ''},\n\nDésolé, le CSE ne peut pas vous prêter ${lr.equipment_name || 'ce matériel'} `
    + `du ${fmtDate(lr.start_date)} au ${fmtDate(lr.due_date)}.`
    + (lr.free != null && lr.free < lr.quantity ? ' Il est déjà réservé à ces dates.' : '')
}

// Répondre à une demande d'emprunt : accepter (réservation du matériel) ou refuser, avec un mot au salarié
export function LoanAskDialog({ requestId, open, initialMode = 'view', onClose, onDone }) {
  const narrow = useNarrow()
  const [r, setR] = useState(null)
  const [mode, setMode] = useState('view')
  const [f, setF] = useState({})
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const lr = r?.loan_request
  const fill = (d, m) => {
    const x = d.loan_request
    const nf = { start_date: x.start_date, due_date: x.due_date, quantity: x.quantity, deposit: x.deposit != null ? String(Number(x.deposit)) : '' }
    setF({ ...nf, message: m === 'refuse' ? refuseText(d) : acceptText(d, nf) })
    setTouched(false)
  }
  useEffect(() => {
    if (!open || !requestId) return
    setR(null); setError(null); setBusy(false); setMode(initialMode)
    api(`/requests/${requestId}`).then((d) => { setR(d); if (d.loan_request) fill(d, initialMode) }).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestId, initialMode])
  const free = useAvailability(mode === 'accept' ? lr?.equipment_id : null, f.start_date, f.due_date)
  const go = (m) => { setMode(m); fill(r, m) }
  // Dates, quantité ou caution changées : le texte proposé suit, tant qu'il n'a pas été retouché
  const setField = (k) => (ev) => {
    const nf = { ...f, [k]: ev.target.value }
    if (k === 'start_date' && nf.due_date < nf.start_date) nf.due_date = nf.start_date
    if (!touched && mode === 'accept' && isIsoDate(nf.start_date) && isIsoDate(nf.due_date)) nf.message = acceptText(r, nf)
    setF(nf)
  }
  const send = async (accept) => {
    setError(null); setBusy(true)
    try {
      const body = accept
        ? { accept: true, start_date: f.start_date, due_date: f.due_date, quantity: Number(f.quantity) || 1,
          deposit: f.deposit === '' ? null : Number(f.deposit), message: f.message }
        : { accept: false, message: f.message }
      const d = await api(`/requests/${requestId}/loan`, { method: 'POST', body })
      onDone(d, accept ? 'Emprunt accepté : matériel réservé' : 'Refus envoyé au salarié')
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const q = Number(f.quantity) || 1
  const enough = free == null || free >= q
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={narrow}>
      <DialogTitle sx={{ pr: 2 }}>Demande d’emprunt</DialogTitle>
      <DialogContent>
        {!r && !error && <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}
        {r && !lr && <Alert severity="info">Ce n’est pas une demande d’emprunt.</Alert>}
        {lr && <>
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.75 }}><LoanRequestChip lr={lr} /></Stack>
          <Typography variant="h4" component="p" sx={{ overflowWrap: 'anywhere' }}>
            {lr.equipment_name || 'Matériel supprimé'}{lr.quantity > 1 ? ` × ${lr.quantity}` : ''}
          </Typography>
          <Typography>Du {fmtDate(lr.start_date)} au {fmtDate(lr.due_date)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {[r.requester_name, r.requester_service].filter(Boolean).join(', ')}
            {r.requester_email && <> · <Link href={`mailto:${r.requester_email}`}>{r.requester_email}</Link></>}
            {' · '}<Box component="span" sx={{ fontFamily: mono }}>{r.tracking_code}</Box>
          </Typography>
          {mode === 'view' && <>
            <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'background.default', border: 1, borderColor: 'divider' }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.description}</Typography>
            </Box>
            {!lr.decision && lr.free != null && (
              <Alert severity={lr.free >= lr.quantity ? 'success' : 'warning'} sx={{ mt: 1.5 }}>
                {lr.free >= lr.quantity ? 'Disponible à ces dates.' : `${freeLabel(lr.free, lr.equipment_quantity)} Proposez d’autres dates en acceptant, ou refusez.`}
              </Alert>
            )}
            {!lr.decision && !lr.equipment_active && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>Ce matériel n’est plus prêté : la demande ne peut qu’être refusée.</Alert>
            )}
            {lr.decision && <Alert severity="info" sx={{ mt: 1.5 }}>Réponse déjà donnée au salarié : voir la demande pour les échanges.</Alert>}
          </>}

          <Collapse in={mode === 'accept'} unmountOnExit>
            <Stack spacing={2} sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1.5}>
                <TextField type="date" label="Du" InputLabelProps={{ shrink: true }} value={f.start_date || ''} onChange={setField('start_date')} />
                <TextField type="date" label="Retour le" InputLabelProps={{ shrink: true }} value={f.due_date || ''}
                  inputProps={{ min: f.start_date }} onChange={setField('due_date')} />
              </Stack>
              {free != null && (
                <Alert severity={enough ? 'success' : 'error'} sx={{ py: 0 }}>{freeLabel(free, lr.equipment_quantity)}</Alert>
              )}
              <Stack direction="row" spacing={1.5}>
                {lr.equipment_quantity > 1 && (
                  <TextField type="number" label="Quantité" value={f.quantity} onChange={setField('quantity')} sx={{ maxWidth: 140 }}
                    inputProps={{ min: 1, max: lr.equipment_quantity, inputMode: 'numeric' }} />
                )}
                <TextField type="number" label="Caution (€)" value={f.deposit} onChange={setField('deposit')} sx={{ maxWidth: 180 }}
                  inputProps={{ min: 0, step: '0.01', inputMode: 'decimal' }} helperText="Vide : pas de caution" />
              </Stack>
              <TextField label="Réponse au salarié" multiline minRows={4} value={f.message}
                onChange={(ev) => { setTouched(true); setF({ ...f, message: ev.target.value }) }}
                helperText="Il la lit avec son numéro de suivi (et par e-mail s’il l’a demandé)." />
            </Stack>
          </Collapse>
          <Collapse in={mode === 'refuse'} unmountOnExit>
            <TextField label="Réponse au salarié" multiline minRows={4} value={f.message} sx={{ mt: 2 }}
              onChange={(ev) => setF({ ...f, message: ev.target.value })}
              helperText="Expliquez pourquoi, ou proposez d’autres dates." />
          </Collapse>
        </>}
        <ErrorAlert error={error} onClose={() => setError(null)} />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
        {r && (mode === 'view'
          ? <>
            <Button component={RouterLink} to={`/elus/demandes/${r.id}`} sx={{ mr: 'auto' }}>Ouvrir la demande</Button>
            <Button onClick={onClose}>Fermer</Button>
            {lr && !lr.decision && <Button variant="outlined" color="error" onClick={() => go('refuse')}>Refuser</Button>}
            {lr && !lr.decision && lr.equipment_active && <Button variant="contained" onClick={() => go('accept')}>Accepter</Button>}
          </>
          : <>
            <Button onClick={() => (initialMode === 'view' ? setMode('view') : onClose())}>Annuler</Button>
            {mode === 'accept'
              ? <Button variant="contained" disabled={busy || !enough || !f.message?.trim()} onClick={() => send(true)}>Accepter et réserver</Button>
              : <Button variant="contained" color="error" disabled={busy || !f.message?.trim()} onClick={() => send(false)}>Envoyer le refus</Button>}
          </>)}
      </DialogActions>
    </Dialog>
  )
}

function LoanStatusChip({ l }) {
  const theme = useTheme()
  if (l.late) return <Chip size="small" label="En retard" sx={tint(palette.alert)} />
  if (l.to_hand) return <Chip size="small" label="À remettre" sx={{ bgcolor: `${palette.signal}33`, color: 'text.primary', border: `1px solid ${palette.signal}` }} />
  if (l.status === 'reserve') return <Chip size="small" label="Réservé" variant="outlined" />
  if (l.status === 'sorti') return <Chip size="small" label="Sorti" sx={tint(theme.palette.mode === 'dark' ? '#8FB0EA' : '#2F5FA8')} />
  if (l.status === 'rendu') return <Chip size="small" label="Rendu" sx={tint(palette.ok)} />
  return <Chip size="small" label="Annulé" variant="outlined" sx={{ opacity: 0.7 }} />
}

function DepositChip({ l }) {
  if (!hasDeposit(l)) return null
  const state = l.deposit_returned ? 'rendue' : l.deposit_received ? 'reçue' : 'à recevoir'
  const color = l.deposit_received && !l.deposit_returned ? palette.ok : null
  return <Chip size="small" variant={color ? 'filled' : 'outlined'} label={`Caution ${euros(l.deposit)} ${state}`} sx={color ? tint(color) : undefined} />
}

const period = (l) => (l.status === 'rendu' && l.returned_on
  ? `du ${fmtShort(l.start_date)} au ${fmtShort(l.due_date)}, rendu le ${fmtShort(l.returned_on)}`
  : `du ${fmtShort(l.start_date)} au ${fmtShort(l.due_date)}`)

function LoanRow({ l, onOpen }) {
  return (
    <Card>
      <CardActionArea onClick={() => onOpen(l)} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
          <LoanStatusChip l={l} />
          {l.return_state && l.return_state !== 'bon' && <Chip size="small" label={RETURN_STATES[l.return_state]} sx={tint(palette.alert)} />}
          <DepositChip l={l} />
        </Stack>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{l.equipment.name}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</Typography>
        <Typography variant="body2" color="text.secondary">
          {[l.borrower_name, l.borrower_service].filter(Boolean).join(', ')} · {period(l)}
        </Typography>
      </CardActionArea>
    </Card>
  )
}

// Quantité disponible pour un matériel sur des dates (sans compter le prêt en cours de modification)
function useAvailability(equipmentId, from, to, except) {
  const [n, setN] = useState(null)
  useEffect(() => {
    setN(null)
    if (!equipmentId || !/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || to < from) return undefined
    const t = setTimeout(() => {
      api(`/equipment/${equipmentId}/availability`, { query: { from, to, except: except || '' } }).then(setN).catch(() => setN(null))
    }, 200)
    return () => clearTimeout(t)
  }, [equipmentId, from, to, except])
  return n
}

function NewLoanDialog({ open, equipment, onClose, onSaved }) {
  const narrow = useNarrow()
  const depositOf = (x) => (x?.deposit != null ? String(Number(x.deposit)) : '')
  const fresh = () => ({
    equipment_id: equipment.length === 1 ? equipment[0].id : '', quantity: 1, borrower_name: '', borrower_service: '',
    borrower_contact: '', start_date: todayIso(), due_date: plusDays(todayIso(), 3), out_now: true,
    deposit: equipment.length === 1 ? depositOf(equipment[0]) : '', deposit_received: false, notes: '',
  })
  const [f, setF] = useState(fresh)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setF(fresh()); setError(null); setBusy(false) } }, [open])
  const e = equipment.find((x) => x.id === f.equipment_id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (e) setF((x) => ({ ...x, deposit: depositOf(e), quantity: 1 })) }, [f.equipment_id])
  const free = useAvailability(f.equipment_id, f.start_date, f.due_date)
  const startsLater = f.start_date > todayIso()
  const outNow = f.out_now && !startsLater
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value })

  const submit = async (ev) => {
    ev.preventDefault()
    setError(null)
    if (!f.equipment_id) return setError('Choisissez le matériel prêté.')
    if (f.borrower_name.trim().length < 2) return setError('Indiquez le nom du salarié qui emprunte.')
    setBusy(true)
    try {
      const l = await api('/loans', {
        method: 'POST',
        body: { ...f, out_now: outNow, deposit: f.deposit === '' ? null : Number(f.deposit), deposit_received: outNow && f.deposit_received },
      })
      onSaved(l)
    } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={narrow} component="form" onSubmit={submit}>
      <DialogTitle>Nouveau prêt</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select label="Matériel" value={f.equipment_id} onChange={(ev) => setF({ ...f, equipment_id: ev.target.value })} required>
              {equipment.map((x) => <MenuItem key={x.id} value={x.id}>{x.name}{x.quantity > 1 ? ` (${x.quantity})` : ''}</MenuItem>)}
            </TextField>
            {e && e.quantity > 1 && (
              <TextField type="number" label="Quantité" value={f.quantity} onChange={set('quantity')} sx={{ width: { sm: 120 }, flexShrink: 0 }}
                inputProps={{ min: 1, max: e.quantity, inputMode: 'numeric' }} />
            )}
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField type="date" label="Du" InputLabelProps={{ shrink: true }} value={f.start_date}
              onChange={(ev) => setF({ ...f, start_date: ev.target.value, due_date: f.due_date < ev.target.value ? ev.target.value : f.due_date })} />
            <TextField type="date" label="Retour prévu le" InputLabelProps={{ shrink: true }} value={f.due_date}
              inputProps={{ min: f.start_date }} onChange={set('due_date')} />
          </Stack>
          {e && free != null && (
            <Alert severity={free >= Number(f.quantity || 1) ? 'success' : 'warning'} sx={{ py: 0 }}>
              {freeLabel(free, e.quantity)}
            </Alert>
          )}
          <TextField label="Salarié qui emprunte" value={f.borrower_name} onChange={set('borrower_name')} required autoComplete="off" />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField label="Service (facultatif)" value={f.borrower_service} onChange={set('borrower_service')} />
            <TextField label="Téléphone ou e-mail (facultatif)" value={f.borrower_contact} onChange={set('borrower_contact')} />
          </Stack>
          {startsLater
            ? <Typography variant="body2" color="text.secondary">Le prêt commence plus tard : il est enregistré comme réservation, à remettre le {fmtShort(f.start_date)}.</Typography>
            : <FormControlLabel control={<Checkbox checked={f.out_now} onChange={set('out_now')} />} label="Matériel remis au salarié maintenant" />}
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField type="number" label="Caution (€)" value={f.deposit} onChange={set('deposit')} sx={{ width: 160, flexShrink: 0 }}
              inputProps={{ min: 0, step: '0.01', inputMode: 'decimal' }} helperText="Vide : pas de caution" />
            {outNow && Number(f.deposit) > 0 && (
              <FormControlLabel control={<Checkbox checked={f.deposit_received} onChange={set('deposit_received')} />} label="Caution reçue" />
            )}
          </Stack>
          <TextField label="Notes (facultatif)" value={f.notes} onChange={set('notes')} multiline minRows={2} />
        </Stack>
        <ErrorAlert error={error} onClose={() => setError(null)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button type="submit" variant="contained" disabled={busy}>{outNow ? 'Enregistrer le prêt' : 'Réserver'}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Fiche d'un prêt : remise au salarié, retour, caution, modification
function LoanDialog({ loan, onClose, onSaved, onDeleted }) {
  const [l, setL] = useState(loan)
  const [mode, setMode] = useState('view')
  const [f, setF] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const narrow = useNarrow()
  useEffect(() => { setL(loan); setMode('view'); setError(null); setBusy(false) }, [loan])
  const free = useAvailability(mode === 'edit' ? l?.equipment.id : null, f.start_date, f.due_date, l?.id)
  if (!l) return null

  const patch = async (body, msg) => {
    setError(null); setBusy(true)
    try {
      const x = await api(`/loans/${l.id}`, { method: 'PATCH', body })
      setL(x); setMode('view'); onSaved(x, msg)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm('Supprimer ce prêt ? Il disparaît aussi de l’historique.')) return
    try { await api(`/loans/${l.id}`, { method: 'DELETE' }); onDeleted() } catch (err) { setError(err.message) }
  }
  const startEdit = () => {
    setF({
      start_date: l.start_date, due_date: l.due_date, quantity: l.quantity, borrower_name: l.borrower_name,
      borrower_service: l.borrower_service || '', borrower_contact: l.borrower_contact || '',
      deposit: l.deposit != null ? String(Number(l.deposit)) : '', notes: l.notes || '',
    })
    setMode('edit')
  }
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value })
  const contact = l.borrower_contact
  const contactLink = contact && (/@/.test(contact) ? `mailto:${contact}` : /^[\d\s+().-]{6,}$/.test(contact) ? `tel:${contact.replace(/[^\d+]/g, '')}` : null)

  return (
    <Dialog open={!!loan} onClose={onClose} fullWidth maxWidth="sm" fullScreen={narrow}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{l.equipment.name}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</Box>
        <MoreMenu items={[
          (l.status === 'rendu' || l.status === 'annule') && { label: 'Remettre en prêt', onClick: () => patch({ status: 'sorti' }, 'Prêt rouvert') },
          { label: 'Supprimer le prêt', danger: true, onClick: remove },
        ]} />
      </DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 0.75 }}>
          <LoanStatusChip l={l} />
          {l.return_state && <Chip size="small" label={RETURN_STATES[l.return_state]} sx={l.return_state === 'bon' ? tint(palette.ok) : tint(palette.alert)} />}
          <DepositChip l={l} />
        </Stack>

        {mode !== 'edit' && <>
          <Typography sx={{ fontWeight: 700 }}>{l.borrower_name}</Typography>
          {(l.borrower_service || contact) && (
            <Typography variant="body2" color="text.secondary">
              {l.borrower_service}{l.borrower_service && contact ? ' · ' : ''}
              {contact && (contactLink ? <Link href={contactLink}>{contact}</Link> : contact)}
            </Typography>
          )}
          <Typography sx={{ mt: 1 }}>{period(l)}</Typography>
          {l.notes && <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{l.notes}</Typography>}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {l.request_id ? 'Demandé par le salarié, accepté' : 'Enregistré'}{l.created_by ? ` par ${l.created_by.full_name}` : ''} le {fmtShort(l.created_at)}
          </Typography>
          {l.request_id && (
            <Link component={RouterLink} to={`/elus/demandes/${l.request_id}`} variant="body2">Voir la demande et les échanges avec le salarié</Link>
          )}
        </>}

        <Collapse in={mode === 'hand'} unmountOnExit>
          <Box sx={{ mt: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Remettre le matériel au salarié</Typography>
            {hasDeposit(l) && (
              <FormControlLabel control={<Checkbox checked={!!f.deposit_received} onChange={set('deposit_received')} />}
                label={`Caution de ${euros(l.deposit)} reçue`} />
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button variant="contained" disabled={busy}
                onClick={() => patch({ status: 'sorti', ...(hasDeposit(l) && { deposit_received: !!f.deposit_received }) }, 'Matériel remis')}>
                Confirmer la remise
              </Button>
              <Button onClick={() => setMode('view')}>Annuler</Button>
            </Stack>
          </Box>
        </Collapse>

        <Collapse in={mode === 'return'} unmountOnExit>
          <Box sx={{ mt: 2, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Retour du matériel</Typography>
            <Stack spacing={1.5}>
              <TextField type="date" label="Rendu le" InputLabelProps={{ shrink: true }} value={f.returned_on || ''}
                inputProps={{ max: todayIso() }} onChange={set('returned_on')} sx={{ maxWidth: 220 }} />
              <RadioGroup row value={f.return_state || 'bon'} onChange={(ev) => setF({ ...f, return_state: ev.target.value })}>
                {Object.entries(RETURN_STATES).map(([k, label]) => <FormControlLabel key={k} value={k} control={<Radio />} label={label} />)}
              </RadioGroup>
              {hasDeposit(l) && l.deposit_received && (
                <FormControlLabel control={<Checkbox checked={!!f.deposit_returned} onChange={set('deposit_returned')} />}
                  label={`Caution de ${euros(l.deposit)} rendue`} />
              )}
              <TextField label="Remarque (facultatif)" value={f.notes} onChange={set('notes')} multiline minRows={2}
                placeholder="Ex. : une sardine manquante" />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" disabled={busy}
                onClick={() => patch({ status: 'rendu', returned_on: f.returned_on || null, return_state: f.return_state || 'bon',
                  deposit_returned: !!f.deposit_returned, notes: f.notes }, 'Retour enregistré')}>
                Enregistrer le retour
              </Button>
              <Button onClick={() => setMode('view')}>Annuler</Button>
            </Stack>
          </Box>
        </Collapse>

        <Collapse in={mode === 'edit'} unmountOnExit>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={1.5}>
              <TextField type="date" label="Du" InputLabelProps={{ shrink: true }} value={f.start_date || ''} onChange={set('start_date')} />
              <TextField type="date" label="Retour prévu le" InputLabelProps={{ shrink: true }} value={f.due_date || ''}
                inputProps={{ min: f.start_date }} onChange={set('due_date')} />
            </Stack>
            {free != null && (l.status === 'reserve' || l.status === 'sorti') && (
              <Typography variant="body2" color={free >= Number(f.quantity || 1) ? 'text.secondary' : 'error'}>
                {freeLabel(free, l.equipment.quantity)}
              </Typography>
            )}
            {l.equipment.quantity > 1 && (
              <TextField type="number" label="Quantité" value={f.quantity} onChange={set('quantity')} sx={{ maxWidth: 140 }}
                inputProps={{ min: 1, max: l.equipment.quantity, inputMode: 'numeric' }} />
            )}
            <TextField label="Salarié qui emprunte" value={f.borrower_name || ''} onChange={set('borrower_name')} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField label="Service" value={f.borrower_service || ''} onChange={set('borrower_service')} />
              <TextField label="Téléphone ou e-mail" value={f.borrower_contact || ''} onChange={set('borrower_contact')} />
            </Stack>
            <TextField type="number" label="Caution (€)" value={f.deposit} onChange={set('deposit')} sx={{ maxWidth: 180 }}
              inputProps={{ min: 0, step: '0.01', inputMode: 'decimal' }} />
            <TextField label="Notes" value={f.notes || ''} onChange={set('notes')} multiline minRows={2} />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" disabled={busy}
                onClick={() => patch({ ...f, quantity: Number(f.quantity || 1), deposit: f.deposit === '' ? null : Number(f.deposit) }, 'Prêt modifié')}>
                Enregistrer
              </Button>
              <Button onClick={() => setMode('view')}>Annuler</Button>
            </Stack>
          </Stack>
        </Collapse>
        <ErrorAlert error={error} onClose={() => setError(null)} />
      </DialogContent>
      {mode === 'view' && (
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
          <Button onClick={startEdit}>Modifier</Button>
          <Box sx={{ flex: 1 }} />
          {l.status === 'reserve' && <Button color="error" onClick={() => window.confirm('Annuler cette réservation ?') && patch({ status: 'annule' }, 'Réservation annulée')}>Annuler la réservation</Button>}
          {l.status === 'reserve' && <Button variant="contained" onClick={() => { setF({ deposit_received: l.deposit_received }); setMode('hand') }}>Remettre au salarié</Button>}
          {l.status === 'sorti' && <Button variant="contained" onClick={() => { setF({ returned_on: todayIso(), return_state: 'bon', deposit_returned: false, notes: l.notes || '' }); setMode('return') }}>Marquer comme rendu</Button>}
          {l.status === 'rendu' && hasDeposit(l) && l.deposit_received && !l.deposit_returned && (
            <Button variant="outlined" onClick={() => patch({ deposit_returned: true }, 'Caution rendue')}>Caution rendue</Button>
          )}
          {l.status === 'sorti' && hasDeposit(l) && !l.deposit_received && (
            <Button variant="outlined" onClick={() => patch({ deposit_received: true }, 'Caution reçue')}>Caution reçue</Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}

// ---------- Matériel ----------

function EquipmentView() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const narrow = useNarrow()
  const load = () => api('/equipment').then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const save = async (ev) => {
    ev.preventDefault()
    setError(null); setBusy(true)
    const body = { name: edit.name, description: edit.description, quantity: Number(edit.quantity || 1),
      deposit: edit.deposit === '' ? null : Number(edit.deposit), location: edit.location, active: edit.active }
    try {
      await api(edit.id ? `/equipment/${edit.id}` : '/equipment', { method: edit.id ? 'PATCH' : 'POST', body })
      setEdit(null); setToast(edit.id ? 'Matériel modifié' : 'Matériel ajouté'); load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Supprimer « ${edit.name} » ?`)) return
    try { await api(`/equipment/${edit.id}`, { method: 'DELETE' }); setEdit(null); setToast('Matériel supprimé'); load() } catch (err) { setError(err.message) }
  }
  const set = (k) => (ev) => setEdit({ ...edit, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value })

  return (
    <Box sx={{ maxWidth: 860 }}>
      <LoansHeader action={(
        <Button variant="contained" startIcon={<AddIcon />}
          onClick={() => setEdit({ name: '', description: '', quantity: 1, deposit: '', location: '', active: true })}>
          Ajouter
        </Button>
      )} />
      <ErrorAlert error={error && !edit ? error : null} onClose={() => setError(null)} />
      {rows && rows.length === 0 && (
        <Card sx={{ p: 2.5 }}>
          <Typography>Aucun matériel pour l’instant.</Typography>
          <Typography variant="body2" color="text.secondary">« Ajouter » : nom, quantité, caution demandée et lieu de rangement.</Typography>
        </Card>
      )}
      <Stack spacing={1} sx={{ mb: 3 }}>
        {rows?.map((e) => (
          <Card key={e.id} sx={{ opacity: e.active ? 1 : 0.65 }}>
            <CardActionArea sx={{ p: 2 }} onClick={() => setEdit({ ...e, deposit: e.deposit != null ? String(Number(e.deposit)) : '', description: e.description || '', location: e.location || '' })}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap', rowGap: 0.75 }}>
                <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{e.name}</Typography>
                {!e.active && <Chip size="small" variant="outlined" label="Retiré du prêt" />}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {[e.active ? `${e.available_today} disponible${e.available_today > 1 ? 's' : ''} aujourd’hui sur ${e.quantity}` : `${e.quantity} au total`,
                  e.out_now ? `${e.out_now} sorti${e.out_now > 1 ? 's' : ''}` : null,
                  e.reserved ? `${e.reserved} réservé${e.reserved > 1 ? 's' : ''}` : null,
                  e.deposit != null && Number(e.deposit) > 0 ? `caution ${euros(e.deposit)}` : 'sans caution',
                  e.location].filter(Boolean).join(' · ')}
              </Typography>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
      {rows?.some((e) => e.active) && <ShareCard />}

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="sm" fullScreen={narrow} component="form" onSubmit={save}>
        <DialogTitle>{edit?.id ? 'Modifier le matériel' : 'Ajouter du matériel'}</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label="Nom" value={edit.name} onChange={set('name')} required inputProps={{ maxLength: 120 }}
                placeholder="Ex. : tente de réception 3 × 6 m" />
              <Stack direction="row" spacing={1.5}>
                <TextField type="number" label="Quantité" value={edit.quantity} onChange={set('quantity')} inputProps={{ min: 1, max: 999, inputMode: 'numeric' }} />
                <TextField type="number" label="Caution (€)" value={edit.deposit} onChange={set('deposit')}
                  inputProps={{ min: 0, step: '0.01', inputMode: 'decimal' }} helperText="Vide : pas de caution" />
              </Stack>
              <TextField label="Rangement (facultatif)" value={edit.location} onChange={set('location')} placeholder="Ex. : local CSE, armoire du fond" />
              <TextField label="Description (facultatif)" value={edit.description} onChange={set('description')} multiline minRows={2}
                placeholder="Ce qui est fourni, consignes" />
              {edit.id && <FormControlLabel control={<Switch checked={edit.active} onChange={set('active')} />} label="Disponible au prêt" />}
            </Stack>
          )}
          <ErrorAlert error={edit ? error : null} onClose={() => setError(null)} />
        </DialogContent>
        <DialogActions>
          {edit?.id && !edit.loan_count && <Button color="error" onClick={remove} sx={{ mr: 'auto' }}>Supprimer</Button>}
          <Button onClick={() => setEdit(null)}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={busy}>Enregistrer</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Box>
  )
}

// Où les salariés demandent : l'accueil d'AlloCSE, ou ce lien direct (affiche, message, intranet)
function ShareCard() {
  const [copied, setCopied] = useState(false)
  const url = borrowUrl()
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true) } catch { /* presse-papiers indisponible */ }
  }
  return (
    <Card sx={{ p: 2 }}>
      <Typography sx={{ fontWeight: 700 }}>Les salariés demandent en ligne</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Sur l’accueil d’AlloCSE, « Emprunter du matériel » propose le matériel disponible au prêt. Lien direct à partager :
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Typography variant="body2" sx={{ fontFamily: mono, overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}>{url}</Typography>
        <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
          Copier le lien
        </Button>
      </Stack>
      <Snackbar open={copied} autoHideDuration={2000} onClose={() => setCopied(false)} message="Lien copié" />
    </Card>
  )
}
