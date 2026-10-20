import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Box, Card, Checkbox, CircularProgress, FormControlLabel, Link, MenuItem, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import WarningIcon from '@mui/icons-material/ReportProblemOutlined'
import { useApp } from '../../App'
import { api, fmtShort, periodLabel, SUBJECT_STATUS as STATUS } from '../../api'
import { ErrorAlert } from '../../components'
import { SubjectsHeader } from './shared'

const DAY = 86400000
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const PERIODS = { 3: '3 derniers mois', 6: '6 derniers mois', 12: '12 derniers mois' }

// Couleurs validées (daltonisme, contraste) contre les surfaces de l'app
const COLORS = {
  light: { bar: '#3D6AB8', late: '#D03B3B', pending: '#B07A00', kept: '#2E7D5B' },
  dark: { bar: '#6690DC', late: '#E25D57', pending: '#E0A82E', kept: '#5DBB8A' },
}
const COMMIT_LABEL = { en_attente: 'en attente', tenu: 'tenu', non_tenu: 'non tenu' }

const dayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
const daysBetween = (a, b) => Math.round((dayOf(b) - dayOf(a)) / DAY)
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`

// Une ligne du diagramme : début, fin, retard éventuel
function describe(item, today) {
  // Un sujet commence à la première demande de salarié rattachée, ou à sa création
  const s = item.subject
  const first = s.first_request_at && s.first_request_at < s.created_at ? s.first_request_at : s.created_at
  const r = { ...s, subject: s.title, created_at: first }
  const start = dayOf(r.created_at)
  const due = r.due_date ? dayOf(r.due_date) : null
  const answered = item.answered_at && r.status === 'repondu' ? dayOf(item.answered_at) : null
  const end = answered || today
  const late = !answered && due && due < today ? daysBetween(due, today) : 0
  // Engagements de la direction : le plus en retard parmi ceux en attente
  const commitments = (item.commitments || []).map((c) => ({ ...c, day: dayOf(c.due_date) }))
  const commitLate = Math.max(0, ...commitments.filter((c) => c.status === 'en_attente' && c.day < today).map((c) => daysBetween(c.day, today)))
  return { r, item, start, due, end, answered, late, commitments, commitLate }
}

export default function Gantt() {
  const { user } = useApp()
  const theme = useTheme()
  const navigate = useNavigate()
  const colors = COLORS[theme.palette.mode]
  const narrow = !useMediaQuery(theme.breakpoints.up('sm'))
  const surface = theme.palette.background.paper
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState(6)
  const [mine, setMine] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [view, setView] = useState('gantt')

  useEffect(() => {
    api('/requests/timeline', { query: { include_answered: answered } }).then(setData).catch((e) => setError(e.message))
  }, [answered])

  const today = useMemo(() => dayOf(new Date()), [])
  const rows = useMemo(() => {
    if (!data) return []
    return data.items
      .filter((i) => !mine || i.subject.assignee?.id === user.id)
      .map((i) => describe(i, today))
      .sort((a, b) => (Math.max(b.late, b.commitLate) - Math.max(a.late, a.commitLate)) || ((a.due || Infinity) - (b.due || Infinity)) || (a.start - b.start))
  }, [data, mine, user.id, today])

  // Fenêtre de temps : la période choisie, jusqu'aux prochaines échéances et réunions (6 mois max)
  const range = useMemo(() => {
    const from = addMonths(today, -period)
    from.setDate(1)
    let to = addMonths(today, 1)
    const horizon = addMonths(today, 6)
    for (const row of rows) {
      if (row.due && row.due > to) to = row.due
      for (const c of row.commitments) if (c.day > to) to = c.day
    }
    for (const m of data?.meetings || []) { const d = dayOf(m.meeting_date); if (d > to && d <= horizon) to = d }
    if (to > horizon) to = horizon
    to = new Date(to.getFullYear(), to.getMonth() + 1, 1)
    return { from, to, span: to - from }
  }, [today, period, rows, data])

  const pct = (d) => Math.min(100, Math.max(0, ((dayOf(d) - range.from) / range.span) * 100))
  const inRange = (d) => d >= range.from && d <= range.to

  const months = useMemo(() => {
    const out = []
    for (let d = new Date(range.from); d < range.to; d = addMonths(d, 1)) out.push(new Date(d))
    return out
  }, [range])
  const meetings = (data?.meetings || []).filter((m) => inRange(dayOf(m.meeting_date)))

  if (!data) return error ? <ErrorAlert error={error} /> : <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>

  const lateCount = rows.filter((r) => r.late).length
  const pendingCommits = rows.flatMap((r) => r.commitments).filter((c) => c.status === 'en_attente')
  const lateCommits = pendingCommits.filter((c) => c.day < today).length

  return (
    <>
      <Box sx={{ maxWidth: 860 }}><SubjectsHeader /></Box>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {plural(rows.length, 'sujet')}{answered ? '' : ' en cours'}
        {lateCount > 0 && <> · <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>{lateCount} en retard</Box></>}
        {pendingCommits.length > 0 && <> · {plural(pendingCommits.length, 'engagement')} de la direction en attente
          {lateCommits > 0 && <> dont <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>{lateCommits} dépassé{lateCommits > 1 ? 's' : ''}</Box></>}</>}
      </Typography>
      <ErrorAlert error={error} onClose={() => setError(null)} />

      <Stack direction="row" spacing={1.5} useFlexGap alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField select size="small" label="Période" value={period} onChange={(e) => setPeriod(Number(e.target.value))} sx={{ width: 190 }}>
          {Object.entries(PERIODS).map(([v, l]) => <MenuItem key={v} value={Number(v)}>{l}</MenuItem>)}
        </TextField>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label="Mes sujets" />
        <FormControlLabel control={<Checkbox checked={answered} onChange={(e) => setAnswered(e.target.checked)} />} label="Avec les sujets répondus" />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label="Présentation">
          <ToggleButton value="gantt">Diagramme</ToggleButton>
          <ToggleButton value="table">Tableau</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {rows.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">Aucun sujet en cours.</Typography></Card>
      ) : view === 'table' ? (
        <SubjectTable rows={rows} />
      ) : (
        <Card sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Legend colors={colors} surface={surface} />
          {/* Axe des temps */}
          <Box sx={{ display: 'flex', mt: 1.5 }}>
            <Box sx={{ width: { md: 280 }, flexShrink: 0, display: { xs: 'none', md: 'block' } }} />
            <Box sx={{ position: 'relative', flex: 1, height: narrow ? 24 : 44, borderBottom: 1, borderColor: 'divider' }}>
              {months.filter((_, i) => !narrow || months.length <= 5 || i % 2 === 0).map((m) => (
                <Typography key={m.toISOString()} variant="caption" color="text.secondary"
                  sx={{ position: 'absolute', left: `${pct(m)}%`, top: 0, pl: 0.5, whiteSpace: 'nowrap' }}>
                  {MONTHS[m.getMonth()]}{m.getMonth() === 0 || m.getTime() === months[0].getTime() ? ` ${m.getFullYear()}` : ''}
                </Typography>
              ))}
              {!narrow && meetings.map((m) => (
                <Tooltip key={m.id} title={`${m.title}, ${fmtShort(m.meeting_date)}${m.status === 'tenue' ? ' (tenue)' : ''}`}>
                  <Link component={RouterLink} to={`/elus/reunions/${m.id}`} variant="caption" underline="hover"
                    sx={{ position: 'absolute', left: `${pct(m.meeting_date)}%`, bottom: 2, transform: 'translateX(-50%)', color: 'text.secondary', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    CSE {new Date(m.meeting_date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                  </Link>
                </Tooltip>
              ))}
            </Box>
          </Box>
          {/* Lignes */}
          <Box sx={{ position: 'relative' }}>
            {rows.map((row) => (
              <Row key={row.r.id} row={row} pct={pct} inRange={inRange} range={range} colors={colors} surface={surface}
                months={months} meetings={meetings} today={today} onOpen={() => navigate(`/elus/sujets/${row.r.id}`)} />
            ))}
          </Box>
        </Card>
      )}
    </>
  )
}

function Legend({ colors, surface }) {
  const item = (mark, label) => (
    <Stack direction="row" spacing={0.75} alignItems="center">{mark}<Typography variant="body2" color="text.secondary">{label}</Typography></Stack>
  )
  return (
    <Stack direction="row" spacing={2.5} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      {item(<Box sx={{ width: 24, height: 10, borderRadius: '0 4px 4px 0', bgcolor: colors.bar }} />, 'Du dépôt à l’échéance')}
      {item(<Box sx={{ width: 24, height: 10, borderRadius: '0 4px 4px 0', bgcolor: colors.late }} />, 'Retard')}
      {item(<Box sx={{ width: 2, height: 18, bgcolor: 'text.primary' }} />, 'Échéance')}
      {item(<Diamond color={colors.bar} surface={surface} filled />, 'Traité en réunion')}
      {item(<Diamond color={colors.bar} surface={surface} />, 'À l’ordre du jour')}
      {item(<CommitDot color={colors.pending} surface={surface} />, 'Engagement de la direction (délai)')}
      {item(<CommitDot color={colors.kept} surface={surface} filled />, 'Engagement tenu')}
      {item(<Box sx={{ width: 2, height: 18, bgcolor: 'secondary.main' }} />, 'Aujourd’hui')}
    </Stack>
  )
}

// Délai d'un engagement de la direction : rond (pour le distinguer des réunions, en losange)
function CommitDot({ color, surface, filled = false, sx }) {
  return (
    <Box sx={{
      width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
      bgcolor: filled ? color : surface, border: `3px solid ${color}`, boxShadow: `0 0 0 2px ${surface}`, ...sx,
    }} />
  )
}

function Diamond({ color, surface, filled = false, sx }) {
  return (
    <Box sx={{
      width: 11, height: 11, transform: 'rotate(45deg)', flexShrink: 0,
      bgcolor: filled ? color : surface, border: `2px solid ${color}`, boxShadow: `0 0 0 2px ${surface}`, ...sx,
    }} />
  )
}

function Row({ row, pct, inRange, range, colors, surface, months, meetings, today, onOpen }) {
  const { r, item, start, due, end, answered, late, commitments, commitLate } = row
  // Partie « normale » : du dépôt à l'échéance (ou à aujourd'hui / la réponse) ; retard : de l'échéance à aujourd'hui
  const normalEnd = late ? due : (due && !answered && due > end ? due : end)
  const left = pct(start)
  const width = Math.max(pct(normalEnd) - left, 0.6)
  const tip = (
    <Box sx={{ p: 0.5 }}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{r.subject}</Typography>
      <Typography variant="body2">{STATUS[r.status]?.label}, {r.category}</Typography>
      <Typography variant="body2">Depuis le {fmtShort(r.created_at)}{r.request_count ? `, ${plural(r.request_count, 'demande')}` : ', question des élus'}</Typography>
      {r.kind === 'signalement' && <Typography variant="body2">Situation {periodLabel(r) || 'sans date connue'}</Typography>}
      <Typography variant="body2">{due ? `Échéance : ${fmtShort(r.due_date)}` : 'Sans échéance'}</Typography>
      {late > 0 && <Typography variant="body2" sx={{ fontWeight: 700 }}>En retard de {plural(late, 'jour')}</Typography>}
      {answered && <Typography variant="body2">Répondue le {fmtShort(item.answered_at)}</Typography>}
      {item.meetings.map((m) => (
        <Typography key={m.meeting_id} variant="body2">{m.title}, {fmtShort(m.meeting_date)}{m.discussed ? ' : traité' : ''}</Typography>
      ))}
      {commitments.map((c) => (
        <Typography key={c.id} variant="body2" sx={{ mt: 0.5 }}>
          Engagement ({COMMIT_LABEL[c.status]}{c.status === 'en_attente' && c.day < today ? ', délai dépassé' : ''}) : {c.text}, d’ici le {fmtShort(c.due_date)}
        </Typography>
      ))}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'center' }, borderBottom: 1, borderColor: 'divider', py: 1 }}>
      <Box sx={{ width: { md: 280 }, flexShrink: 0, pr: { md: 2 }, minWidth: 0, mb: { xs: 0.75, md: 0 } }}>
        <Link component={RouterLink} to={`/elus/sujets/${r.id}`} underline="hover" title={r.subject}
          sx={{ display: 'block', fontWeight: 700, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.subject}
        </Link>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {r.number}, {STATUS[r.status]?.label}{r.request_count > 1 ? `, ${r.request_count} salariés` : ''}
          </Typography>
          {late > 0 && (
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: 'text.primary', flexShrink: 0 }}>
              <WarningIcon sx={{ fontSize: 16, color: colors.late }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{late} j</Typography>
            </Stack>
          )}
          {commitLate > 0 && (
            <Tooltip title={`Engagement de la direction dépassé de ${plural(commitLate, 'jour')}`}>
              <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: 'text.primary', flexShrink: 0 }}>
                <CommitDot color={colors.late} surface={surface} filled sx={{ width: 10, height: 10 }} />
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{commitLate} j</Typography>
              </Stack>
            </Tooltip>
          )}
        </Stack>
      </Box>

      <Tooltip title={tip} placement="top" followCursor>
        <Box onClick={onOpen} role="link" aria-label={`Ouvrir ${r.subject}`}
          sx={{ position: 'relative', flex: { xs: 'none', md: 1 }, height: 28, cursor: 'pointer', '&:hover .bar': { filter: 'brightness(1.1)' } }}>
          {/* Grille : un trait par mois, une réunion = un trait */}
          {months.map((m) => <Box key={m.toISOString()} sx={{ position: 'absolute', left: `${pct(m)}%`, top: 0, bottom: 0, width: '1px', bgcolor: 'divider' }} />)}
          {meetings.map((m) => <Box key={m.id} sx={{ position: 'absolute', left: `${pct(m.meeting_date)}%`, top: 0, bottom: 0, width: '1px', bgcolor: 'divider' }} />)}
          {/* Barre */}
          <Box className="bar" sx={{
            position: 'absolute', top: 9, height: 10, left: `${left}%`, width: `${width}%`, bgcolor: colors.bar,
            borderRadius: late ? 0 : '0 4px 4px 0',  // extrémité arrondie côté données, base carrée
          }} />
          {late > 0 && (
            <Box className="bar" sx={{
              position: 'absolute', top: 9, height: 10, bgcolor: colors.late, borderRadius: '0 4px 4px 0',
              left: `calc(${pct(due)}% + 2px)`, width: `calc(${Math.max(pct(today) - pct(due), 0.6)}% - 2px)`,
            }} />
          )}
          {/* Échéance */}
          {due && inRange(due) && <Box sx={{ position: 'absolute', left: `${pct(due)}%`, top: 3, height: 22, width: 2, ml: '-1px', bgcolor: 'text.primary' }} />}
          {/* Aujourd'hui */}
          <Box sx={{ position: 'absolute', left: `${pct(today)}%`, top: 0, bottom: 0, width: 2, ml: '-1px', bgcolor: 'secondary.main' }} />
          {/* Passages en réunion */}
          {item.meetings.filter((m) => inRange(dayOf(m.meeting_date))).map((m) => (
            <Diamond key={m.meeting_id} color={colors.bar} surface={surface} filled={m.discussed || m.status === 'tenue'}
              sx={{ position: 'absolute', top: 8.5, left: `calc(${pct(m.meeting_date)}% - 5.5px)` }} />
          ))}
          {/* Engagements de la direction : du jour de l'engagement au délai, puis rond au délai */}
          {commitments.filter((c) => inRange(c.day)).map((c) => {
            const lateNow = c.status === 'en_attente' && c.day < today
            const color = c.status === 'tenu' ? colors.kept : (lateNow || c.status === 'non_tenu') ? colors.late : colors.pending
            return (
              <Box key={c.id}>
                {c.status === 'en_attente' && (
                  <Box sx={{
                    position: 'absolute', top: 13, height: 0, borderTop: `2px dashed ${color}`,
                    left: `${pct(c.created_at)}%`, width: `${Math.max(pct(c.day) - pct(c.created_at), 0)}%`,
                  }} />
                )}
                <CommitDot color={color} surface={surface} filled={c.status !== 'en_attente' || lateNow}
                  sx={{ position: 'absolute', top: 8, left: `calc(${pct(c.day)}% - 6px)` }} />
              </Box>
            )
          })}
        </Box>
      </Tooltip>
    </Box>
  )
}

function SubjectTable({ rows }) {
  return (
    <TableContainer component={Card}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Sujet</TableCell><TableCell>N°</TableCell><TableCell>Statut</TableCell><TableCell>Déposé</TableCell>
            <TableCell>Échéance</TableCell><TableCell align="right">Retard</TableCell><TableCell>Réunions</TableCell>
            <TableCell>Engagements de la direction</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ r, item, late, commitments }) => (
            <TableRow key={r.id} hover>
              <TableCell sx={{ minWidth: 200 }}>
                <Link component={RouterLink} to={`/elus/sujets/${r.id}`} sx={{ fontWeight: 700 }}>{r.subject}</Link>
                {r.kind === 'signalement' && periodLabel(r) && <Typography variant="body2" color="text.secondary">Situation {periodLabel(r)}</Typography>}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.number}{r.request_count > 1 ? ` (${r.request_count} demandes)` : ''}</TableCell>
              <TableCell>{STATUS[r.status]?.label}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtShort(r.created_at)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.due_date ? fmtShort(r.due_date) : '—'}</TableCell>
              <TableCell align="right" sx={{ fontWeight: late ? 700 : 400, whiteSpace: 'nowrap' }}>{late ? `${late} j` : '—'}</TableCell>
              <TableCell>{item.meetings.map((m) => fmtShort(m.meeting_date)).join(', ') || '—'}</TableCell>
              <TableCell sx={{ minWidth: 180 }}>
                {commitments.length ? commitments.map((c) => (
                  <Typography key={c.id} variant="body2">{fmtShort(c.due_date)} ({COMMIT_LABEL[c.status]}) : {c.text}</Typography>
                )) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
