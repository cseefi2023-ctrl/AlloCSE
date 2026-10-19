import { useEffect, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { Box, Button, Chip, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { api, STATUS, STATUS_ORDER } from '../../api'
import { ErrorAlert } from '../../components'
import { RequestRow } from './shared'

export default function RequestList() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || 'ouvertes'
  const kind = params.get('kind') || ''
  const mine = params.get('mine') === '1'
  const toTriage = params.get('tri') === '1'
  const [q, setQ] = useState(params.get('q') || '')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  const update = (k, v) => {
    const next = new URLSearchParams(params)
    v ? next.set(k, v) : next.delete(k)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => {
      api('/requests', {
        query: {
          status: status === 'ouvertes' || status === 'toutes' ? undefined : status,
          open_only: status === 'ouvertes', kind, mine, q, to_triage: toTriage,
        },
      }).then(setRows).catch((e) => setError(e.message))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [status, kind, mine, q, toTriage])

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2, gap: 1 }}>
        <Typography variant="h2" component="h1">Demandes</Typography>
        <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/elus/demandes/nouvelle">Nouvelle question</Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
        <TextField size="small" placeholder="Rechercher (objet, numéro, thème…)" value={q} onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          inputProps={{ 'aria-label': 'Rechercher' }} />
        <TextField size="small" select label="Statut" value={status} onChange={(e) => update('status', e.target.value === 'ouvertes' ? '' : e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="ouvertes">Toutes sauf clôturées</MenuItem>
          {STATUS_ORDER.map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          <MenuItem value="toutes">Toutes</MenuItem>
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 2.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Chip label="À trier" variant={toTriage ? 'filled' : 'outlined'} color={toTriage ? 'primary' : 'default'}
          onClick={() => update('tri', toTriage ? '' : '1')} />
        <Chip label="Demandes" variant={kind === 'demande' ? 'filled' : 'outlined'} color={kind === 'demande' ? 'primary' : 'default'}
          onClick={() => update('kind', kind === 'demande' ? '' : 'demande')} />
        <Chip label="Signalements" variant={kind === 'signalement' ? 'filled' : 'outlined'} color={kind === 'signalement' ? 'primary' : 'default'}
          onClick={() => update('kind', kind === 'signalement' ? '' : 'signalement')} />
        <Chip label="Suivies par moi" variant={mine ? 'filled' : 'outlined'} color={mine ? 'primary' : 'default'}
          onClick={() => update('mine', mine ? '' : '1')} />
      </Stack>
      <ErrorAlert error={error} />
      {rows && rows.length === 0 && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Aucune demande ne correspond à ces filtres.</Typography>
        </Box>
      )}
      <Stack spacing={1}>{rows?.map((r) => <RequestRow key={r.id} r={r} />)}</Stack>
    </>
  )
}
