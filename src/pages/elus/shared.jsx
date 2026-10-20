import { Link as RouterLink, useLocation } from 'react-router-dom'
import { Box, Button, Card, CardActionArea, Chip, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import LockIcon from '@mui/icons-material/LockOutlined'
import PriorityHighIcon from '@mui/icons-material/PriorityHigh'
import WarningIcon from '@mui/icons-material/WarningAmberOutlined'
import { fmtShort } from '../../api'
import { KindChip, StatusChip, SubjectStatusChip } from '../../components'

// Une demande est « à trier » tant qu'elle n'a ni sujet ni réponse
export const isToTriage = (r) => !r.subject_ref && (r.status === 'nouvelle' || r.status === 'en_cours')

export function TriageChip() {
  return <Chip size="small" label="À trier" variant="outlined" sx={{ borderStyle: 'dashed', fontWeight: 700 }} />
}

// Pastilles d'une demande : « À trier » ou son statut, puis « Signalement » s'il y a lieu
export function RequestChips({ r }) {
  const triage = isToTriage(r)
  return (
    <>
      {triage && <TriageChip />}
      {(!triage || r.status !== 'nouvelle') && <StatusChip status={r.status} />}
      {r.kind === 'signalement' && <KindChip kind={r.kind} temporality={r.temporality} />}
      {r.priority === 'haute' && (
        <Tooltip title="Priorité haute"><PriorityHighIcon color="error" fontSize="small" aria-label="Priorité haute" /></Tooltip>
      )}
      {!r.visible_to_all && (
        <Tooltip title="Visibilité restreinte par le salarié"><LockIcon fontSize="small" color="action" aria-label="Visibilité restreinte" /></Tooltip>
      )}
    </>
  )
}

const join = (parts) => parts.filter(Boolean).join(' · ')

export function RequestRow({ r, action, showSubject = true }) {
  return (
    <Card>
      <Stack direction="row" alignItems="center">
        <CardActionArea component={RouterLink} to={`/elus/demandes/${r.id}`} sx={{ p: 2, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
            <RequestChips r={r} />
          </Stack>
          <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{r.subject}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {join([fmtShort(r.created_at), r.anonymous ? 'anonyme' : r.requester_name, r.category,
              showSubject && r.subject_ref ? `sujet ${r.subject_ref.number}` : null])}
          </Typography>
        </CardActionArea>
        {action && <Box sx={{ px: 1.5, flexShrink: 0 }}>{action}</Box>}
      </Stack>
    </Card>
  )
}

export const subjectKindLabel = (s) => (s.kind === 'signalement'
  ? (s.temporality === 'a_venir' ? 'Alerte (à venir)' : 'Alerte')
  : null)

export function SubjectChips({ s }) {
  const kind = subjectKindLabel(s)
  return (
    <>
      <SubjectStatusChip status={s.status} />
      {kind && <KindChip kind="signalement" temporality={s.temporality} label={kind} />}
      {s.priority === 'haute' && (
        <Tooltip title="Priorité haute"><PriorityHighIcon color="error" fontSize="small" aria-label="Priorité haute" /></Tooltip>
      )}
      {!s.visible_to_all && (
        <Tooltip title="Sujet réservé à certains élus"><LockIcon fontSize="small" color="action" aria-label="Accès restreint" /></Tooltip>
      )}
      {s.commitments_late > 0 && (
        <Tooltip title="Engagement de la direction en retard"><WarningIcon color="error" fontSize="small" aria-label="Engagement en retard" /></Tooltip>
      )}
    </>
  )
}

export function SubjectRow({ s, extra, action }) {
  return (
    <Card>
      <Stack direction="row" alignItems="center">
        <CardActionArea component={RouterLink} to={`/elus/sujets/${s.id}`} sx={{ p: 2, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
            <SubjectChips s={s} />
          </Stack>
          <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{s.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {join([s.number, s.category,
              s.request_count > 0 ? `${s.request_count} demande${s.request_count > 1 ? 's' : ''} de salarié${s.request_count > 1 ? 's' : ''}` : 'question des élus',
              s.next_meeting ? `réunion du ${fmtShort(s.next_meeting.meeting_date)}` : null])}
          </Typography>
          {extra}
        </CardActionArea>
        {action && <Box sx={{ px: 1.5, flexShrink: 0 }}>{action}</Box>}
      </Stack>
    </Card>
  )
}

// En-tête commun à la liste des sujets et à leur suivi dans le temps
export function SubjectsHeader() {
  const { pathname } = useLocation()
  const view = pathname.startsWith('/elus/suivi') ? 'suivi' : 'liste'
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, gap: 1 }}>
        <Typography variant="h2" component="h1">Sujets du CSE</Typography>
        <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/elus/sujets/nouveau" aria-label="Nouveau sujet" sx={{ flexShrink: 0 }}>
          Nouveau<Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>&nbsp;sujet</Box>
        </Button>
      </Stack>
      <ToggleButtonGroup size="small" exclusive value={view} aria-label="Affichage des sujets">
        <ToggleButton value="liste" component={RouterLink} to="/elus/sujets" sx={{ px: 2 }}>Liste</ToggleButton>
        <ToggleButton value="suivi" component={RouterLink} to="/elus/suivi" sx={{ px: 2 }}>Suivi dans le temps</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}

// Filtres en pastilles : un seul choix actif à la fois
export function FilterChips({ value, options, onChange }) {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }} role="group" aria-label="Filtre">
      {options.map((o) => {
        const on = value === o.value
        return (
          <Chip key={o.value} label={o.count != null ? `${o.label} (${o.count})` : o.label}
            variant={on ? 'filled' : 'outlined'} color={on ? 'primary' : 'default'}
            aria-pressed={on} onClick={() => onChange(o.value)} />
        )
      })}
    </Stack>
  )
}
