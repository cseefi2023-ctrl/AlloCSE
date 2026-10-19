import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Card, CardActionArea, Chip, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { api, fmtDate, MEETING_KINDS } from '../../api'
import { ErrorAlert, Section } from '../../components'
import PreparationPanel, { PlanDialog } from './Preparation'

const MEETING_STATUS = { planifiee: 'Planifiée', tenue: 'Tenue', annulee: 'Annulée' }

export default function Meetings() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => { api('/meetings').then(setRows).catch((e) => setError(e.message)) }, [])

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = rows?.filter((m) => m.status === 'planifiee' && m.meeting_date >= today).reverse() || []
  const past = rows?.filter((m) => !upcoming.includes(m)) || []

  const list = (items) => (
    <Stack spacing={1}>
      {items.map((m) => (
        <Card key={m.id}>
          <CardActionArea component={RouterLink} to={`/elus/reunions/${m.id}`} sx={{ p: 2, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }}>{m.title}</Typography>
              <Typography variant="body2" color="text.secondary">{MEETING_KINDS[m.kind]}, {fmtDate(m.meeting_date)}, {m.item_count} point(s)</Typography>
            </Box>
            <Chip size="small" label={MEETING_STATUS[m.status]} variant="outlined" />
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  )

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3, gap: 1 }}>
        <Typography variant="h2" component="h1">Réunions</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Planifier</Button>
      </Stack>
      <ErrorAlert error={error} />
      <PreparationPanel />
      <Section title="À venir">
        {upcoming.length ? list(upcoming) : <Typography color="text.secondary">Aucune réunion planifiée. Planifiez la prochaine pour préparer son ordre du jour.</Typography>}
      </Section>
      {past.length > 0 && <Section title="Passées">{list(past)}</Section>}

      <PlanDialog open={open} initial={{ kind: 'ordinaire', title: 'CSE ordinaire', meeting_date: '' }} onClose={() => setOpen(false)} />
    </>
  )
}
