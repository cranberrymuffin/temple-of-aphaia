// About & Sources panel: a modal <dialog> (native focus trap, Esc closes, background inert) rendered from
// content.ts with textContent only (no HTML injection from data). The button sits top left; the Step 5
// HUD toolbar is top right.
import './about.css'
import type { TempleMeta } from '../../geometry/protocol'
import { buildAboutContent, type Block, type Section } from './content'

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".7"/></svg>'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (text !== undefined) e.textContent = text
  if (className) e.className = className
  return e
}

function link(url: string, text: string): HTMLAnchorElement {
  const a = el('a', text)
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  return a
}

function renderBlock(b: Block): HTMLElement {
  if (b.kind === 'p') return el('p', b.text)
  if (b.kind === 'quote') {
    const q = el('blockquote')
    q.appendChild(el('p', `“${b.text}”`))
    const c = el('cite', b.cite)
    if (b.url) {
      c.append(' ')
      c.appendChild(link(b.url, 'Source'))
    }
    q.appendChild(c)
    if (b.licence) q.appendChild(el('span', b.licence, 'about-meta'))
    return q
  }
  const ul = el('ul')
  for (const i of b.items) {
    const li = el('li')
    li.appendChild(i.url ? link(i.url, i.text) : document.createTextNode(i.text))
    if (i.meta) li.appendChild(el('span', i.meta, 'about-meta'))
    ul.appendChild(li)
  }
  if (!b.collapsed) return ul
  const d = el('details')
  d.appendChild(el('summary', b.collapsed))
  d.appendChild(ul)
  return d
}

function renderSection(s: Section): HTMLElement {
  const sec = el('section')
  sec.id = `about-${s.id}`
  sec.setAttribute('aria-labelledby', `about-${s.id}-h`)
  const h = el('h2', s.title)
  h.id = `about-${s.id}-h`
  sec.appendChild(h)
  for (const b of s.blocks) sec.appendChild(renderBlock(b))
  return sec
}

export interface AboutPanel {
  open(): void
  close(): void
  isOpen(): boolean
  button: HTMLButtonElement
  dialog: HTMLDialogElement
}

export function mountAbout(meta: Pick<TempleMeta, 'site' | 'log'>, root: HTMLElement = document.body): AboutPanel {
  const dialog = el('dialog', undefined, 'about-panel')
  dialog.id = 'about-panel'
  dialog.setAttribute('aria-labelledby', 'about-title')
  const head = el('div', undefined, 'about-head')
  const title = el('h1', 'About & Sources')
  title.id = 'about-title'
  const close = el('button', 'Close', 'about-close')
  close.type = 'button'
  head.append(title, close)
  const body = el('div', undefined, 'about-body')
  body.tabIndex = 0
  for (const s of buildAboutContent(meta)) body.appendChild(renderSection(s))
  dialog.append(head, body)

  const button = el('button', undefined)
  button.type = 'button'
  button.id = 'about-button'
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-controls', dialog.id)
  button.title = 'About this reconstruction and its sources'
  button.innerHTML = `${ICON}<span class="about-label">About</span>`

  // Keep pointer and key input on the button and panel away from the canvas and walk controls (the native
  // modal already makes the page inert to pointers; window-level key listeners would still see keys).
  for (const e of [button, dialog]) e.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  for (const t of ['keydown', 'keyup'] as const) dialog.addEventListener(t, (ev) => ev.stopPropagation())

  const panel: AboutPanel = {
    open() {
      if (!dialog.open) dialog.showModal()
      close.focus()
    },
    close() {
      if (dialog.open) dialog.close()
    },
    isOpen: () => dialog.open,
    button,
    dialog,
  }
  button.addEventListener('click', () => panel.open())
  close.addEventListener('click', () => panel.close())
  // Clicking the backdrop (outside the panel box) closes it.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) panel.close()
  })
  dialog.addEventListener('close', () => button.focus())
  root.append(button, dialog)
  return panel
}
