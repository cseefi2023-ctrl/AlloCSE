import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box, Button, Card, CircularProgress, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography,
} from '@mui/material'
import InboxIcon from '@mui/icons-material/InboxOutlined'
import WarningIcon from '@mui/icons-material/WarningAmberOutlined'
import PersonAddIcon from '@mui/icons-material/PersonAddAltOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline'
import HowToVoteIcon from '@mui/icons-material/HowToVoteOutlined'
import InventoryIcon from '@mui/icons-material/Inventory2Outlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useApp } from '../../App'
import { api, fmtDay, fmtShort, listElus, MEETING_KINDS } from '../../api'
import { ErrorAlert, Section } from '../../components'
import { nextMeetingOf, PlanDialog, suggestionsOf } from './Preparation'
import { deadlineLabel } from './Votes'

const MAX_ROWS = 5
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`

// Accueil des élus : seulement ce qui demande une action, et la prochaine réunion
export default function Dashboard() {
  const { user } = useApp()
  const [stats, setStats] = useState(null)
  const [todo, setTodo] = useState([])
  const [prep, setPrep] = useState(null)
  const [pendingElus, setPendingElus] = useState(0)
  const [plan, setPlan] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([api('/requests/stats'), api('/requests', { query: { to_triage: true } }), api('/meetings/preparation')])
      .then(([s, t, p]) => { setStats(s); setTodo(t); setPrep(p) })
      .catch((e) => setError(e.message))
    if (user.role === 'admin') {
      listElus().then((rows) => setPendingElus(rows.filter((u) => !u.is_active && !u.validated_at).length)).catch(() => {})
    }
  }, [user.role])

  const suggestions = useMemo(() => suggestionsOf(prep), [prep])
  if (!stats) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const late = stats.commitments_late || 0
  const toCast = stats.votes_to_cast || []
  const toRecord = stats.votes_to_record || []
  const loansLate = stats.loans_late || []
  const toHand = stats.loans_to_hand || []
  const next = nextMeetingOf(prep)
  const idea = suggestions.ordinaire
  const nothing = todo.length === 0 && !late && !pendingElus && !toCast.length && !toRecord.length && !loansLate.length && !toHand.length
  const thing = (l) => `${l.equipment}${l.quantity > 1 ? ` (× ${l.quantity})` : ''}`

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 3 }}>Bonjour {user.full_name.split(' ')[0]}</Typography>

      <Section title="À faire">
        <Card>
          {nothing ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2.5 }}>
              <CheckCircleIcon color="success" />
              <Typography>Rien à traiter pour l’instant.</Typography>
            </Stack>
          ) : (
            <List disablePadding>
              {todo.slice(0, MAX_ROWS).map((r) => (
                <TodoRow key={r.id} to={`/elus/demandes/${r.id}`} icon={<InboxIcon />} primary={r.subject}
                  secondary={[r.kind === 'signalement' ? 'Signalement à trier' : 'Demande à trier', fmtShort(r.created_at),
                    r.anonymous ? 'anonyme' : r.requester_name].filter(Boolean).join(' · ')} />
              ))}
              {todo.length > MAX_ROWS && (
                <TodoRow to="/elus/demandes?vue=tri" icon={<Box sx={{ width: 24 }} />} primary={`Voir les ${todo.length} demandes à trier`} />
              )}
              {toCast.map((v) => (
                <TodoRow key={`v${v.id}`} to={`/elus/votes/${v.id}`} icon={<HowToVoteIcon color="primary" />} primary={v.title}
                  secondary={['Vote en ligne : à vous de voter', deadlineLabel(v.deadline)].filter(Boolean).join(' · ')} />
              ))}
              {toRecord.map((v) => (
                <TodoRow key={`r${v.id}`} to={`/elus/votes/${v.id}`} icon={<HowToVoteIcon />} primary={v.title}
                  secondary={`Résultat du vote à noter · ${v.meeting_title}, ${fmtShort(v.meeting_date)}`} />
              ))}
              {loansLate.map((l) => (
                <TodoRow key={`l${l.id}`} to="/elus/prets" icon={<InventoryIcon color="error" />} primary={`${thing(l)} : retour en retard`}
                  secondary={`${l.borrower_name} · retour prévu le ${fmtShort(l.due_date)}`} />
              ))}
              {toHand.map((l) => (
                <TodoRow key={`h${l.id}`} to="/elus/prets" icon={<InventoryIcon />} primary={`${thing(l)} : à remettre`}
                  secondary={`${l.borrower_name} · réservé à partir du ${fmtShort(l.start_date)}`} />
              ))}
              {late > 0 && (
                <TodoRow to="/elus/suivi" icon={<WarningIcon color="error" />}
                  primary={late > 1 ? `${late} engagements de la direction ont dépassé leur délai` : 'Un engagement de la direction a dépassé son délai'} />
              )}
              {pendingElus > 0 && (
                <TodoRow to="/elus/comptes" icon={<PersonAddIcon />}
                  primary={pendingElus > 1 ? `${pendingElus} élus attendent la validation de leur compte` : 'Un élu attend la validation de son compte'} />
              )}
            </List>
          )}
        </Card>
      </Section>

      <Section title="Prochaine réunion">
        <Card sx={{ p: 2.5 }}>
          {next ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h4" component="p">{next.title}</Typography>
                <Typography color="text.secondary" sx={{ '&::first-letter': { textTransform: 'uppercase' } }}>
                  {fmtDay(next.meeting_date)}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {MEETING_KINDS[next.kind]}, {next.item_count ? plural(next.item_count, 'point', 'points') : 'ordre du jour vide'}
                  {prep.pending > 0 && ` · ${plural(prep.pending, 'sujet', 'sujets')} en attente d’inscription`}
                </Typography>
              </Box>
              <Button variant="contained" component={RouterLink} to={`/elus/reunions/${next.id}`} sx={{ flexShrink: 0 }}>
                {next.item_count ? 'Voir l’ordre du jour' : 'Préparer l’ordre du jour'}
              </Button>
            </Stack>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Box sx={{ flex: 1 }}>
                <Typography>Aucune réunion planifiée.</Typography>
                {idea && <Typography variant="body2" color="text.secondary">Proposition : {fmtDay(idea.meeting_date)}</Typography>}
              </Box>
              <Button variant="contained" onClick={() => setPlan(true)} sx={{ flexShrink: 0 }}>Planifier la réunion</Button>
            </Stack>
          )}
        </Card>
      </Section>
      <PlanDialog open={plan} suggestions={suggestions} onClose={() => setPlan(false)} />
    </Box>
  )
}

function TodoRow({ to, icon, primary, secondary }) {
  return (
    <ListItemButton component={RouterLink} to={to} divider sx={{ py: 1.25, '&:last-of-type': { borderBottom: 0 } }}>
      {icon && <ListItemIcon sx={{ minWidth: 40 }}>{icon}</ListItemIcon>}
      <ListItemText primary={primary} secondary={secondary}
        primaryTypographyProps={{ fontWeight: 700, sx: { overflowWrap: 'anywhere' } }} sx={{ my: 0 }} />
      <ChevronRightIcon color="action" />
    </ListItemButton>
  )
}
