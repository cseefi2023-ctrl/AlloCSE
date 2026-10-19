import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Box, CircularProgress, CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import NewPasswordDialog from './pages/elus/NewPasswordDialog'
import { auth, getMyElu, getPublicConfig, isConfigured, tenant } from './api'
import { makeTheme } from './theme'
import PublicLayout from './layouts/PublicLayout'
import EluLayout from './layouts/EluLayout'
import Home from './pages/Home'
import Submit from './pages/Submit'
import Track from './pages/Track'
import Setup, { UnknownSpace } from './pages/Setup'
import Login from './pages/elus/Login'
import Pending from './pages/elus/Pending'
import Dashboard from './pages/elus/Dashboard'
import RequestList from './pages/elus/RequestList'
import RequestDetail from './pages/elus/RequestDetail'
import Meetings from './pages/elus/Meetings'
import MeetingDetail from './pages/elus/MeetingDetail'
import Gantt from './pages/elus/Gantt'
import NewSubject from './pages/elus/NewSubject'
import SubjectList from './pages/elus/SubjectList'
import SubjectDetail from './pages/elus/SubjectDetail'
import Accounts from './pages/elus/Accounts'
import Profile from './pages/elus/Profile'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

const MODE_KEY = 'allocse.mode'

export default function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const [modePref, setModePref] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) } catch { return null }
  })
  const mode = modePref || (prefersDark ? 'dark' : 'light')
  const theme = useMemo(() => makeTheme(mode), [mode])
  const toggleMode = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    setModePref(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* ignoré */ }
  }

  const [config, setConfig] = useState(null)
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null) // fiche élu (table elus)
  const [authChecked, setAuthChecked] = useState(!isConfigured)
  const [recovery, setRecovery] = useState(false)

  const refreshConfig = useCallback(
    () => getPublicConfig().then(setConfig).catch(() => setConfig({ app_name: 'AlloCSE', categories: [], elus: [], error: true })),
    [],
  )
  const currentId = useRef(undefined)
  const loadUser = useCallback(async (s) => {
    currentId.current = s?.user?.id || null
    setSession(s)
    if (!s) { setUser(null); setAuthChecked(true); return }
    try { setUser(await getMyElu(s.user.id)) } catch { setUser(null) }
    setAuthChecked(true)
  }, [])

  useEffect(() => {
    if (!isConfigured) return undefined
    refreshConfig()
    auth.session().then(loadUser)
    return auth.onChange((s, event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      // Rafraîchissement de jeton : on garde la fiche, seul l'utilisateur qui change la recharge
      if ((s?.user?.id || null) !== currentId.current) loadUser(s)
      else setSession(s)
    })
  }, [refreshConfig, loadUser])

  const reloadUser = useCallback(async () => loadUser(await auth.session()), [loadUser])

  const ctx = {
    config, session, user, mode, toggleMode, refreshConfig,
    reloadUser,
    logout: async () => { await auth.signOut(); currentId.current = null; setSession(null); setUser(null) },
  }

  return (
    <AppContext.Provider value={ctx}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {recovery && <NewPasswordDialog onDone={() => setRecovery(false)} />}
        {!tenant.known ? <UnknownSpace /> : !isConfigured ? <Setup /> : (
          <Routes>
            <Route element={<PublicLayout />}>
              <Route index element={<Home />} />
              <Route path="deposer" element={<Submit />} />
              <Route path="suivi" element={<Track />} />
              <Route path="suivi/:code" element={<Track />} />
              <Route path="elus/connexion" element={<Login />} />
              <Route path="elus/en-attente" element={<Pending />} />
            </Route>
            <Route path="elus" element={authChecked ? <RequireElu><EluLayout /></RequireElu> : <Loading />}>
              <Route index element={<Dashboard />} />
              <Route path="demandes" element={<RequestList />} />
              <Route path="demandes/nouvelle" element={<Navigate to="/elus/sujets/nouveau" replace />} />
              <Route path="demandes/:id" element={<RequestDetail />} />
              <Route path="sujets" element={<SubjectList />} />
              <Route path="sujets/nouveau" element={<NewSubject />} />
              <Route path="sujets/:id" element={<SubjectDetail />} />
              <Route path="suivi" element={<Gantt />} />
              <Route path="reunions" element={<Meetings />} />
              <Route path="reunions/:id" element={<MeetingDetail />} />
              <Route path="comptes" element={<Accounts />} />
              <Route path="profil" element={<Profile />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </ThemeProvider>
    </AppContext.Provider>
  )
}

function Loading() {
  return <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>
}

function RequireElu({ children }) {
  const { session, user } = useApp()
  const location = useLocation()
  if (!session) return <Navigate to="/elus/connexion" replace state={{ from: location.pathname }} />
  if (!user?.is_active) return <Navigate to="/elus/en-attente" replace />
  return children
}
