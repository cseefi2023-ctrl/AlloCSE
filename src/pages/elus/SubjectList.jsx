import { useEffect, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { Box, Button, Chip, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { api, SUBJECT_STATUS, SUBJECT_STATUS_ORDER } from '../../api'
import { ErrorAlert } from '../../components'
import { SubjectRow } from './shared'

export default function SubjectList() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || 'ouverts'
  const mine = params.get('mine') === '1'
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
      api('/subjects', {
        query: {
          status: status === 'ouverts' || status === 'tous' ? undefined : status,
          open_only: status === 'ouverts', mine, q,
        },
      }).then(setRows).catch((e) => setError(e.message))
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [status, mine, q])

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5, gap: 1 }}>
        <Typography variant="h2" component="h1">Sujets du CSE</Typography>
        <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/elus/sujets/nouveau">Nouveau sujet</Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 2, maxWidth: '70ch' }}>
        Les sujets que les élus suivent et portent devant la direction : demandes de salariés regroupées, ou questions des élus.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
        <TextField size="small" placeholder="Rechercher (intitulé, numéro, thème…)" value={q} onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          inputProps={{ 'aria-label': 'Rechercher' }} />
        <TextField size="small" select label="Statut" value={status} onChange={(e) => update('status', e.target.value === 'ouverts' ? '' : e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="ouverts">Tous sauf clos</MenuItem>
          {SUBJECT_STATUS_ORDER.map((s) => <MenuItem key={s} value={s}>{SUBJECT_STATUS[s].label}</MenuItem>)}
          <MenuItem value="tous">Tous</MenuItem>
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 2.5 }}>
        <Chip label="Suivis par moi" variant={mine ? 'filled' : 'outlined'} color={mine ? 'primary' : 'default'}
          onClick={() => update('mine', mine ? '' : '1')} />
      </Stack>
      <ErrorAlert error={error} />
      {rows && rows.length === 0 && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Aucun sujet ne correspond à ces filtres.</Typography>
        </Box>
      )}
      <Stack spacing={1}>{rows?.map((s) => <SubjectRow key={s.id} s={s} />)}</Stack>
    </>
  )
}
