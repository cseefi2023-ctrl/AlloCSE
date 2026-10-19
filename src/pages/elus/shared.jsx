import { Link as RouterLink } from 'react-router-dom'
import { Box, Card, CardActionArea, Chip, Stack, Tooltip, Typography } from '@mui/material'
import LockIcon from '@mui/icons-material/LockOutlined'
import PriorityHighIcon from '@mui/icons-material/PriorityHigh'
import WarningIcon from '@mui/icons-material/WarningAmberOutlined'
import { fmtShort, periodLabel } from '../../api'
import { KindChip, StatusChip, SubjectStatusChip } from '../../components'
import { mono } from '../../theme'

// Sujet d'une demande : son numéro, « À trier » (nouvelle, sans sujet) ou « Sans sujet » (répondue directement)
export function SubjectChip({ r }) {
  if (r.subject_ref) {
    return <Chip size="small" variant="outlined" sx={{ fontFamily: mono }} label={r.subject_ref.number} />
  }
  if (r.status === 'nouvelle') return <Chip size="small" label="À trier" variant="outlined" sx={{ borderStyle: 'dashed' }} />
  return null
}

export function RequestRow({ r, extra, action }) {
  return (
    <Card>
      <Stack direction="row" alignItems="center">
        <CardActionArea component={RouterLink} to={`/elus/demandes/${r.id}`} sx={{ p: 2, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
            <SubjectChip r={r} />
            <StatusChip status={r.status} />
            <KindChip kind={r.kind} temporality={r.temporality} />
            {r.priority === 'haute' && (
              <Tooltip title="Priorité haute"><PriorityHighIcon color="error" fontSize="small" aria-label="Priorité haute" /></Tooltip>
            )}
            {!r.visible_to_all && (
              <Tooltip title="Visibilité restreinte par le demandeur"><LockIcon fontSize="small" color="action" aria-label="Visibilité restreinte" /></Tooltip>
            )}
          </Stack>
          <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{r.subject}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            <Box component="span" sx={{ fontFamily: mono }}>{r.tracking_code}</Box>
            {`, ${r.category}, ${fmtShort(r.created_at)}`}
            {r.anonymous ? ', anonyme' : r.requester_name ? `, ${r.requester_name}` : ''}
            {r.assignee ? `. Suivie par ${r.assignee.full_name}` : ''}
            {r.kind === 'signalement' && periodLabel(r) ? `. Situation ${periodLabel(r)}` : ''}
          </Typography>
          {extra}
        </CardActionArea>
        {action && <Box sx={{ px: 1.5, flexShrink: 0 }}>{action}</Box>}
      </Stack>
    </Card>
  )
}

const kindLabel = (s) => (s.kind === 'signalement'
  ? (s.temporality === 'a_venir' ? 'Alerte (à venir)' : 'Alerte (actuelle)')
  : 'Question')

export function SubjectRow({ s, extra, action }) {
  return (
    <Card>
      <Stack direction="row" alignItems="center">
        <CardActionArea component={RouterLink} to={`/elus/sujets/${s.id}`} sx={{ p: 2, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
            <Chip size="small" variant="outlined" sx={{ fontFamily: mono }} label={s.number} />
            <SubjectStatusChip status={s.status} />
            <Chip size="small" variant="outlined" label={kindLabel(s)} />
            {s.priority === 'haute' && (
              <Tooltip title="Priorité haute"><PriorityHighIcon color="error" fontSize="small" aria-label="Priorité haute" /></Tooltip>
            )}
            {!s.visible_to_all && (
              <Tooltip title="Sujet réservé à certains élus"><LockIcon fontSize="small" color="action" aria-label="Accès restreint" /></Tooltip>
            )}
            {s.commitments_late > 0 && (
              <Tooltip title="Engagement de la direction en retard"><WarningIcon color="error" fontSize="small" aria-label="Engagement en retard" /></Tooltip>
            )}
          </Stack>
          <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{s.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {s.category}
            {s.request_count > 0
              ? `, ${s.request_count} demande${s.request_count > 1 ? 's' : ''} de salarié${s.request_count > 1 ? 's' : ''}`
              : ', question des élus'}
            {s.assignee ? `. Suivi par ${s.assignee.full_name}` : ''}
            {s.next_meeting ? `. Réunion du ${fmtShort(s.next_meeting.meeting_date)}` : ''}
          </Typography>
          {extra}
        </CardActionArea>
        {action && <Box sx={{ px: 1.5, flexShrink: 0 }}>{action}</Box>}
      </Stack>
    </Card>
  )
}
