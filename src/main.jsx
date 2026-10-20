import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)

// Champs de date : un clic n'importe où dans le champ ouvre le calendrier
// (sinon Chrome ne sélectionne que « jj » et le calendrier ne s'ouvre que par l'icône)
document.addEventListener('click', (e) => {
  const el = e.target
  if (el instanceof HTMLInputElement && el.type === 'date' && !el.disabled && !el.readOnly) {
    try { el.showPicker?.() } catch { /* navigateur sans showPicker : saisie au clavier */ }
  }
})

// Installable sur téléphone (GitHub Pages est en HTTPS)
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
