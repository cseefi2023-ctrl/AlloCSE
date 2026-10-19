import { Link as RouterLink } from 'react-router-dom'
import { Box, Card, CardActionArea, Chip, Stack, Tooltip, Typography } from '@mui/material'
import LockIcon from '@mui/icons-material/LockOutlined'
import PriorityHighIcon from '@mui/icons-material/PriorityHigh'
import { fmtShort, periodLabel } from '../../api'
import { KindChip, StatusChip } from '../../components'
import { mono } from '../../theme'

// Numéro de sujet (attribué au tri) ou « À trier »
export function SubjectChip({ r }) {
  if (!r.number) return <Chip size="small" label="À trier" variant="outlined" sx={{ borderStyle: 'dashed' }} />
  return (
    <Chip size="small" variant="outlined" sx={{ fontFamily: mono }}
      label={r.parent_id ? `${r.number} (associée)` : r.linked_count ? `${r.number} +${r.linked_count}` : r.number} />
  )
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
            {r.origin === 'elu' && <Chip size="small" variant="outlined" label="Saisie par un élu" />}
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
