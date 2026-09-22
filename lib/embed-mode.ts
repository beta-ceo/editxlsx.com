/**
 * Embed detection: is this window running inside a host page's iframe (or
 * explicitly asked to behave as if it were)?
 *
 * `initEmbedApi` owns the embed *feature* -- the postMessage protocol, the
 * origin allowlist and the `embed-mode` body class. This module is just the
 * cheap, side-effect-free predicate the rest of the app reads to stay out of
 * the host's way: local save routing, the unsaved-changes guard and the
 * autosave history all have to be silent when the document on screen belongs
 * to someone else's page. The /workspace shell is the exception (`isAppShellFrame`):
 * that iframe is this site, and cloud save stays on.
 */
const EMBED_QUERY_KEYS = ['embed', 'embedded'];

/**
 * /workspace hosts the editor in a same-origin iframe (`/editor?workbook=&shell=1`).
 * That frame is not a third-party embed: Save and cloud autosave must still
 * reach the signed-in account. A cross-origin parent cannot read
 * `parent.location`, so it cannot opt into this.
 */
export function isAppShellFrame(view: Window = window): boolean {
  if (view.parent === view) return false;
  const params = new URLSearchParams(view.location.search);
  if (params.get('shell') !== '1') return false;
  try {
    return view.parent.location.origin === view.location.origin;
  } catch {
    return false;
  }
}

export function isEmbedMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (isAppShellFrame()) return false;
  if (window.parent !== window) {
    return true;
  }
  const params = new URLSearchParams(window.location.search);
  return EMBED_QUERY_KEYS.some((key) => {
    if (!params.has(key)) return false;
    const value = params.get(key);
    return value === '' || value === '1' || value === 'true';
  });
}
