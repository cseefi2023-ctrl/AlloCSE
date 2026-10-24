import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardActionArea, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, InputAdornment, Link, MenuItem, Radio, RadioGroup, Snackbar, Stack, Switch, TextField, Typography, useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { api, fmtShort, todayIso } from '../../api'
import { ErrorAlert, MoreMenu, Section, useNarrow } from '../../components'
import { palette } from '../../theme'
import { FilterChips, LoansHeader } from './shared'

const tint = (c) => ({ bgcolor: `${c}1F`, color: c, border: `1px solid ${c}55` })
const euros = (x) => Number(x).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const hasDeposit = (l) => l.deposit != null && Number(l.deposit) > 0
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const RETURN_STATES = { bon: 'Bon état', abime: 'Abîmé', incomplet: 'Incomplet' }

export default function Loans({ view }) {
  return view === 'materiel' ? <EquipmentView /> : <LoansView />
}

// ---------- Prêts ----------

const VIEWS = { en_cours: 'En cours', rendus: 'Rendus', tous: 'Tous' }

function LoansView() {
  const [params, setParams] = useSearchParams()
  const vue = VIEWS[params.get('vue')] ? params.get('vue') : 'en_cours'
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [equipment, setEquipment] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [current, setCurrent] = useState(null)
  const [toast, setToast] = useState(null)

  const load = useCallback(() => api('/loans', { query: { vue, q } }).then(setRows).catch((e) => setError(e.message)), [vue, q])
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  const loadEquipment = () => api('/equipment').then(setEquipment).catch(() => setEquipment([]))
  useEffect(() => { loadEquipment() }, [])

  const saved = (msg) => { setToast(msg); load(); loadEquipment() }
  const active = (equipment || []).filter((e) => e.active)
  const late = rows?.filter((l) => l.late) || []
  const toHand = rows?.filter((l) => l.to_hand) || []
  const out = rows?.filter((l) => l.status === 'sorti' && !l.late) || []
  const reserved = rows?.filter((l) => l.status === 'reserve' && !l.to_hand) || []
  const list = (items) => <Stack spacing={1}>{items.map((l) => <LoanRow key={l.id} l={l} onOpen={setCurrent} />)}</Stack>

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
      <LoanDialog loan={current} onClose={() => setCurrent(null)} onSaved={(l, msg) => { setCurrent(l); saved(msg) }}
        onDeleted={() => { setCurrent(null); saved('Prêt supprimé') }} />
      <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)} message={toast} />
    </Box>
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
              {free <= 0 ? 'Pas disponible sur ces dates.'
                : `${free} disponible${free > 1 ? 's' : ''} sur ${e.quantity} sur ces dates.`}
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
            Enregistré{l.created_by ? ` par ${l.created_by.full_name}` : ''} le {fmtShort(l.created_at)}
          </Typography>
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
                {free <= 0 ? 'Pas disponible sur ces dates.' : `${free} disponible${free > 1 ? 's' : ''} sur ${l.equipment.quantity} sur ces dates.`}
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
      <Stack spacing={1}>
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
