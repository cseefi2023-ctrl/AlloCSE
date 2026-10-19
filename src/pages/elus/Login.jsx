import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Link, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useApp } from '../../App'
import { auth } from '../../api'
import { ErrorAlert } from '../../components'

export default function Login() {
  const { session, user } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('login') // login | signup | reset
  const [form, setForm] = useState({ email: '', password: '', full_name: '', mandate: '' })
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (session && user?.is_active) return <Navigate to={location.state?.from || '/elus'} replace />
  if (session && user && !user.is_active) return <Navigate to="/elus/en-attente" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null); setInfo(null)
    try {
      if (mode === 'login') {
        await auth.signIn(form.email, form.password)
        navigate(location.state?.from || '/elus', { replace: true })
      } else if (mode === 'signup') {
        if (form.full_name.trim().length < 2) throw new Error('Indiquez votre nom et prénom.')
        if (form.password.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.')
        const res = await auth.signUp(form.email, form.password, form.full_name, form.mandate)
        if (!res.session) {
          setInfo('Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous ici.')
          setMode('login')
        }
      } else {
        await auth.resetPassword(form.email)
        setInfo('Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.')
        setMode('login')
      }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const titles = { login: 'Se connecter', signup: 'Créer mon compte', reset: 'Recevoir un lien' }
  return (
    <Box component="form" onSubmit={submit} sx={{ pt: { xs: 2, sm: 6 }, maxWidth: 440 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Espace élus</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Réservé aux membres du CSE. Un nouveau compte doit être validé par un administrateur avant d’accéder aux demandes.
      </Typography>
      {mode !== 'reset' && (
        <ToggleButtonGroup exclusive fullWidth color="primary" value={mode} onChange={(_, v) => v && (setMode(v), setError(null))} sx={{ mb: 2.5 }}>
          <ToggleButton value="login" sx={{ textTransform: 'none', fontWeight: 700 }}>J’ai un compte</ToggleButton>
          <ToggleButton value="signup" sx={{ textTransform: 'none', fontWeight: 700 }}>Je suis un nouvel élu</ToggleButton>
        </ToggleButtonGroup>
      )}
      {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}
      <Stack spacing={2}>
        {mode === 'signup' && <>
          <TextField label="Nom et prénom" value={form.full_name} onChange={set('full_name')} autoComplete="name" />
          <TextField label="Mandat (ex. Titulaire, collège ouvriers)" value={form.mandate} onChange={set('mandate')} />
        </>}
        <TextField label="E-mail" type="email" value={form.email} onChange={set('email')} autoComplete="username" />
        {mode !== 'reset' && (
          <TextField label="Mot de passe" type="password" value={form.password} onChange={set('password')}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            helperText={mode === 'signup' ? '8 caractères minimum' : ' '} />
        )}
      </Stack>
      <ErrorAlert error={error} />
      <Button type="submit" variant="contained" size="large" disabled={busy || !form.email || (mode !== 'reset' && !form.password)}
        sx={{ mt: 2, width: '100%' }}>
        {busy ? 'Patientez…' : titles[mode]}
      </Button>
      <Box sx={{ mt: 2, textAlign: 'center' }}>
        {mode === 'login' && <Link component="button" type="button" onClick={() => { setMode('reset'); setError(null) }}>Mot de passe oublié</Link>}
        {mode === 'reset' && <Link component="button" type="button" onClick={() => setMode('login')}>Retour à la connexion</Link>}
      </Box>
    </Box>
  )
}
