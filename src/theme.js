import { createTheme } from '@mui/material/styles'

// Bleu encre (instance représentative) + jaune signal (atelier, sécurité).
export const palette = {
  ink: '#1B2A4A',
  signal: '#F2C230',
  paper: '#F4F6FA',
  slate: '#5B6B82',
  ok: '#2E7D5B',
  alert: '#C8402E',
}

export const mono = '"IBM Plex Mono", ui-monospace, monospace'

export function makeTheme(mode) {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#8FB0EA' : palette.ink, contrastText: dark ? '#0F1626' : '#fff' },
      secondary: { main: palette.signal, contrastText: palette.ink },
      success: { main: palette.ok },
      error: { main: palette.alert },
      background: dark ? { default: '#0F1626', paper: '#18223A' } : { default: palette.paper, paper: '#FFFFFF' },
      text: dark ? { primary: '#E7ECF5', secondary: '#9AA8BF' } : { primary: '#16213A', secondary: palette.slate },
      divider: dark ? 'rgba(231,236,245,0.12)' : 'rgba(27,42,74,0.12)',
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '"Atkinson Hyperlegible", system-ui, sans-serif',
      h1: { fontSize: 'clamp(2rem, 6vw, 3.25rem)', fontWeight: 700, lineHeight: 1.08, letterSpacing: '-0.02em' },
      h2: { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' },
      h3: { fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.25 },
      h4: { fontSize: '1.1rem', fontWeight: 700 },
      body1: { fontSize: '1.0625rem', lineHeight: 1.55 },
      body2: { fontSize: '0.95rem', lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 700, fontSize: '1rem' },
      overline: { textTransform: 'none', letterSpacing: 0, fontSize: '0.85rem', fontWeight: 700 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 999, paddingInline: 20, minHeight: 44 } },
      },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: 14 } },
      },
      MuiTextField: { defaultProps: { fullWidth: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 700 } } },
      MuiButtonBase: {
        styleOverrides: {
          root: { '&.Mui-focusVisible': { outline: `3px solid ${palette.signal}`, outlineOffset: 2 } },
        },
      },
    },
  })
}
