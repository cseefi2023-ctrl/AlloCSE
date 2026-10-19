import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, BottomNavigation, BottomNavigationAction, Box, Divider, Drawer, IconButton, List,
  ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Toolbar, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import { useState } from 'react'
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboardOutlined'
import InboxIcon from '@mui/icons-material/InboxOutlined'
import EventNoteIcon from '@mui/icons-material/EventNoteOutlined'
import ViewTimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import GroupIcon from '@mui/icons-material/GroupOutlined'
import AccountCircleIcon from '@mui/icons-material/AccountCircleOutlined'
import { useApp } from '../App'
import { Logo, ModeToggle } from './PublicLayout'

const DRAWER = 240

export default function EluLayout() {
  const { user, logout } = useApp()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const location = useLocation()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(null)

  const nav = [
    { to: '/elus', label: 'Accueil', icon: <SpaceDashboardIcon />, end: true },
    { to: '/elus/demandes', label: 'Demandes', icon: <InboxIcon /> },
    { to: '/elus/suivi', label: 'Suivi', icon: <ViewTimelineIcon /> },
    { to: '/elus/reunions', label: 'Réunions', icon: <EventNoteIcon /> },
    ...(user.role === 'admin' ? [{ to: '/elus/comptes', label: 'Élus', icon: <GroupIcon /> }] : []),
  ]
  const active = [...nav].reverse().find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <AppBar position="fixed" color="inherit" elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'background.paper' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Logo to="/elus" />
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, ml: 1 }}>
            Espace élus
          </Typography>
          <Box sx={{ flex: 1 }} />
          <ModeToggle />
          <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="Mon compte">
            <AccountCircleIcon />
          </IconButton>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography sx={{ fontWeight: 700 }}>{user.full_name}</Typography>
              <Typography variant="body2" color="text.secondary">{user.mandate || (user.role === 'admin' ? 'Administrateur' : 'Élu')}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={() => { setMenu(null); navigate('/elus/profil') }}>Mon profil</MenuItem>
            <MenuItem onClick={() => { setMenu(null); navigate('/') }}>Voir l’espace salarié</MenuItem>
            <MenuItem onClick={async () => { setMenu(null); await logout(); navigate('/') }}>Se déconnecter</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {desktop && (
        <Drawer variant="permanent" sx={{ width: DRAWER, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER, boxSizing: 'border-box', borderColor: 'divider' } }}>
          <Toolbar />
          <List sx={{ px: 1, pt: 2 }}>
            {nav.map((n) => (
              <ListItemButton key={n.to} component={NavLink} to={n.to} end={n.end} selected={active?.to === n.to}
                sx={{ borderRadius: 2, mb: 0.5, '&.Mui-selected': { bgcolor: 'action.selected', fontWeight: 700 } }}>
                <ListItemIcon sx={{ minWidth: 38 }}>{n.icon}</ListItemIcon>
                <ListItemText primary={n.label} primaryTypographyProps={{ fontWeight: active?.to === n.to ? 700 : 400 }} />
              </ListItemButton>
            ))}
          </List>
        </Drawer>
      )}

      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3, md: 4 }, pt: { xs: 9, sm: 10 }, pb: { xs: 11, md: 5 } }}>
        <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
          <Outlet />
        </Box>
      </Box>

      {!desktop && (
        <Paper square sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)', zIndex: 10 }}>
          <BottomNavigation showLabels value={active?.to || false} onChange={(_, v) => navigate(v)}>
            {nav.map((n) => <BottomNavigationAction key={n.to} value={n.to} label={n.label} icon={n.icon} />)}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  )
}
