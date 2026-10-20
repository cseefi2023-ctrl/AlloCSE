import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { api } from '../../api'
import { ErrorAlert } from '../../components'
import { FilterChips, SubjectRow, SubjectsHeader } from './shared'

const VIEWS = {
  cours: { label: 'En cours', query: { open_only: true }, empty: 'Aucun sujet en cours.' },
  miens: { label: 'Suivis par moi', query: { open_only: true, mine: true }, empty: 'Vous ne suivez aucun sujet en cours.' },
  tous: { label: 'Tous', query: {}, empty: 'Aucun sujet.' },
}

export default function SubjectList() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('vue') || (params.get('mine') === '1' ? 'miens' : '')
  const view = VIEWS[asked] ? asked : 'cours'
  const [q, setQ] = useState(params.get('q') || '')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api('/subjects', { query: { ...VIEWS[view].query, q } }).then(setRows).catch((e) => setError(e.message))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [view, q])

  return (
    <Box sx={{ maxWidth: 860 }}>
      <SubjectsHeader />
      <TextField size="small" fullWidth placeholder="Rechercher un sujet (intitulé, numéro…)" value={q} onChange={(e) => setQ(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
        inputProps={{ 'aria-label': 'Rechercher un sujet' }} sx={{ mb: 1.5 }} />
      <Box sx={{ mb: 2.5 }}>
        <FilterChips value={view} onChange={(v) => setParams(v === 'cours' ? {} : { vue: v }, { replace: true })}
          options={Object.entries(VIEWS).map(([v, o]) => ({ value: v, label: o.label }))} />
      </Box>
      <ErrorAlert error={error} />
      {rows && rows.length === 0 && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">{q ? 'Aucun sujet ne correspond à cette recherche.' : VIEWS[view].empty}</Typography>
        </Box>
      )}
      <Stack spacing={1}>{rows?.map((s) => <SubjectRow key={s.id} s={s} />)}</Stack>
    </Box>
  )
}
