/* global __APP_VERSION__, __APP_BUILD__ */
// Version affichée dans l'application (numéro de package.json, date et commit de la mise en ligne)
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : ''
export const VERSION_LABEL = `AlloCSE v${VERSION}${BUILD ? ` (${BUILD})` : ''}`
