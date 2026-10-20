import { useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import {
  Box, Button, Checkbox, Collapse, FormControl, FormControlLabel, FormGroup, FormHelperText, MenuItem,
  Radio, RadioGroup, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { useApp } from '../App'
import { api, myCodes, myIdentity } from '../api'
import { ErrorAlert, KindChoice, TicketCode } from '../components'

function Fieldset({ legend, hint, children }) {
  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, mb: 4 }}>
      <Typography component="legend" variant="h3" sx={{ mb: hint ? 0.5 : 1.5 }}>{legend}</Typography>
      {hint && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: '60ch' }}>{hint}</Typography>}
      {children}
    </Box>
  )
}

export default function Submit() {
  const { config } = useApp()
  const [params] = useSearchParams()
  const saved = myIdentity.get()
  const [remember, setRemember] = useState(true)
  const [form, setForm] = useState({
    kind: ['demande', 'signalement'].includes(params.get('type')) ? params.get('type') : '',
    temporality: 'actuel', situation_start: '', situation_end: '', category: '', subject: '', description: '',
    anonymous: false, requester_name: saved?.name || '', requester_service: saved?.service || '', requester_email: saved?.email || '',
    visible_to_all: true, viewer_ids: [], notify: false, notify_email: '',
  })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))

  const toggleViewer = (id) => setForm((f) => ({
    ...f, viewer_ids: f.viewer_ids.includes(id) ? f.viewer_ids.filter((x) => x !== id) : [...f.viewer_ids, id],
  }))

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!form.kind) return setError('Choisissez s’il s’agit d’une demande ou d’un signalement.')
    if (!form.category) return setError('Choisissez un thème.')
    if (form.subject.trim().length < 3) return setError('Donnez un objet d’au moins 3 caractères.')
    if (form.description.trim().length < 5) return setError('Décrivez la situation en quelques mots.')
    const email = form.requester_email.trim()
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return setError('L’adresse e-mail ne semble pas valide.')
    if (form.notify && !email) return setError('Indiquez votre e-mail pour être prévenu, ou décochez la case.')
    if (form.kind === 'signalement' && form.situation_start && form.situation_end && form.situation_end < form.situation_start) {
      return setError('La fin de la situation ne peut pas précéder son début.')
    }
    if (!form.visible_to_all && form.viewer_ids.length === 0) {
      setError('Cochez au moins un élu qui pourra lire votre demande.')
      return
    }
    setSending(true)
    try {
      const body = { ...form }
      for (const k of ['requester_name', 'requester_service', 'requester_email']) if (!body[k]?.trim()) body[k] = null
      if (body.kind === 'demande') { body.temporality = null; body.situation_start = null; body.situation_end = null }
      for (const k of ['situation_start', 'situation_end']) if (!body[k]) body[k] = null
      // Une seule adresse : celle de « Qui êtes-vous ? ». En anonyme, elle ne sert qu'à prévenir et n'est pas transmise aux élus.
      body.notify_email = body.notify ? email : null
      if (body.anonymous) body.requester_email = null
      const res = await api('/public/requests', { method: 'POST', body })
      myCodes.add(res.tracking_code, form.subject)
      if (remember) {
        // En anonyme, on ne remplace pas un nom déjà retenu
        const prev = myIdentity.get() || {}
        myIdentity.save({
          name: form.anonymous ? prev.name || '' : form.requester_name.trim(),
          service: form.anonymous ? prev.service || '' : form.requester_service.trim(),
          email: email || prev.email || '',
        })
      } else myIdentity.clear()
      setDone(res)
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
          Notez ce numéro ou envoyez-le-vous : c’est le seul moyen de suivre votre demande et de lire la réponse.
          Le CSE ne peut pas le retrouver pour vous.
        </Typography>
        <TicketCode code={done.tracking_code} subject={form.subject} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3 }}>
          <Button variant="contained" component={RouterLink} to={`/suivi/${done.tracking_code}`}>Voir le suivi</Button>
          <Button component={RouterLink} to="/">Retour à l’accueil</Button>
        </Stack>
      </Box>
    )
  }

  const elus = config?.elus || []
  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ pt: { xs: 1, sm: 3 }, maxWidth: 680 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 3 }}>Écrire au CSE</Typography>

      <Fieldset legend="De quoi s’agit-il ?">
        <KindChoice value={form.kind} onChange={(kind) => setForm((f) => ({ ...f, kind }))} />
        <Collapse in={form.kind === 'signalement'}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Cette situation…</Typography>
          <RadioGroup value={form.temporality} onChange={set('temporality')} sx={{ mb: 2 }}>
            <FormControlLabel value="actuel" control={<Radio />} label="existe déjà" />
            <FormControlLabel value="a_venir" control={<Radio />} label="est annoncée ou se prépare" />
          </RadioGroup>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField type="date" label={form.temporality === 'a_venir' ? 'À partir du' : 'Depuis le'} value={form.situation_start}
              onChange={set('situation_start')} InputLabelProps={{ shrink: true }} helperText="Début de la situation, si vous le savez" />
            <TextField type="date" label="Jusqu’au" value={form.situation_end} onChange={set('situation_end')}
              InputLabelProps={{ shrink: true }} inputProps={{ min: form.situation_start || undefined }}
              helperText="Fin, si elle est connue (sinon laissez vide)" />
          </Stack>
        </Collapse>
        <TextField select label="Thème" value={form.category} onChange={set('category')} required>
          {(config?.categories || []).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
      </Fieldset>

      <Fieldset legend="Votre message">
        <Stack spacing={2}>
          <TextField label="Objet" value={form.subject} onChange={set('subject')} required inputProps={{ maxLength: 200 }}
            placeholder={form.kind === 'signalement' ? 'Ex. : fontaine à eau balisée' : 'Ex. : date des chèques cadeaux'} />
          <TextField label="Détails" value={form.description} onChange={set('description')} required multiline minRows={5}
            helperText="Où, quand, qui est concerné, ce que vous attendez du CSE." />
        </Stack>
      </Fieldset>

      <Fieldset legend="Qui êtes-vous ?" hint="Facultatif. La réponse du CSE se lit dans AlloCSE avec votre numéro de suivi.">
        <FormControlLabel sx={{ mb: 1 }} control={<Switch checked={form.anonymous} onChange={set('anonymous')} />}
          label="Rester anonyme auprès des élus" />
        <Stack spacing={2}>
          <Collapse in={!form.anonymous} unmountOnExit>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Nom et prénom" value={form.requester_name} onChange={set('requester_name')} autoComplete="name" />
              <TextField label="Service ou atelier" value={form.requester_service} onChange={set('requester_service')} />
            </Stack>
          </Collapse>
          <TextField label="E-mail" type="email" value={form.requester_email}
            onChange={set('requester_email')} autoComplete="email" inputProps={{ inputMode: 'email' }}
            helperText={form.anonymous
              ? 'Seulement si vous voulez être prévenu : jamais montrée aux élus, effacée une fois la demande close.'
              : 'Pour que les élus puissent vous recontacter.'} />
        </Stack>
        <FormControlLabel sx={{ mt: 1.5, alignItems: 'flex-start', display: 'flex' }}
          control={<Checkbox checked={form.notify} onChange={set('notify')} sx={{ mt: -0.75 }} />}
          label="Me prévenir par e-mail quand ma demande avance (réponse du CSE, question du CSE, clôture)" />
        <FormControlLabel sx={{ mt: 1, alignItems: 'flex-start', display: 'flex' }}
          control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} sx={{ mt: -0.75 }} />}
          label={<span>Se souvenir de mes coordonnées sur cet appareil
            <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
              Décochez sur un poste partagé : elles seront effacées de cet appareil à l’envoi.
            </Typography></span>} />
      </Fieldset>

      <Fieldset legend="Qui peut lire votre demande ?"
        hint="Les élus que vous excluez ne voient ni le contenu ni l’existence de votre demande, même s’ils sont administrateurs.">
        <RadioGroup value={form.visible_to_all ? 'all' : 'some'}
          onChange={(e) => setForm((f) => ({ ...f, visible_to_all: e.target.value === 'all' }))}>
          <FormControlLabel value="all" control={<Radio />} label="Tous les élus du CSE" />
          <FormControlLabel value="some" control={<Radio />} label="Seulement les élus que je choisis" />
        </RadioGroup>
        <Collapse in={!form.visible_to_all}>
          <FormControl component="div" error={!form.visible_to_all && form.viewer_ids.length === 0}
            sx={{ mt: 1, p: 2, border: 1, borderColor: 'divider', borderRadius: 3, width: '100%' }}>
            {elus.length === 0 && <Typography color="text.secondary">Aucun élu n’est encore inscrit.</Typography>}
            <FormGroup>
              {elus.map((u) => (
                <FormControlLabel key={u.id}
                  control={<Checkbox checked={form.viewer_ids.includes(u.id)} onChange={() => toggleViewer(u.id)} />}
                  label={<span><strong>{u.full_name}</strong>{u.mandate ? <Typography component="span" variant="body2" color="text.secondary">, {u.mandate}</Typography> : null}</span>} />
              ))}
            </FormGroup>
            <FormHelperText>{form.viewer_ids.length} élu(s) sélectionné(s)</FormHelperText>
          </FormControl>
        </Collapse>
      </Fieldset>

      <ErrorAlert error={error} onClose={() => setError(null)} />
      <Button type="submit" variant="contained" size="large" disabled={sending}
        sx={{ width: { xs: '100%', sm: 'auto' } }}>
        {sending ? 'Envoi…' : form.kind === 'signalement' ? 'Envoyer le signalement' : form.kind === 'demande' ? 'Envoyer la demande' : 'Envoyer'}
      </Button>
    </Box>
  )
}
