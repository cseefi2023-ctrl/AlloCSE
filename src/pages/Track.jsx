import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Box, Button, Card, CardContent, CircularProgress, InputBase, Stack, TextField, Typography } from '@mui/material'
import { api, fmtDate, periodLabel } from '../api'
import { ErrorAlert, KindChip, MessageList, Section, StatusChip, StatusTrack, TicketCode, Timeline } from '../components'
import { mono, palette } from '../theme'

export default function Track() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(code || '')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!code) return
    setLoading(true); setError(null); setData(null)
    api(`/public/requests/${encodeURIComponent(code)}`)
      .then((d) => { setData(d); if (d.tracking_code !== code) navigate(`/suivi/${d.tracking_code}`, { replace: true }) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [code, navigate])

  const send = async (e) => {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true); setError(null)
    try {
      setData(await api(`/public/requests/${data.tracking_code}/messages`, { method: 'POST', body: { body: reply } }))
      setReply('')
    } catch (err) { setError(err.message) } finally { setSending(false) }
  }

  const lookup = (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); input.trim() && navigate(`/suivi/${encodeURIComponent(input.trim())}`) }}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, pl: 2.5, bgcolor: palette.signal, borderRadius: 999, maxWidth: 560 }}>
      <InputBase value={input} onChange={(e) => setInput(e.target.value)} placeholder="AC-2026-XXXX-XXXX"
        inputProps={{ 'aria-label': 'Numéro de suivi', autoCapitalize: 'characters', spellCheck: false }}
        sx={{ flex: 1, fontFamily: mono, fontWeight: 600, fontSize: '1.15rem', color: palette.ink, '& input::placeholder': { color: palette.ink, opacity: 0.45 } }} />
      <Button type="submit" variant="contained" sx={{ bgcolor: palette.ink, color: '#fff', '&:hover': { bgcolor: '#0E1830' } }}>Suivre</Button>
    </Box>
  )

  if (!code) {
    return (
      <Box sx={{ pt: { xs: 2, sm: 5 } }}>
        <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Suivre ma demande</Typography>
        {lookup}
      </Box>
    )
  }
  if (loading) return <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>
  if (!data) {
    return (
      <Box sx={{ pt: { xs: 2, sm: 5 } }}>
        <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Suivre ma demande</Typography>
        <ErrorAlert error={error} />
        <Typography color="text.secondary" sx={{ mb: 2 }}>Vérifiez le numéro, il commence par AC- et contient 12 caractères.</Typography>
        {lookup}
      </Box>
    )
  }

  const answers = data.messages.filter((m) => m.is_answer)
  return (
    <Box sx={{ pt: { xs: 1, sm: 3 } }}>
      <TicketCode code={data.tracking_code} compact />
      <Stack direction="row" spacing={1} sx={{ mt: 3, mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <StatusChip status={data.status} />
        <KindChip kind={data.kind} temporality={data.temporality} />
      </Stack>
      <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>{data.subject}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {data.category}, déposée le {fmtDate(data.created_at)}
        {data.kind === 'signalement' && periodLabel(data) && <><br />Situation {periodLabel(data)}</>}
      </Typography>
      <StatusTrack status={data.status} agenda={data.events.some((e) => e.label.includes('ordre du jour'))} />

      {answers.length > 0 && (
        <Alert severity="success" icon={false} sx={{ mb: 4, '& .MuiAlert-message': { width: '100%' } }}>
          <Typography variant="h4" component="h2" sx={{ mb: 1 }}>Réponse du CSE</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{answers[answers.length - 1].body}</Typography>
        </Alert>
      )}

      {data.commitments?.length > 0 && (
        <Section title="Engagements de la direction">
          <Stack spacing={1}>
            {data.commitments.map((c, i) => (
              <Card key={i}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography sx={{ overflowWrap: 'anywhere' }}>{c.text}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Délai annoncé : {fmtDate(c.due_date)}
                    {c.status === 'tenu' ? ', tenu' : c.status === 'non_tenu' ? ', non tenu' : ', en attente'}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Section>
      )}

      <Section title="Échanges">
        <MessageList messages={[{ id: 'orig', author_type: 'salarie', body: data.description, created_at: data.created_at, internal: false, is_answer: false }, ...data.messages]} viewer="salarie" />
        {data.status !== 'close' ? (
          <Box component="form" onSubmit={send} sx={{ mt: 2 }}>
            <TextField label="Ajouter une précision" multiline minRows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
            <ErrorAlert error={error} onClose={() => setError(null)} />
            <Button type="submit" variant="contained" disabled={sending || !reply.trim()} sx={{ mt: 1.5 }}>Envoyer la précision</Button>
          </Box>
        ) : (
          <Typography color="text.secondary" sx={{ mt: 2 }}>Cette demande est clôturée. Pour un nouveau sujet, déposez une nouvelle demande.</Typography>
        )}
      </Section>

      <Section title="Historique">
        <Card><CardContent><Timeline events={[...data.events].reverse()} /></CardContent></Card>
      </Section>

      <Typography variant="body2" color="text.secondary">
        {data.visible_to_all
          ? 'Visible par tous les élus du CSE.'
          : `Visible uniquement par : ${data.viewers.map((v) => v.full_name).join(', ')}.`}
      </Typography>
    </Box>
  )
}
