import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Card, CardActionArea, Chip, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { api, fmtDay, MEETING_KINDS, todayIso } from '../../api'
import { ErrorAlert, Section } from '../../components'
import { PlanDialog, suggestionsOf } from './Preparation'
import { MeetingsHeader } from './shared'

const MEETING_STATUS = { planifiee: 'Planifiée', tenue: 'Tenue', annulee: 'Annulée' }
const PAST_SHOWN = 3

export default function Meetings() {
  const [rows, setRows] = useState(null)
  const [prep, setPrep] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [allPast, setAllPast] = useState(false)

  useEffect(() => {
    api('/meetings').then(setRows).catch((e) => setError(e.message))
    api('/meetings/preparation').then(setPrep).catch(() => {})
  }, [])
  const suggestions = useMemo(() => suggestionsOf(prep), [prep])

  const today = todayIso()
  const upcoming = rows?.filter((m) => m.status === 'planifiee' && m.meeting_date >= today).reverse() || []
  const past = rows?.filter((m) => !upcoming.includes(m)) || []

  const list = (items, withStatus) => (
    <Stack spacing={1}>
      {items.map((m) => (
        <Card key={m.id}>
          <CardActionArea component={RouterLink} to={`/elus/reunions/${m.id}`} sx={{ p: 2, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }}>{m.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ '&::first-letter': { textTransform: 'uppercase' } }}>
                {fmtDay(m.meeting_date)} · {MEETING_KINDS[m.kind]} · {m.item_count ? `${m.item_count} point${m.item_count > 1 ? 's' : ''}` : 'ordre du jour vide'}
              </Typography>
            </Box>
            {withStatus && <Chip size="small" label={MEETING_STATUS[m.status]} variant="outlined" />}
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  )

  return (
    <Box sx={{ maxWidth: 860 }}>
      <MeetingsHeader action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Planifier</Button>} />
      <ErrorAlert error={error} />
      {rows && (
        <Section title="À venir">
          {upcoming.length ? list(upcoming, false) : (
            <Card sx={{ p: 2.5 }}>
              <Typography>Aucune réunion planifiée.</Typography>
              {suggestions.ordinaire && (
                <Typography variant="body2" color="text.secondary">Prochaine plénière proposée : {fmtDay(suggestions.ordinaire.meeting_date)}</Typography>
              )}
            </Card>
          )}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Passées">
          {list(allPast ? past : past.slice(0, PAST_SHOWN), true)}
          {past.length > PAST_SHOWN && !allPast && (
            <Button onClick={() => setAllPast(true)} sx={{ mt: 1 }}>Voir les {past.length} réunions passées</Button>
          )}
        </Section>
      )}
      <PlanDialog open={open} suggestions={suggestions} onClose={() => setOpen(false)} />
    </Box>
  )
}
