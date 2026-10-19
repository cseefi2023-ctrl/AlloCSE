import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useApp } from '../../App'

// Compte créé mais pas encore validé par un administrateur
export default function Pending() {
  const { session, user, reloadUser, logout } = useApp()
  const navigate = useNavigate()

  useEffect(() => {
    const t = setInterval(() => reloadUser(), 30000)
    return () => clearInterval(t)
  }, [reloadUser])

  if (!session) return <Navigate to="/elus/connexion" replace />
  if (user?.is_active) return <Navigate to="/elus" replace />

  return (
    <Box sx={{ pt: { xs: 2, sm: 6 }, maxWidth: 520 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 1 }}>Compte en attente de validation</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {user ? `Bonjour ${user.full_name}. ` : ''}Votre compte est créé. Un administrateur du CSE doit le valider
        avant que vous puissiez voir les demandes. Cette page se met à jour toute seule.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Button variant="contained" onClick={() => reloadUser()}>Vérifier maintenant</Button>
        <Button onClick={async () => { await logout(); navigate('/') }}>Se déconnecter</Button>
      </Stack>
    </Box>
  )
}
