import { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Card, CardActionArea, IconButton, InputBase, Stack, Tooltip, Typography } from '@mui/material'
import EditNoteIcon from '@mui/icons-material/EditNote'
import CloseIcon from '@mui/icons-material/Close'
import { myCodes, fmtDate } from '../api'
import { mono, palette } from '../theme'

export default function Home() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(myCodes.list())

  const track = (e) => {
    e.preventDefault()
    if (code.trim()) navigate(`/suivi/${encodeURIComponent(code.trim())}`)
  }

  return (
    <>
      <Box sx={{ pt: { xs: 3, sm: 6 }, pb: { xs: 4, sm: 5 } }}>
        <Typography variant="h1" sx={{ maxWidth: '16ch' }}>
          Une question, un souci&nbsp;? Le CSE vous répond.
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2, maxWidth: '58ch' }}>
          Écrivez à vos élus, choisissez qui peut lire votre message, puis suivez son traitement
          jusqu’à la réponse avec votre numéro de suivi.
        </Typography>
      </Box>

      <Box sx={{ mb: 5, maxWidth: 560 }}>
        <ActionCard to="/deposer" icon={<EditNoteIcon fontSize="large" />} title="Écrire au CSE"
          text="Une question à poser ou un problème à signaler : vous choisirez à l’étape suivante." primary />
      </Box>

      <Box component="section" aria-labelledby="suivi-titre" sx={{ mb: 5 }}>
        <Typography id="suivi-titre" variant="h3" component="h2" sx={{ mb: 1.5 }}>Suivre ma demande</Typography>
        <Box component="form" onSubmit={track} sx={{
          display: 'flex', alignItems: 'center', gap: 1, p: 1, pl: 2.5,
          bgcolor: palette.signal, borderRadius: 999, maxWidth: 560,
        }}>
          <InputBase value={code} onChange={(e) => setCode(e.target.value)} placeholder="AC-2026-XXXX-XXXX"
            inputProps={{ 'aria-label': 'Numéro de suivi', autoCapitalize: 'characters', spellCheck: false }}
            sx={{ flex: 1, fontFamily: mono, fontWeight: 600, fontSize: '1.15rem', color: palette.ink,
              '& input::placeholder': { color: palette.ink, opacity: 0.45 } }} />
          <Button type="submit" variant="contained" sx={{ bgcolor: palette.ink, color: '#fff', '&:hover': { bgcolor: '#0E1830' } }}>
            Suivre
          </Button>
        </Box>
      </Box>

      {codes.length > 0 && (
        <Box component="section" aria-labelledby="mes-titre">
          <Typography id="mes-titre" variant="h3" component="h2" sx={{ mb: 0.5 }}>Déposées depuis cet appareil</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Mémorisées uniquement sur ce téléphone ou cet ordinateur.
          </Typography>
          <Stack spacing={1}>
            {codes.map((c) => (
              <Card key={c.code}>
                <Stack direction="row" alignItems="center">
                  <CardActionArea component={RouterLink} to={`/suivi/${c.code}`} sx={{ p: 2 }}>
                    <Typography sx={{ fontFamily: mono, fontWeight: 600 }}>{c.code}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {c.subject}, le {fmtDate(c.date)}
                    </Typography>
                  </CardActionArea>
                  <Tooltip title="Retirer de cette liste">
                    <IconButton aria-label={`Retirer ${c.code} de la liste`} sx={{ mx: 1 }}
                      onClick={() => { myCodes.remove(c.code); setCodes(myCodes.list()) }}>
                      <CloseIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Card>
            ))}
          </Stack>
        </Box>
      )}
    </>
  )
}

function ActionCard({ to, icon, title, text, primary }) {
  return (
    <Card sx={{ height: '100%', ...(primary && { bgcolor: 'primary.main', color: 'primary.contrastText', borderColor: 'primary.main' }) }}>
      <CardActionArea component={RouterLink} to={to} sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ color: primary ? 'secondary.main' : 'primary.main' }}>{icon}</Box>
        <Typography variant="h3" component="span">{title}</Typography>
        <Typography variant="body2" sx={{ opacity: primary ? 0.85 : 1, color: primary ? 'inherit' : 'text.secondary' }}>{text}</Typography>
      </CardActionArea>
    </Card>
  )
}
