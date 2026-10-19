import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { auth } from '../../api'
import { ErrorAlert } from '../../components'

// Ouvert automatiquement après un clic sur le lien « mot de passe oublié »
export default function NewPasswordDialog({ onDone }) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setError(null)
    if (pwd.length < 8) return setError('Le mot de passe doit faire au moins 8 caractères.')
    if (pwd !== confirm) return setError('Les deux saisies sont différentes.')
    setBusy(true)
    try { await auth.setNewPassword(pwd); onDone() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Dialog open fullWidth maxWidth="xs" component="form" onSubmit={save}>
      <DialogTitle>Choisir un nouveau mot de passe</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>8 caractères minimum.</Typography>
        <Stack spacing={2}>
          <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          <TextField label="Confirmer" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Stack>
        <ErrorAlert error={error} />
      </DialogContent>
      <DialogActions>
        <Button type="submit" variant="contained" disabled={busy}>Enregistrer le mot de passe</Button>
      </DialogActions>
    </Dialog>
  )
}
