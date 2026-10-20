import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { api } from '../../api'
import { ErrorAlert } from '../../components'
import { FilterChips, RequestRow } from './shared'

// Trois vues seulement : à trier, en cours (tout sauf clôturé), toutes
const VIEWS = {
  tri: { label: 'À trier', query: { to_triage: true }, empty: 'Aucune demande à trier.' },
  cours: { label: 'En cours', query: { open_only: true }, empty: 'Aucune demande en cours.' },
  toutes: { label: 'Toutes', query: {}, empty: 'Aucune demande.' },
}

export default function RequestList() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('vue') || (params.get('tri') === '1' ? 'tri' : '')
  const view = VIEWS[asked] ? asked : 'cours'
  const [q, setQ] = useState(params.get('q') || '')
  const [rows, setRows] = useState(null)
  const [triCount, setTriCount] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api('/requests', { query: { ...VIEWS[view].query, q } }).then(setRows).catch((e) => setError(e.message))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [view, q])
  useEffect(() => { api('/requests/stats').then((s) => setTriCount(s.to_triage)).catch(() => {}) }, [rows])

  const choose = (v) => setParams(v === 'cours' ? {} : { vue: v }, { replace: true })

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Demandes des salariés</Typography>
      <TextField size="small" fullWidth placeholder="Rechercher une demande (objet, numéro…)" value={q} onChange={(e) => setQ(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
        inputProps={{ 'aria-label': 'Rechercher une demande' }} sx={{ mb: 1.5 }} />
      <Box sx={{ mb: 2.5 }}>
        <FilterChips value={view} onChange={choose}
          options={Object.entries(VIEWS).map(([v, o]) => ({ value: v, label: o.label, count: v === 'tri' ? triCount : null }))} />
      </Box>
      <ErrorAlert error={error} />
      {rows && rows.length === 0 && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">{q ? 'Aucune demande ne correspond à cette recherche.' : VIEWS[view].empty}</Typography>
        </Box>
      )}
      <Stack spacing={1}>{rows?.map((r) => <RequestRow key={r.id} r={r} />)}</Stack>
    </Box>
  )
}
