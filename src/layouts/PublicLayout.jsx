import { Link as RouterLink, Outlet } from 'react-router-dom'
import { Box, Button, Container, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material'
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeIcon from '@mui/icons-material/LightModeOutlined'
import { useApp } from '../App'
import { palette } from '../theme'
import { tenant } from '../tenant'
import { DemoBanner } from '../components'

export function Logo({ to = '/', light = false }) {
  return (
    <Link component={RouterLink} to={to} underline="none" aria-label="AlloCSE, accueil"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: light ? '#fff' : 'text.primary' }}>
      <Box component="svg" viewBox="0 0 32 32" sx={{ width: 30, height: 30 }} aria-hidden>
        <rect x="2" y="4" width="28" height="19" rx="6" fill={palette.signal} />
        <path d="M8 22 L7 29 L14 22.5 Z" fill={palette.signal} />
        <circle cx="10" cy="13.5" r="2" fill={palette.ink} />
        <circle cx="16" cy="13.5" r="2" fill={palette.ink} />
        <circle cx="22" cy="13.5" r="2" fill={palette.ink} />
      </Box>
      <Typography component="span" sx={{ fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
        AlloCSE
      </Typography>
      {tenant.logo && <>
        <Box aria-hidden sx={{ width: '1px', height: 28, bgcolor: light ? 'rgba(255,255,255,.4)' : 'divider', mx: 0.5 }} />
        <Box component="img" src={tenant.logo} alt={tenant.name} sx={{ height: 34, width: 'auto', display: 'block' }} />
      </>}
    </Link>
  )
}

export function ModeToggle({ color }) {
  const { mode, toggleMode } = useApp()
  return (
    <Tooltip title={mode === 'dark' ? 'Thème clair' : 'Thème sombre'}>
      <IconButton onClick={toggleMode} aria-label="Changer de thème" sx={{ color }}>
        {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    </Tooltip>
  )
}

export default function PublicLayout() {
  const { config, user } = useApp()
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <DemoBanner config={config} />
      <Container maxWidth="md" component="header"
        sx={{ py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Logo />
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <ModeToggle />
          <Button component={RouterLink} to={user?.is_active ? '/elus' : '/elus/connexion'} variant="text" size="small">
            Espace élus
          </Button>
        </Stack>
      </Container>
      <Container maxWidth="md" component="main" sx={{ flex: 1, pb: 6 }}>
        <Outlet />
      </Container>
      <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: 2.5 }}>
        <Container maxWidth="md">
          <Typography variant="body2" color="text.secondary">
            CSE {config?.organisation || ''}
            {config?.contact && <> — <Link href={`mailto:${config.contact}`}>{config.contact}</Link></>}
          </Typography>
        </Container>
      </Box>
    </Box>
  )
}
