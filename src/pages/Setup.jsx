import { Box, Container, Link, Typography } from '@mui/material'
import { Logo } from '../layouts/PublicLayout'
import { mono } from '../theme'

// Affiché tant que public/config.js n'est pas renseigné
export default function Setup() {
  const steps = [
    <>Créez un projet gratuit sur <Link href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</Link>.</>,
    <>Dans <strong>SQL Editor</strong>, exécutez le fichier <Box component="code" sx={{ fontFamily: mono }}>supabase/schema.sql</Box> du dépôt.</>,
    <>Dans <strong>Project Settings &gt; API Keys</strong>, copiez l’URL du projet et la clé publique (<em>publishable</em> ou <em>anon</em>).</>,
    <>Collez-les dans <Box component="code" sx={{ fontFamily: mono }}>public/config.js</Box> sur GitHub, puis validez (commit). Le site se met à jour en deux minutes.</>,
  ]
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Logo />
      <Typography variant="h2" component="h1" sx={{ mt: 4, mb: 1 }}>Encore une étape</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        AlloCSE n’est pas encore relié à sa base de données.
      </Typography>
      <Box component="ol" sx={{ pl: 2.5, '& li': { mb: 1.5 } }}>
        {steps.map((s, i) => <Typography component="li" key={i}>{s}</Typography>)}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
        Le détail est dans le fichier README du dépôt.
      </Typography>
    </Container>
  )
}
