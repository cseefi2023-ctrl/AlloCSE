import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, Badge, BottomNavigation, BottomNavigationAction, Box, Divider, Drawer, IconButton, List,
  ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Toolbar, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import HomeIcon from '@mui/icons-material/HomeOutlined'
import InboxIcon from '@mui/icons-material/InboxOutlined'
import EventNoteIcon from '@mui/icons-material/EventNoteOutlined'
import GroupIcon from '@mui/icons-material/GroupOutlined'
import TopicIcon from '@mui/icons-material/TopicOutlined'
import InventoryIcon from '@mui/icons-material/Inventory2Outlined'
import AccountCircleIcon from '@mui/icons-material/AccountCircleOutlined'
import { useApp } from '../App'
import { api } from '../api'
import { Logo, ModeToggle } from './PublicLayout'
import { DemoBanner } from '../components'
import { VERSION_LABEL } from '../version'

const DRAWER = 264

export default function EluLayout() {
  const { user, logout, config } = useApp()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const location = useLocation()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(null)
  const [counts, setCounts] = useState({})

  // Pastilles du menu, rafraîchies à chaque changement de page : demandes à trier, votes qui attendent
  // la voix de l'élu, prêts en retard ou à remettre
  useEffect(() => {
    api('/requests/stats').then((s) => setCounts({
      demandes: s.to_triage || 0,
      votes: (s.votes_to_cast || []).length,
      prets: (s.loans_late || []).length + (s.loans_to_hand || []).length,
    })).catch(() => {})
  }, [location.pathname])

  const nav = [
    { to: '/elus', label: 'Accueil', icon: <HomeIcon />, end: true },
    { to: '/elus/demandes', label: 'Demandes', long: 'Demandes salariés', icon: <InboxIcon />, count: counts.demandes, hint: 'à trier' },
    { to: '/elus/sujets', label: 'Sujets', long: 'Sujets CSE', icon: <TopicIcon />, also: ['/elus/suivi'] },
    { to: '/elus/reunions', label: 'Réunions', long: 'Réunions et votes', icon: <EventNoteIcon />, also: ['/elus/votes'], count: counts.votes, hint: 'vote(s) à faire' },
    { to: '/elus/prets', label: 'Prêts', long: 'Prêts de matériel', icon: <InventoryIcon />, count: counts.prets, hint: 'prêt(s) à suivre' },
    ...(user.role === 'admin' ? [{ to: '/elus/comptes', label: 'Élus', long: 'Élus et réglages', icon: <GroupIcon />, adminOnly: true }] : []),
  ]
  // Sur téléphone : 5 onglets, la gestion des élus passe dans le menu du compte
  const bottomNav = nav.filter((n) => !n.adminOnly)
  const isActive = (n) => (n.end ? location.pathname === n.to
    : [n.to, ...(n.also || [])].some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`)))
  const active = nav.find(isActive)
  const badge = (n, icon) => (n.count ? <Badge badgeContent={n.count} color="error" max={99}>{icon}</Badge> : icon)

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
            {!desktop && user.role === 'admin' && <MenuItem onClick={() => { setMenu(null); navigate('/elus/comptes') }}>Élus et réglages</MenuItem>}
            <MenuItem onClick={() => { setMenu(null); navigate('/') }}>Voir l’espace salarié</MenuItem>
            <MenuItem onClick={async () => { setMenu(null); await logout(); navigate('/') }}>Se déconnecter</MenuItem>
            <Divider />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1, pb: 0.5 }}>{VERSION_LABEL}</Typography>
          </Menu>
        </Toolbar>
      </AppBar>

      {desktop && (
        <Drawer variant="permanent" sx={{ width: DRAWER, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER, boxSizing: 'border-box', borderColor: 'divider' } }}>
          <Toolbar />
          <List sx={{ px: 1, pt: 2 }}>
            {nav.map((n) => {
              const on = active?.to === n.to
              return (
                <ListItemButton key={n.to} component={NavLink} to={n.to} end={n.end} selected={on}
                  sx={{ borderRadius: 2, mb: 0.5, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
                  <ListItemIcon sx={{ minWidth: 38 }}>{n.icon}</ListItemIcon>
                  <ListItemText primary={n.long || n.label} primaryTypographyProps={{ fontWeight: on ? 700 : 400, noWrap: true }} />
                  {n.count > 0 && (
                    <Box component="span" aria-label={`${n.count} ${n.hint}`} sx={{
                      ml: 1, flexShrink: 0, minWidth: 22, height: 22, px: 0.75, borderRadius: 11, bgcolor: 'error.main', color: '#fff',
                      fontSize: '0.75rem', fontWeight: 700, display: 'grid', placeItems: 'center',
                    }}>{n.count}</Box>
                  )}
                </ListItemButton>
              )
            })}
          </List>
        </Drawer>
      )}

      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, sm: 3, md: 4 }, pt: { xs: 9, sm: 10 }, pb: { xs: 11, md: 5 } }}>
        <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
          <DemoBanner config={config} sx={{ borderRadius: 2, mb: 2 }} />
          <Outlet />
        </Box>
      </Box>

      {!desktop && (
        <Paper square sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)', zIndex: 10 }}>
          <BottomNavigation showLabels value={active && !active.adminOnly ? active.to : false} onChange={(_, v) => navigate(v)}>
            {bottomNav.map((n) => <BottomNavigationAction key={n.to} value={n.to} label={n.label} icon={badge(n, n.icon)} sx={{ minWidth: 0, px: 0.5 }} />)}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  )
}
