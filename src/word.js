// Ordre du jour et trame de procès-verbal au format Word du CSE, construits dans le navigateur.
//
// Les modèles sont des documents Word ordinaires (en-tête, logo, destinataires, signatures),
// modifiables dans Word, qui contiennent des repères :
// - {{MOIS}}, {{DATE}}, {{DATE_COURTE}}, {{DATE_REUNION}}, {{DATE_DOC}}, {{TYPE}} : remplacés dans le texte ;
// - {{SECTION}}, {{TEXTE}}, {{SOUS_TITRE}}, {{GROUPE}}, {{POINT}} : paragraphes modèles, recopiés
//   (avec leur style) pour chaque titre, texte, sous-titre et point.
import JSZip from 'jszip'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre']
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const PROTOS = ['SECTION', 'TEXTE', 'SOUS_TITRE', 'GROUPE', 'POINT']
const REQUIRED = { odj: ['SECTION', 'TEXTE', 'SOUS_TITRE', 'POINT'], pv: ['SECTION', 'TEXTE', 'GROUPE', 'POINT'] }
const KINDS = { ordinaire: 'ordinaire', extraordinaire: 'extraordinaire', autre: '' }

// ---------- Dates ----------

const parseDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const pad = (n) => String(n).padStart(2, '0')
const short = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
const monthLabel = (d) => `${MOIS[d.getMonth()]} ${d.getFullYear()}`
const longDate = (d) => {
  const day = JOURS[d.getDay()]
  return `${day[0].toUpperCase()}${day.slice(1)} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`
}

// ---------- Mise en forme : sections, points, sous-titres ----------

const lines = (text) => (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

// Résultat d'un vote dans le PV (ligne à compléter si le résultat n'est pas encore noté)
export function voteLine(v, withTitle = false) {
  const head = `${v.mode === 'en_ligne' ? 'Vote en ligne des élus' : 'Vote'}${withTitle ? ` « ${v.title} »` : ''}${v.secret ? ' à bulletin secret' : ''}`
  if (v.mode === 'seance' && !v.counts) return `${head} : pour …, contre …, abstention … (résultat à compléter).`
  if (v.mode === 'en_ligne' && v.status !== 'clos') return `${head} : en cours.`
  const counts = v.options.map((o, i) => `${v.standard ? o.toLowerCase() : o} ${v.counts?.[i] ?? 0}`).join(', ')
  const result = v.result === 'adopte' ? ' Résolution adoptée.'
    : v.result === 'rejete' ? ' Résolution rejetée.'
      : v.winners?.length === 1 ? ` Choix retenu : ${v.winners[0]}.` : ''
  return `${head} : ${counts}.${result}`
}

// Les points libres deviennent des sections ; les demandes sont regroupées en
// « questions des PV précédents » (déjà passées en réunion sans réponse), puis en
// « Questions CSE » par catégorie.
export function layout({ meeting, held_before: heldBefore, categories, word }) {
  const held = new Set(heldBefore || [])
  // Votes : rattachés à leur point de l'ordre du jour, sinon regroupés dans une section « Votes » finale
  const byItem = new Map()
  const loose = []
  for (const v of meeting.votes || []) {
    const it = meeting.items.find((x) => x.id === v.agenda_item_id)
    if (it && !it.restricted) byItem.set(it.id, [...(byItem.get(it.id) || []), v])
    else loose.push(v)
  }
  const outcomeOf = (it) => [it.outcome, ...(byItem.get(it.id) || []).map((v) => voteLine(v, true))].filter(Boolean).join('\n')
  const before = []
  const after = []
  const carried = []
  const byCategory = new Map()
  const others = []
  let seenRequest = false
  for (const it of meeting.items) {
    if (it.restricted) {
      others.push({ text: it.title })
      seenRequest = true
    } else if (it.subject_id == null) {
      const ls = lines(it.wording)
      const block = {
        title: it.title, text: ls.length === 1 ? ls[0] : null, outcome: outcomeOf(it),
        points: ls.length > 1 ? ls.map((text) => ({ text })) : [], groups: [],
      }
      ;(seenRequest ? after : before).push(block)
    } else {
      seenRequest = true
      const point = { text: lines(it.wording).join(' ') || it.title, outcome: outcomeOf(it) }
      if (held.has(it.subject_id)) carried.push(point)
      else {
        const c = it.category || ''
        if (!byCategory.has(c)) byCategory.set(c, [])
        byCategory.get(c).push(point)
      }
    }
  }
  const blocks = [...before]
  if (carried.length) blocks.push({ title: word.titre_reportes, points: carried, groups: [] })
  const order = new Map((categories || []).map((c, i) => [c, i]))
  const rank = (c) => (order.has(c) ? order.get(c) : order.size)
  const groups = [...byCategory.entries()]
    .map((entry, i) => [entry, i])
    .sort(([[a], i], [[b], j]) => rank(a) - rank(b) || i - j)
    .map(([[c, pts]]) => [(word.sous_titre_categorie || '{categorie}').replaceAll('{categorie}', c), pts])
  if (others.length) groups.push([word.sous_titre_autres, others])
  if (groups.length) blocks.push({ title: word.titre_questions, points: [], groups })
  if (loose.length) after.push({ title: 'Votes', points: loose.map((v) => ({ text: v.title, outcome: voteLine(v) })), groups: [] })
  return blocks.concat(after)
}

// ---------- Manipulation du XML Word ----------

const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.namespaceURI === W && n.localName === name)
const kid = (el, name) => kids(el, name)[0] || null

function paragraphText(p) {
  const runs = [...kids(p, 'r'), ...kids(p, 'hyperlink').flatMap((h) => kids(h, 'r'))]
  let text = ''
  for (const r of runs) {
    for (const n of Array.from(r.childNodes)) {
      if (n.namespaceURI !== W) continue
      if (n.localName === 't') text += n.textContent
      else if (n.localName === 'tab') text += '\t'
      else if (n.localName === 'br' || n.localName === 'cr') text += '\n'
    }
  }
  return text
}

function setText(p, text) {
  const doc = p.ownerDocument
  const runs = kids(p, 'r')
  let run = runs[0]
  if (!run) {
    run = doc.createElementNS(W, 'w:r')
    p.appendChild(run)
  }
  for (const n of Array.from(run.childNodes)) {
    if (!(n.namespaceURI === W && n.localName === 'rPr')) run.removeChild(n)
  }
  text.split(/(\t|\n)/).forEach((part) => {
    if (part === '\t') run.appendChild(doc.createElementNS(W, 'w:tab'))
    else if (part === '\n') run.appendChild(doc.createElementNS(W, 'w:br'))
    else if (part) {
      const t = doc.createElementNS(W, 'w:t')
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve')
      t.textContent = part
      run.appendChild(t)
    }
  })
  for (const r of runs.slice(1)) p.removeChild(r)
}

const numIdOf = (p) => {
  const pPr = kid(p, 'pPr')
  const numPr = pPr && kid(pPr, 'numPr')
  return numPr && kid(numPr, 'numId')
}

const PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/

async function openTemplate(template) {
  const zip = await JSZip.loadAsync(template)
  const parser = new DOMParser()
  const parts = {}
  for (const name of Object.keys(zip.files)) {
    if (PARTS.test(name) || name === 'word/numbering.xml') {
      parts[name] = parser.parseFromString(await zip.file(name).async('string'), 'application/xml')
    }
  }
  if (!parts['word/document.xml']) throw new Error('Ce fichier n’est pas un document Word valide.')
  return { zip, parts }
}

function findProtos(parts) {
  const markers = Object.fromEntries(PROTOS.map((k) => [`{{${k}}}`, k]))
  const protos = {}
  const others = []
  for (const [name, doc] of Object.entries(parts)) {
    if (!PARTS.test(name)) continue
    for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
      const text = paragraphText(p)
      if (markers[text.trim()]) protos[markers[text.trim()]] = p
      else if (text.includes('{{')) others.push([p, text])
    }
  }
  return { protos, others }
}

// Repères absents d'un modèle (vérifié avant d'enregistrer un nouveau modèle)
export async function missingMarkers(kind, template) {
  const { parts } = await openTemplate(template)
  const { protos } = findProtos(parts)
  return REQUIRED[kind].filter((k) => !protos[k])
}

async function render(template, values, required, fill) {
  const { zip, parts } = await openTemplate(template)
  const { protos, others } = findProtos(parts)
  for (const [p, original] of others) {
    let text = original
    for (const [key, value] of Object.entries(values)) text = text.split(key).join(value)
    setText(p, text.replace(/(?<=\S) {2,}(?=\S)/g, ' '))  // type vide : pas de double espace
  }
  const missing = required.filter((k) => !protos[k])
  if (missing.length) throw new Error(`Repères absents du modèle Word : ${missing.map((m) => `{{${m}}}`).join(', ')}`)

  // Numérotation : chaque liste de points repart à 1
  const numbering = parts['word/numbering.xml']?.documentElement
  const protoNum = numIdOf(protos.POINT)
  let abstractId = null
  if (numbering && protoNum) {
    const id = protoNum.getAttributeNS(W, 'val')
    const num = kids(numbering, 'num').find((n) => n.getAttributeNS(W, 'numId') === id)
    abstractId = num && kid(num, 'abstractNumId')?.getAttributeNS(W, 'val')
  }
  const newList = () => {
    if (abstractId == null) return null
    const doc = numbering.ownerDocument
    const next = String(Math.max(...kids(numbering, 'num').map((n) => Number(n.getAttributeNS(W, 'numId')))) + 1)
    const el = (name, attrs = {}) => {
      const e = doc.createElementNS(W, `w:${name}`)
      for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W, `w:${k}`, v)
      return e
    }
    const num = el('num', { numId: next })
    const override = el('lvlOverride', { ilvl: '0' })
    override.appendChild(el('startOverride', { val: '1' }))
    num.appendChild(el('abstractNumId', { val: abstractId }))
    num.appendChild(override)
    numbering.appendChild(num)
    return next
  }

  const body = parts['word/document.xml'].getElementsByTagNameNS(W, 'body')[0]
  const bodyKids = Array.from(body.childNodes)
  const anchor = Object.values(protos)
    .map((el) => [el, bodyKids.includes(el) ? bodyKids.indexOf(el) : bodyKids.length])
    .sort((a, b) => a[1] - b[1])[0][0]

  const add = (kind, text, numId = null) => {
    const el = protos[kind].cloneNode(true)
    anchor.parentNode.insertBefore(el, anchor)
    setText(el, text)
    const num = numIdOf(el)
    if (numId != null && num) num.setAttributeNS(W, 'w:val', numId)
  }
  fill(add, newList)
  for (const el of Object.values(protos)) el.parentNode.removeChild(el)

  const serializer = new XMLSerializer()
  for (const [name, doc] of Object.entries(parts)) {
    let xml = serializer.serializeToString(doc)
    if (!xml.startsWith('<?xml')) xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${xml}`
    zip.file(name, xml)
  }
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' })
}

// ---------- Documents ----------

function buildAgenda(template, meetingDate, placeTime, blocks, kind, today = new Date()) {
  const month = monthLabel(meetingDate)
  const values = {
    'de {{MOIS}}': (/^[ao]/.test(month) ? 'd’' : 'de ') + month,  // d’avril, d’août, d’octobre
    '{{MOIS}}': month,
    '{{DATE_REUNION}}': `${longDate(meetingDate)} ${placeTime || ''}`.trim(),
    '{{DATE_DOC}}': short(today),
    '{{TYPE}}': KINDS[kind] ?? '',
  }
  return render(template, values, REQUIRED.odj, (add, newList) => {
    const addPoints = (points) => {
      const listId = newList()
      for (const point of points) add('POINT', point.text, listId)
    }
    for (const block of blocks) {
      add('SECTION', block.title)
      if (block.text) add('TEXTE', block.text)
      if (block.points.length) addPoints(block.points)
      for (const [subtitle, points] of block.groups) {
        add('TEXTE', '')
        add('SOUS_TITRE', subtitle)
        addPoints(points)
      }
    }
  })
}

// Trame du PV : chaque section et chaque point de l'ODJ, suivi du relevé de décision
// saisi dans AlloCSE, ou d'une ligne vide à compléter par le secrétaire.
function buildMinutes(template, meetingDate, blocks, kind) {
  const values = {
    '{{DATE}}': `${meetingDate.getDate()} ${monthLabel(meetingDate)}`,
    '{{DATE_COURTE}}': short(meetingDate),
    '{{TYPE}}': KINDS[kind] ?? '',
  }
  return render(template, values, REQUIRED.pv, (add) => {
    const addText = (text, placeholder = true) => {
      const ls = lines(text)
      for (const l of ls) add('TEXTE', l)
      if (!ls.length && placeholder) add('TEXTE', '')
    }
    const addPoints = (points) => {
      for (const point of points) {
        add('POINT', point.text)
        addText(point.outcome)
      }
    }
    for (const block of blocks) {
      add('SECTION', block.title)
      addText(block.outcome, !block.points.length && !block.groups.length)
      addPoints(block.points)
      for (const [subtitle, points] of block.groups) {
        add('GROUPE', subtitle)
        addPoints(points)
      }
    }
  })
}

export async function buildWordDocument(kind, template, data, today = new Date()) {
  const meetingDate = parseDay(data.meeting.meeting_date)
  const blocks = layout(data)
  const stamp = `${pad(meetingDate.getDate())}.${pad(meetingDate.getMonth() + 1)}.${meetingDate.getFullYear()}`
  const blob = kind === 'odj'
    ? await buildAgenda(template, meetingDate, data.word?.heure_et_lieu, blocks, data.meeting.kind, today)
    : await buildMinutes(template, meetingDate, blocks, data.meeting.kind)
  return { blob, filename: `${kind === 'odj' ? 'ODJ' : 'PV'} CSE ${stamp}.docx` }
}
