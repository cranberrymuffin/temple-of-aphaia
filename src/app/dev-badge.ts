// Dev-only build label so a reviewer can tell which iteration of the model they are looking at.
// Bump DEV_VERSION with every visible change. Only imported behind import.meta.env.DEV, so production
// builds contain neither this module nor the badge.
export const DEV_VERSION = '3.1'

export function mountDevBadge(): void {
  const el = document.createElement('div')
  el.id = 'version-tag'
  el.textContent = `VERSION ${DEV_VERSION}`
  el.style.cssText =
    'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;background:#111;color:#ff0;font:700 16px/1 monospace;padding:6px 12px;border-radius:6px;pointer-events:none'
  document.body.appendChild(el)
}
