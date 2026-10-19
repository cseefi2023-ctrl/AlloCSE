import { useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useApp } from '../../App'
import { auth, updateMyProfile } from '../../api'
import { ErrorAlert } from '../../components'

export default function Profile() {
  const { user, reloadUser, refreshConfig, config } = useApp()
  const [profile, setProfile] = useState({ full_name: user.full_name, mandate: user.mandate || '' })
  const [pErr, setPErr] = useState(null)
  const [pOk, setPOk] = useState(false)
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  const saveProfile = async (e) => {
    e.preventDefault()
    setPErr(null); setPOk(false)
    try { await updateMyProfile(profile.full_name, profile.mandate); await reloadUser(); refreshConfig(); setPOk(true) } catch (err) { setPErr(err.message) }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null); setOk(false)
    if (form.new_password.length < 8) return setError('Le nouveau mot de passe doit faire au moins 8 caractères.')
    if (form.new_password !== form.confirm) return setError('Les deux saisies du nouveau mot de passe sont différentes.')
    try {
      await auth.changePassword(user.email, form.current_password, form.new_password)
      setOk(true); setForm({ current_password: '', new_password: '', confirm: '' })
    } catch (err) { setError(err.message) }
  }

  return (
    <Box sx={{ maxWidth: 440 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 0.5 }}>Mon profil</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>{user.email}</Typography>

      <Box component="form" onSubmit={saveProfile} sx={{ mb: 5 }}>
        <Stack spacing={2}>
          <TextField label="Nom et prénom" value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
          <TextField label="Mandat" value={profile.mandate} onChange={(e) => setProfile({ ...profile, mandate: e.target.value })}
            helperText="Affiché aux salariés quand ils choisissent qui peut lire leur demande." />
        </Stack>
        <ErrorAlert error={pErr} />
        {pOk && <Alert severity="success" sx={{ my: 2 }}>Profil enregistré.</Alert>}
        <Button type="submit" variant="outlined" sx={{ mt: 2 }}>Enregistrer le profil</Button>
      </Box>

      {config?.demo ? (
        <Alert severity="info">Démonstration : le mot de passe des comptes de démonstration ne peut pas être changé.</Alert>
      ) : <Box component="form" onSubmit={submit}>
        <Typography variant="h3" component="h2" sx={{ mb: 2 }}>Mot de passe</Typography>
        <Stack spacing={2}>
          <TextField label="Mot de passe actuel" type="password" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} />
          <TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} />
          <TextField label="Confirmer le nouveau mot de passe" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Stack>
        <ErrorAlert error={error} />
        {ok && <Alert severity="success" sx={{ my: 2 }}>Mot de passe modifié.</Alert>}
        <Button type="submit" variant="contained" sx={{ mt: 2 }}>Changer le mot de passe</Button>
      </Box>}
    </Box>
  )
}
