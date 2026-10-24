import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Collapse, IconButton, Menu, MenuItem, Radio, RadioGroup, Snackbar, Stack, TextField, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import ShareIcon from '@mui/icons-material/Share'
import LockIcon from '@mui/icons-material/LockOutlined'
import { STATUS, STATUS_ORDER, SUBJECT_STATUS, fmtDateTime, trackingUrl } from './api'
import { mono, palette } from './theme'

export function StatusChip({ status, size = 'small' }) {
  const s = STATUS[status]
  if (!s) return null
  return (
    <Chip size={size} label={s.label}
      sx={{ bgcolor: `${s.color}1F`, color: s.color, border: `1px solid ${s.color}55` }} />
  )
}

export function SubjectStatusChip({ status, size = 'small' }) {
  const s = SUBJECT_STATUS[status]
  if (!s) return null
  return (
    <Chip size={size} label={s.label}
      sx={{ bgcolor: `${s.color}1F`, color: s.color, border: `1px solid ${s.color}55` }} />
  )
}

export function KindChip({ kind, temporality, label }) {
  if (kind !== 'signalement') return <Chip size="small" variant="outlined" label={label || 'Demande'} />
  return (
    <Chip size="small" label={label || (temporality === 'a_venir' ? 'Signalement (à venir)' : 'Signalement')}
      sx={{ bgcolor: `${palette.signal}33`, color: 'text.primary', border: `1px solid ${palette.signal}` }} />
  )
}

// Parcours d'une demande : vraie séquence, donc représentée comme un rail
// L'étape « ordre du jour » n'apparaît que si la demande y est passée :
// une réponse directe des élus ne doit pas laisser croire à un passage en réunion.
export function StatusTrack({ status, agenda = false }) {
  const steps = STATUS_ORDER.filter((s) => s !== 'close' && (s !== 'inscrite_odj' || agenda || status === 'inscrite_odj'))
  const idx = status === 'close' ? steps.length : steps.indexOf(status)
  return (
    <Box role="list" aria-label="Avancement de la demande" sx={{ display: 'flex', gap: 0.75, my: 2 }}>
      {steps.map((s, i) => {
        const done = i <= idx
        return (
          <Box key={s} role="listitem" aria-current={i === idx ? 'step' : undefined} sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ height: 8, borderRadius: 4, bgcolor: done ? (i === idx ? 'secondary.main' : 'primary.main') : 'divider' }} />
            <Typography variant="body2" sx={{
              mt: 0.75, fontSize: { xs: '0.72rem', sm: '0.85rem' }, lineHeight: 1.2,
              color: done ? 'text.primary' : 'text.secondary', fontWeight: i === idx ? 700 : 400,
            }}>
              {STATUS[s].label}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// Le « ticket » : élément signature d'AlloCSE
export function TicketCode({ code, subject, compact = false }) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true) } catch { /* presse-papiers indisponible */ }
  }
  const share = async () => {
    try { await navigator.share({ title: 'Mon numéro AlloCSE', text: `Mon numéro de suivi AlloCSE : ${code}`, url: trackingUrl(code) }) } catch { /* annulé */ }
  }
  const notch = theme.palette.background.default
  return (
    <Box sx={{
      position: 'relative', display: 'flex', alignItems: 'stretch',
      bgcolor: palette.signal, color: palette.ink, borderRadius: 3, overflow: 'hidden',
      '&::before, &::after': {
        content: '""', position: 'absolute', left: compact ? 52 : 76, width: 22, height: 22,
        borderRadius: '50%', bgcolor: notch, transform: 'translateX(-50%)',
      },
      '&::before': { top: -11 }, '&::after': { bottom: -11 },
    }}>
      <Box sx={{
        width: compact ? 52 : 76, flexShrink: 0, display: 'grid', placeItems: 'center',
        borderRight: `2px dashed ${palette.ink}55`,
      }}>
        <Typography sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 700, fontSize: compact ? 12 : 14 }}>
          AlloCSE
        </Typography>
      </Box>
      <Box sx={{ p: compact ? 1.5 : 2.5, pl: compact ? 2 : 3, flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, opacity: 0.8 }}>Numéro de suivi</Typography>
        <Typography component="p" sx={{
          fontFamily: mono, fontWeight: 600, fontSize: compact ? 'clamp(1rem, 4.6vw, 1.15rem)' : 'clamp(1.05rem, 5.2vw, 2rem)', whiteSpace: 'nowrap',
          letterSpacing: '0.02em', lineHeight: 1.2, my: 0.5,
        }}>
          {code}
        </Typography>
        {subject && <Typography variant="body2" noWrap>{subject}</Typography>}
        {!compact && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="contained" onClick={copy} startIcon={<ContentCopyIcon />}
              sx={{ bgcolor: palette.ink, color: '#fff', '&:hover': { bgcolor: '#0E1830' } }}>
              Copier
            </Button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <Button size="small" variant="outlined" onClick={share} startIcon={<ShareIcon />}
                sx={{ borderColor: palette.ink, color: palette.ink }}>
                Envoyer sur mon téléphone
              </Button>
            )}
          </Stack>
        )}
      </Box>
      {compact && (
        <Tooltip title="Copier">
          <IconButton onClick={copy} aria-label="Copier le numéro" sx={{ color: palette.ink, alignSelf: 'center', mr: 1 }}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
      )}
      <Snackbar open={copied} autoHideDuration={2000} onClose={() => setCopied(false)} message="Numéro copié" />
    </Box>
  )
}

export function Timeline({ events, showInternal = false }) {
  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {events.map((e, i) => (
        <Box component="li" key={e.id} sx={{ display: 'flex', gap: 1.5, pb: i === events.length - 1 ? 0 : 2, position: 'relative' }}>
          <Box sx={{ position: 'relative', width: 14, flexShrink: 0 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', mt: '6px',
              bgcolor: e.public ? 'primary.main' : 'transparent', border: 2, borderColor: 'primary.main' }} />
            {i < events.length - 1 && (
              <Box sx={{ position: 'absolute', left: 5, top: 20, bottom: -14, width: 2, bgcolor: 'divider' }} />
            )}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {e.label}
              {showInternal && !e.public && (
                <Tooltip title="Invisible pour le salarié"><LockIcon sx={{ fontSize: 15, ml: 0.5, verticalAlign: '-2px', color: 'text.secondary' }} /></Tooltip>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {fmtDateTime(e.created_at)}{e.user ? ` — ${e.user.full_name}` : ''}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export function MessageList({ messages, viewer = 'salarie' }) {
  if (!messages.length) {
    return <Typography color="text.secondary">Aucun échange pour l’instant.</Typography>
  }
  return (
    <Stack spacing={1.5}>
      {messages.map((m) => {
        const fromEmployee = m.author_type === 'salarie'
        const mine = viewer === m.author_type
        return (
          <Box key={m.id} sx={{
            alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: { xs: '100%', sm: '85%' },
            p: 1.75, borderRadius: 3,
            bgcolor: m.internal ? 'action.hover' : m.is_answer ? `${palette.ok}14` : fromEmployee ? 'background.default' : 'background.paper',
            border: 1,
            borderColor: m.is_answer ? `${palette.ok}66` : m.internal ? 'transparent' : 'divider',
            borderStyle: m.internal ? 'dashed' : 'solid',
          }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5, color: m.is_answer ? 'success.main' : 'text.secondary' }}>
              {m.internal ? 'Note interne aux élus' : m.is_answer ? 'Réponse du CSE' : fromEmployee ? 'Salarié' : 'Message du CSE'}
              {m.author ? ` — ${m.author.full_name}` : ''}, {fmtDateTime(m.created_at)}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</Typography>
          </Box>
        )
      })}
    </Stack>
  )
}

export function ErrorAlert({ error, onClose }) {
  if (!error) return null
  return <Alert severity="error" onClose={onClose} sx={{ my: 2 }}>{error}</Alert>
}

export function Section({ title, action, children, sx }) {
  return (
    <Box component="section" sx={{ mb: 4, ...sx }}>
      {(title || action) && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, gap: 1 }}>
          {title && <Typography variant="h3" component="h2">{title}</Typography>}
          {action}
        </Stack>
      )}
      {children}
    </Box>
  )
}

// Téléphone : les formulaires longs s'ouvrent en plein écran
export const useNarrow = () => useMediaQuery((t) => t.breakpoints.down('sm'))

// Bloc repliable (historique, réglages secondaires) : fermé par défaut pour alléger l'écran
export function Fold({ title, children, defaultOpen = false, sx }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box component="section" sx={{ mb: 3, ...sx }}>
      <Button onClick={() => setOpen(!open)} aria-expanded={open}
        endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />}
        sx={{ ml: -1, px: 1, color: 'text.primary', fontWeight: 700, fontSize: '1rem', textTransform: 'none' }}>
        {title}
      </Button>
      <Collapse in={open} unmountOnExit><Box sx={{ pt: 1 }}>{children}</Box></Collapse>
    </Box>
  )
}

// Menu « ⋮ » des actions rares (fusionner, supprimer, imprimer…)
export function MoreMenu({ items, label = 'Autres actions' }) {
  const [anchor, setAnchor] = useState(null)
  const shown = items.filter(Boolean)
  if (!shown.length) return null
  return (
    <>
      <Tooltip title={label}>
        <IconButton aria-label={label} onClick={(e) => setAnchor(e.currentTarget)}><MoreVertIcon /></IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {shown.map((it) => (
          <MenuItem key={it.label} disabled={it.disabled} onClick={() => { setAnchor(null); it.onClick() }}
            sx={it.danger ? { color: 'error.main' } : undefined}>
            {it.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

// Demande ou signalement : un choix explicite, expliqué avec des exemples concrets
const KIND_CHOICES = [
  {
    value: 'demande',
    title: 'Une demande',
    text: 'Vous posez une question au CSE ou vous lui demandez quelque chose.',
    examples: ['Quand arrivent les chèques cadeaux cette année ?', 'Peut-on avoir une réduction pour le cinéma ?'],
  },
  {
    value: 'signalement',
    title: 'Un signalement',
    text: 'Vous informez le CSE d’un problème ou d’une situation anormale dans l’entreprise, qui existe déjà ou qui se prépare, pour qu’il puisse intervenir.',
    examples: ['La fontaine à eau est balisée depuis des jours.',
      'La direction a demandé de venir travailler le week-end sans prévenir le CSE.'],
  },
]

// Questions des élus : elles s'adressent à la direction
const KIND_CHOICES_ELUS = [
  {
    value: 'demande',
    title: 'Une question',
    text: 'Le CSE demande une information ou une explication à la direction.',
    examples: ['Quel est le calendrier des NAO 2027 ?', 'Combien d’intérimaires sur le site ce trimestre, et sur quels postes ?'],
  },
  {
    value: 'signalement',
    title: 'Une alerte',
    text: 'Le CSE porte à la connaissance de la direction une situation anormale, actuelle ou à venir, et demande des mesures.',
    examples: ['Températures excessives à l’atelier montage depuis le début de l’été.',
      'Travail du samedi organisé sans consultation du CSE.'],
  },
]

export function KindChoice({ value, onChange, audience }) {
  const choices = audience === 'elus' ? KIND_CHOICES_ELUS : KIND_CHOICES
  return (
    <RadioGroup value={value} onChange={(e) => onChange(e.target.value)} aria-label="Type de message"
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mb: 2 }}>
      {choices.map((c) => {
        const on = value === c.value
        return (
          <Box key={c.value} component="label" sx={{
            display: 'flex', gap: 1, p: 2, pl: 1, borderRadius: 3, cursor: 'pointer', bgcolor: 'background.paper',
            border: 2, borderColor: on ? 'primary.main' : 'divider',
            '&:hover': { borderColor: on ? 'primary.main' : 'text.secondary' },
          }}>
            <Radio value={c.value} sx={{ alignSelf: 'flex-start', mt: -0.75 }} />
            <Box>
              <Typography variant="h4" component="span" sx={{ display: 'block', mb: 0.5 }}>{c.title}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>{c.text}</Typography>
              <Typography variant="body2" color="text.secondary" component="div">
                Par exemple :
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {c.examples.map((ex) => <li key={ex}>« {ex} »</li>)}
                </Box>
              </Typography>
            </Box>
          </Box>
        )
      })}
    </RadioGroup>
  )
}


// Engagement de la direction : en attente, en retard, tenu, non tenu
export const COMMITMENT_STATUS = {
  en_attente: { label: 'En attente', color: '#9A6A00' },
  late: { label: 'Délai dépassé', color: '#C8402E' },
  tenu: { label: 'Tenu', color: '#2E7D5B' },
  non_tenu: { label: 'Non tenu', color: '#C8402E' },
}
export function CommitmentChip({ c }) {
  const s = COMMITMENT_STATUS[c.late ? 'late' : c.status]
  return <Chip size="small" label={s.label} sx={{ bgcolor: `${s.color}1F`, color: s.color, border: `1px solid ${s.color}55` }} />
}

// Bandeau de l'espace de démonstration
export function DemoBanner({ config, sx }) {
  if (!(config?.demo)) return null
  return (
    <Box role="note" sx={{ bgcolor: palette.signal, color: palette.ink, px: 2, py: 0.75, textAlign: 'center', fontSize: '0.9rem', ...sx }}>
      <strong>Démonstration</strong> : toutes les données sont fictives et remises à zéro chaque nuit.
    </Box>
  )
}

// Champ date enregistré seulement quand la date est complète (ou vidée) : on peut taper la date
// chiffre par chiffre ou la choisir dans le calendrier sans qu'elle soit effacée en cours de saisie
export function DateField({ value, onCommit, label, helperText, min, size = 'small', sx }) {
  const [v, setV] = useState(value || '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setV(value || '') }, [value, focused])
  const commit = (next) => {
    if ((next || null) === (value || null)) return
    if (next === '' || /^\d{4}-\d{2}-\d{2}$/.test(next)) onCommit(next || null)
  }
  return (
    <TextField type="date" size={size} label={label} value={v} helperText={helperText} sx={sx}
      InputLabelProps={{ shrink: true }} inputProps={{ min: min || undefined }}
      onFocus={() => setFocused(true)}
      onChange={(e) => { setV(e.target.value); if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) commit(e.target.value) }}
      onBlur={(e) => { setFocused(false); commit(e.target.value) }} />
  )
}
