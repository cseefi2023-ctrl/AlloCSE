import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Button, Card, CardActionArea, Grid, Stack, Typography } from '@mui/material'
import { useApp } from '../../App'
import { api, SUBJECT_STATUS } from '../../api'
import { ErrorAlert, Section } from '../../components'
import { RequestRow, SubjectRow } from './shared'
import PreparationPanel from './Preparation'

export default function Dashboard() {
  const { user } = useApp()
  const [stats, setStats] = useState(null)
  const [fresh, setFresh] = useState([])
  const [mine, setMine] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      api('/requests/stats'),
      api('/requests', { query: { to_triage: true } }),
      api('/subjects', { query: { mine: true, open_only: true } }),
    ]).then(([s, f, m]) => { setStats(s); setFresh(f.slice(0, 5)); setMine(m.slice(0, 6)) })
      .catch((e) => setError(e.message))
  }, [])

  const tiles = stats ? [
    { n: stats.to_triage, label: 'Demandes à trier', to: '/elus/demandes?tri=1', color: '#5B6B82' },
    ...['ouvert', 'inscrit_odj', 'repondu'].map((st) => ({
      n: stats.subjects_by_status[st], label: `Sujets : ${SUBJECT_STATUS[st].label.toLowerCase()}`,
      to: `/elus/sujets?status=${st}`, color: SUBJECT_STATUS[st].color,
    })),
  ] : []
  return (
    <>
      <Typography variant="h2" component="h1" sx={{ mb: 3 }}>Bonjour {user.full_name.split(' ')[0]}</Typography>
      <ErrorAlert error={error} />
      {stats?.commitments_late > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}
          action={<Button color="inherit" size="small" component={RouterLink} to="/elus/suivi">Voir le suivi</Button>}>
          {stats.commitments_late > 1
            ? `${stats.commitments_late} engagements de la direction ont dépassé leur délai.`
            : 'Un engagement de la direction a dépassé son délai.'}
        </Alert>
      )}
      {stats && (
        <Grid container spacing={1.5} sx={{ mb: 4 }}>
          {tiles.map((t) => (
            <Grid item xs={6} md={3} key={t.label}>
              <Card sx={{ height: '100%' }}>
                <CardActionArea component={RouterLink} to={t.to} sx={{ p: 2, height: '100%' }}>
                  <Typography sx={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1, color: t.color }}>{t.n}</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>{t.label}</Typography>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <PreparationPanel />
      <Section title="Demandes à trier" action={<Button component={RouterLink} to="/elus/demandes?tri=1" size="small">Tout voir</Button>}>
        {fresh.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Pour chacune : répondre directement, créer un sujet, ou la rattacher à un sujet existant.
          </Typography>
        )}
        {fresh.length === 0 ? <Typography color="text.secondary">Rien à trier.</Typography>
          : <Stack spacing={1}>{fresh.map((r) => <RequestRow key={r.id} r={r} />)}</Stack>}
      </Section>
      <Section title="Mes sujets" action={<Button component={RouterLink} to="/elus/sujets/nouveau" size="small">Nouveau sujet</Button>}>
        {mine.length === 0 ? <Typography color="text.secondary">Vous ne suivez aucun sujet en cours.</Typography>
          : <Stack spacing={1}>{mine.map((s) => <SubjectRow key={s.id} s={s} />)}</Stack>}
      </Section>
    </>
  )
}
