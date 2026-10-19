// Récurrence d'un point libre de l'ordre du jour : unique, ou répété selon une règle.
import { Box, Button, Chip, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { fmtDate } from '../../api'

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const QUARTERLY = [3, 6, 9, 12]
const EVERY = [1, 2, 3, 4, 6]

export const SINGLE = { recurring: false, every: 1, months: [], end_date: '' }

// État du formulaire à partir d'un point de l'ordre du jour
export const fromItem = (it) => (it.recurring
  ? { recurring: true, every: it.recurrence?.every || 1, months: it.recurrence?.months || [], end_date: it.recurrence?.end_date || '' }
  : SINGLE)

// Règle envoyée à l'API (null pour un point unique)
export const toRule = (r) => (r.recurring ? { every: r.every, months: r.months, end_date: r.end_date || null } : null)

export function recurrenceLabel(rule) {
  if (!rule) return ''
  const parts = [rule.every > 1 ? `1 réunion sur ${rule.every}` : 'Chaque réunion']
  const months = [...(rule.months || [])].sort((a, b) => a - b)
  if (months.join() === QUARTERLY.join()) parts.push('trimestriel (mars, juin, sept., déc.)')
  else if (months.length) parts.push(`en ${months.map((mo) => MONTHS[mo - 1]).join(', ')}`)
  if (rule.end_date) parts.push(`jusqu’au ${fmtDate(rule.end_date)}`)
  return parts.join(', ')
}

export function RecurrenceFields({ value, onChange, kindLabel, disabled }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const toggleMonth = (mo) => set({ months: value.months.includes(mo) ? value.months.filter((x) => x !== mo) : [...value.months, mo].sort((a, b) => a - b) })
  return (
    <Box>
      <ToggleButtonGroup exclusive size="small" color="primary" value={value.recurring ? 'rec' : 'single'} disabled={disabled}
        onChange={(_, v) => v && set({ recurring: v === 'rec' })} aria-label="Répétition du point">
        <ToggleButton value="single" sx={{ textTransform: 'none', px: 2 }}>Unique</ToggleButton>
        <ToggleButton value="rec" sx={{ textTransform: 'none', px: 2 }}>Récurrent</ToggleButton>
      </ToggleButtonGroup>
      {value.recurring && (
        <Box sx={{ mt: 1.5, pl: 1.5, borderLeft: 3, borderColor: 'primary.light' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField select size="small" label="Fréquence" value={value.every} disabled={disabled}
              onChange={(e) => set({ every: Number(e.target.value) })}>
              {EVERY.map((n) => <MenuItem key={n} value={n}>{n === 1 ? 'Chaque réunion' : `1 réunion sur ${n}`}</MenuItem>)}
            </TextField>
            <TextField size="small" type="date" label="Jusqu’au (facultatif)" InputLabelProps={{ shrink: true }}
              value={value.end_date} disabled={disabled} onChange={(e) => set({ end_date: e.target.value })} />
          </Stack>
          <Typography variant="body2" sx={{ mb: 0.75 }}>
            Mois concernés : {value.months.length ? '' : 'tous'}
            <Button size="small" disabled={disabled} onClick={() => set({ months: [] })}>Tous</Button>
            <Button size="small" disabled={disabled} onClick={() => set({ months: QUARTERLY })}>Trimestriel</Button>
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {MONTHS.map((label, i) => {
              const on = value.months.includes(i + 1)
              return <Chip key={label} size="small" label={label} disabled={disabled} clickable
                color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'}
                onClick={() => toggleMonth(i + 1)} aria-pressed={on} />
            })}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Repris sur les réunions suivantes ({kindLabel}) : {recurrenceLabel(toRule(value)).toLowerCase()}.
          </Typography>
        </Box>
      )}
    </Box>
  )
}
