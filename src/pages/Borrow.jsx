import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import { api, euros, hasAmount, isIsoDate, myCodes, myIdentity, plusDays, todayIso } from '../api'
import { ErrorAlert, Fieldset, TicketCode } from '../components'

// Quantité encore libre pour un matériel sur des dates (null tant que les dates sont incomplètes)
function useFree(equipmentId, from, to) {
  const [free, setFree] = useState(null)
  useEffect(() => {
    setFree(null)
    if (!equipmentId || !isIsoDate(from) || !isIsoDate(to) || to < from) return undefined
    const t = setTimeout(() => {
      api(`/public/equipment/${equipmentId}/availability`, { query: { from, to } }).then(setFree).catch(() => setFree(null))
    }, 200)
    return () => clearTimeout(t)
  }, [equipmentId, from, to])
  return free
}

// Demande d'emprunt de matériel par un salarié : le CSE accepte (réservation) ou refuse
export default function Borrow() {
  const saved = myIdentity.get()
  const [items, setItems] = useState(null)
  const [f, setF] = useState({
    equipment_id: null, quantity: 1, start_date: '', due_date: '', message: '', notify: false,
    requester_name: saved?.name || '', requester_service: saved?.service || '', requester_email: saved?.email || '',
  })
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    api('/public/equipment')
      .then((x) => { setItems(x); if (x.length === 1) setF((y) => ({ ...y, equipment_id: x[0].id })) })
      .catch((e) => { setItems([]); setError(e.message) })
  }, [])

  const item = items?.find((x) => x.id === f.equipment_id)
  const qty = Math.max(1, Number(f.quantity) || 1)
  const free = useFree(f.equipment_id, f.start_date, f.due_date)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const setStart = (v) => setF({ ...f, start_date: v, due_date: !f.due_date && isIsoDate(v) ? plusDays(v, 1) : f.due_date < v ? v : f.due_date })

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!item) return setError('Choisissez le matériel à emprunter.')
    if (!isIsoDate(f.start_date) || !isIsoDate(f.due_date)) return setError('Indiquez les dates d’emprunt et de retour.')
    if (f.start_date < todayIso()) return setError('La date d’emprunt est déjà passée.')
    if (f.due_date < f.start_date) return setError('Le retour ne peut pas précéder l’emprunt.')
    if (free != null && free < qty) return setError('Ce matériel n’est pas disponible sur ces dates : choisissez d’autres dates.')
    if (f.requester_name.trim().length < 2) return setError('Indiquez votre nom et votre prénom.')
    const email = f.requester_email.trim()
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return setError('L’adresse e-mail ne semble pas valide.')
    if (f.notify && !email) return setError('Indiquez votre e-mail pour être prévenu, ou décochez la case.')
    setSending(true)
    try {
      const res = await api('/public/loan-requests', {
        method: 'POST',
        body: { ...f, quantity: qty, requester_email: email || null, requester_service: f.requester_service.trim() || null },
      })
      myCodes.add(res.tracking_code, `Emprunt : ${item.name}`)
      if (remember) {
        myIdentity.save({ name: f.requester_name.trim(), service: f.requester_service.trim(), email: email || myIdentity.get()?.email || '' })
      } else myIdentity.clear()
      setDone({ ...res, subject: `Emprunt : ${item.name}` })
      window.scrollTo({ top: 0 })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <Box sx={{ pt: { xs: 2, sm: 5 }, maxWidth: 620 }}>
        <Typography variant="h2" component="h1" sx={{ mb: 1 }}>C’est envoyé.</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Les élus vous répondent ici : accord, retrait du matériel, caution. Notez ce numéro ou envoyez-le-vous :
          c’est le seul moyen de suivre votre demande.
        </Typography>
        <TicketCode code={done.tracking_code} subject={done.subject} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3 }}>
          <Button variant="contained" component={RouterLink} to={`/suivi/${done.tracking_code}`}>Voir le suivi</Button>
          <Button component={RouterLink} to="/">Retour à l’accueil</Button>
        </Stack>
      </Box>
    )
  }

  if (!items) return <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>
  if (items.length === 0) {
    return (
      <Box sx={{ pt: { xs: 2, sm: 5 }, maxWidth: 620 }}>
        <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Emprunter du matériel</Typography>
        <ErrorAlert error={error} />
        <Typography color="text.secondary" sx={{ mb: 3 }}>Le CSE ne propose pas de matériel à emprunter pour l’instant.</Typography>
        <Button component={RouterLink} to="/">Retour à l’accueil</Button>
      </Box>
    )
  }

  const enough = free == null || free >= qty
  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ pt: { xs: 1, sm: 3 }, maxWidth: 680 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Emprunter du matériel</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: '60ch' }}>
        Le CSE prête du matériel aux salariés. Choisissez-le et vos dates : les élus vous répondent ici, avec votre numéro de suivi.
      </Typography>

      <Fieldset legend="Quel matériel ?">
        <RadioGroup value={f.equipment_id ? String(f.equipment_id) : ''} aria-label="Matériel"
          onChange={(e) => setF({ ...f, equipment_id: Number(e.target.value), quantity: 1 })}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {items.map((x) => {
            const on = x.id === f.equipment_id
            return (
              <Box key={x.id} component="label" sx={{
                display: 'flex', gap: 1, p: 2, pl: 1, borderRadius: 3, cursor: 'pointer', bgcolor: 'background.paper', minWidth: 0,
                border: 2, borderColor: on ? 'primary.main' : 'divider', '&:hover': { borderColor: on ? 'primary.main' : 'text.secondary' },
              }}>
                <Radio value={String(x.id)} sx={{ alignSelf: 'flex-start', mt: -0.75 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h4" component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{x.name}</Typography>
                  {x.description && <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{x.description}</Typography>}
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {[x.quantity > 1 ? `${x.quantity} exemplaires` : null,
                      hasAmount(x.deposit) ? `caution ${euros(x.deposit)}` : 'sans caution'].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </RadioGroup>
      </Fieldset>

      <Fieldset legend="Quand ?">
        <Stack direction="row" spacing={1.5}>
          <TextField type="date" label="Emprunt le" InputLabelProps={{ shrink: true }} value={f.start_date} required
            inputProps={{ min: todayIso() }} onChange={(e) => setStart(e.target.value)} />
          <TextField type="date" label="Retour le" InputLabelProps={{ shrink: true }} value={f.due_date} required
            inputProps={{ min: f.start_date || todayIso() }} onChange={set('due_date')} />
        </Stack>
        {item && item.quantity > 1 && (
          <TextField type="number" label="Combien ?" value={f.quantity} onChange={set('quantity')} sx={{ mt: 2, maxWidth: 160 }}
            inputProps={{ min: 1, max: item.quantity, inputMode: 'numeric' }} helperText={`Jusqu’à ${item.quantity}`} />
        )}
        {item && free != null && (
          <Alert severity={enough ? 'success' : free > 0 ? 'warning' : 'error'} sx={{ mt: 2 }}>
            {free <= 0 ? 'Déjà réservé sur ces dates : choisissez d’autres dates.'
              : enough ? (item.quantity > 1 ? `Disponible sur ces dates (${free} sur ${item.quantity}).` : 'Disponible sur ces dates.')
                : `Seulement ${free} disponible${free > 1 ? 's' : ''} sur ces dates.`}
          </Alert>
        )}
      </Fieldset>

      <Fieldset legend="Qui êtes-vous ?" hint="Pour que les élus sachent à qui prêter le matériel.">
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Nom et prénom" value={f.requester_name} onChange={set('requester_name')} autoComplete="name" required
              inputProps={{ maxLength: 120 }} />
            <TextField label="Service ou atelier" value={f.requester_service} onChange={set('requester_service')}
              inputProps={{ maxLength: 120 }} />
          </Stack>
          <TextField label="E-mail" type="email" value={f.requester_email} onChange={set('requester_email')} autoComplete="email"
            inputProps={{ inputMode: 'email', maxLength: 190 }} helperText="Facultatif : pour que les élus puissent vous joindre." />
        </Stack>
        <FormControlLabel sx={{ mt: 1.5, alignItems: 'flex-start', display: 'flex' }}
          control={<Checkbox checked={f.notify} onChange={set('notify')} sx={{ mt: -0.75 }} />}
          label="Me prévenir par e-mail de la réponse du CSE" />
        <FormControlLabel sx={{ mt: 1, alignItems: 'flex-start', display: 'flex' }}
          control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} sx={{ mt: -0.75 }} />}
          label={<span>Se souvenir de mes coordonnées sur cet appareil
            <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
              Décochez sur un poste partagé : elles seront effacées de cet appareil à l’envoi.
            </Typography></span>} />
      </Fieldset>

      <Fieldset legend="Un mot pour le CSE" hint="Facultatif.">
        <TextField label="Message" value={f.message} onChange={set('message')} multiline minRows={3} inputProps={{ maxLength: 2000 }}
          placeholder="Ex. : pour un anniversaire samedi" />
      </Fieldset>

      <ErrorAlert error={error} onClose={() => setError(null)} />
      <Button type="submit" variant="contained" size="large" disabled={sending || !enough} sx={{ width: { xs: '100%', sm: 'auto' } }}>
        {sending ? 'Envoi…' : 'Envoyer la demande'}
      </Button>
    </Box>
  )
}
