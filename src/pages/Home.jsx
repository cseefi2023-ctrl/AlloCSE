import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Card, CardActionArea, IconButton, InputBase, Stack, Tooltip, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import QuestionMarkIcon from '@mui/icons-material/QuestionMark'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import EditNoteIcon from '@mui/icons-material/EditNote'
import CloseIcon from '@mui/icons-material/Close'
import InventoryIcon from '@mui/icons-material/Inventory2Outlined'
import PriorityHighIcon from '@mui/icons-material/PriorityHigh'
import { useApp } from '../App'
import { api, myCodes, fmtDate, fmtShort, loanRequestState, STATUS } from '../api'
import { mono, palette } from '../theme'
import { tenant } from '../tenant'

export default function Home() {
  const { config } = useApp()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(myCodes.list())
  const [states, setStates] = useState({})

  // État de chaque demande déposée depuis cet appareil (lu avec son numéro de suivi)
  useEffect(() => {
    let alive = true
    for (const c of myCodes.list()) {
      // Un numéro déjà introuvable n'est plus redemandé : les numéros inconnus comptent comme
      // des tentatives erronées, limitées par la base
      if (c.gone) { setStates((s) => ({ ...s, [c.code]: TICKET.gone })); continue }
      api(`/public/requests/${encodeURIComponent(c.code)}`)
        .then((d) => { if (alive) setStates((s) => ({ ...s, [c.code]: ticketState(d) })) })
        .catch((e) => {
          if (e.status !== 404) return
          myCodes.markGone(c.code)
          if (alive) setStates((s) => ({ ...s, [c.code]: TICKET.gone }))
        })
    }
    return () => { alive = false }
  }, [])

  const track = (e) => {
    e.preventDefault()
    if (code.trim()) navigate(`/suivi/${encodeURIComponent(code.trim())}`)
  }
  const loans = config?.equipment_count > 0

  return (
    <>
      <Box sx={{ pt: { xs: 3, sm: 6 }, pb: { xs: 4, sm: 5 }, display: 'flex', gap: 4, alignItems: 'center',
        flexDirection: { xs: 'column-reverse', sm: 'row' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h1" sx={{ maxWidth: '16ch' }}>
          Une question, un souci&nbsp;? Le CSE vous répond.
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2, maxWidth: '58ch' }}>
          Écrivez à vos élus, choisissez qui peut lire votre message, puis suivez son traitement
          jusqu’à la réponse avec votre numéro de suivi.
        </Typography>
        </Box>
        {tenant.logo && (
          <Box component="img" src={tenant.logo} alt={tenant.name}
            sx={{ display: { xs: 'none', sm: 'block' }, width: 200, height: 'auto', flexShrink: 0 }} />
        )}
      </Box>

      <Box sx={{ mb: 5, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: loans ? '1fr 1fr' : '1fr' }, maxWidth: loans ? 860 : 560 }}>
        <ActionCard to="/deposer" icon={<EditNoteIcon fontSize="large" />} title="Écrire au CSE"
          text="Une question à poser ou un problème à signaler : vous choisirez à l’étape suivante." primary />
        {loans && (
          <ActionCard to="/emprunter" icon={<InventoryIcon fontSize="large" />} title="Emprunter du matériel"
            text="Le CSE prête du matériel aux salariés : choisissez-le et vos dates, les élus vous répondent." />
        )}
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
            {codes.map((c) => {
              const st = states[c.code]
              return (
                <Card key={c.code} sx={st && st.tint ? { borderColor: st.color, bgcolor: st.tint } : undefined}>
                  <Stack direction="row" alignItems="center">
                    <CardActionArea component={RouterLink} to={`/suivi/${c.code}`} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.75, justifyContent: 'flex-start' }}>
                      <Box aria-hidden sx={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                        bgcolor: st ? st.color : 'action.disabledBackground', color: '#fff',
                      }}>
                        {st ? st.icon : null}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontFamily: mono, fontWeight: 600 }}>{c.code}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {c.subject}, le {fmtDate(c.date)}
                        </Typography>
                        {st && <Typography variant="body2" sx={{ fontWeight: 700, color: st.color }}>{st.label}</Typography>}
                      </Box>
                    </CardActionArea>
                    <Tooltip title="Retirer de cette liste">
                      <IconButton aria-label={`Retirer ${c.code} de la liste`} sx={{ mx: 1 }}
                        onClick={() => { myCodes.remove(c.code); setCodes(myCodes.list()) }}>
                        <CloseIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Card>
              )
            })}
          </Stack>
        </Box>
      )}
    </>
  )
}

// Pastille de l'historique : traitée (vert ✓), question du CSE en attente (orange ?), en cours (bleu …)
const TICKET = {
  done: { color: '#2E7D5B', tint: 'rgba(46,125,91,0.13)', icon: <CheckIcon fontSize="small" /> },
  question: { color: '#C2410C', tint: 'rgba(194,65,12,0.11)', icon: <QuestionMarkIcon fontSize="small" />, label: 'Le CSE vous a posé une question' },
  late: { color: '#C2410C', tint: 'rgba(194,65,12,0.11)', icon: <PriorityHighIcon fontSize="small" /> },
  progress: { color: '#2F5FA8', icon: <MoreHorizIcon fontSize="small" /> },
  no: { color: '#5B6B82', icon: <CloseIcon fontSize="small" /> },
  gone: { color: '#8A93A3', icon: <CloseIcon fontSize="small" />, label: 'Demande introuvable (supprimée)' },
}

function ticketState(d) {
  const msgs = d.messages || []
  const last = msgs[msgs.length - 1]
  const asked = last && last.author_type === 'elu' && !last.is_answer
  const lr = d.loan_request
  if (lr) {
    // Emprunt de matériel : la réponse des élus, puis l'état du prêt
    if (asked) return TICKET.question
    const l = lr.loan
    switch (loanRequestState(lr)) {
      case 'reserve': return { ...TICKET.done, label: `Accordé : réservé du ${fmtShort(l.start_date)} au ${fmtShort(l.due_date)}` }
      case 'acceptee': return { ...TICKET.done, label: 'Demande acceptée' }
      case 'sorti': return { ...TICKET.progress, label: `À rendre le ${fmtShort(l.due_date)}` }
      case 'retard': return { ...TICKET.late, label: `Retour attendu depuis le ${fmtShort(l.due_date)}` }
      case 'rendu': return { ...TICKET.done, label: 'Matériel rendu, merci !' }
      case 'annule': return { ...TICKET.no, label: 'Réservation annulée' }
      case 'refusee': return { ...TICKET.no, label: 'Demande refusée' }
      default: return { ...TICKET.progress, label: 'En attente de la réponse du CSE' }
    }
  }
  if (d.status === 'repondue' || d.status === 'close') {
    return { ...TICKET.done, label: d.status === 'close' ? 'Traitée et clôturée' : 'Le CSE a répondu' }
  }
  if (asked) return TICKET.question
  return { ...TICKET.progress, label: STATUS[d.status]?.label || 'En cours' }
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
