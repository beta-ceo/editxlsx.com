/**
 * Same-origin bridge to the OnlyOffice editor's command API.
 *
 * Phase 0 (see docs/superpowers/plans/2026-05-30-agent-collab-editor.md) proved
 * that the offline v7.5 build strips the standard plugin model (no plugins.js
 * bridge, `Asc.plugin` singleton is undefined), BUT the full plugin command API
 * is compiled into the SDK and reachable on the editor host instance that lives
 * inside the editor iframe as `contentWindow.editor` (the asc_docs_api).
 *
 * The editor iframe is served from the same origin (web-apps/apps/.../index.html),
 * so the parent page can call `iframe.contentWindow.editor.<method>(...)` directly
 * — no postMessage, no plugin loading required.
 *
 * Note on locating the iframe: DocsAPI is created with target id 'iframe', but
 * OnlyOffice *replaces* that placeholder `<div id="iframe">` with an
 * `<iframe name="frameEditor">` mounted under #app — so after mount there is no
 * `#iframe` element. We locate the editor iframe by its `name` (verified at
 * runtime in Phase 1), falling back to any iframe that exposes `editor`.
 */

/** OnlyOffice names its editor iframe element `frameEditor`. */
const EDITOR_FRAME_NAME = 'frameEditor';

/**
 * The asc_docs_api instance inside the editor iframe. Only the methods verified
 * in Phase 0 are typed; the index signature keeps the many other `pluginMethod_*`
 * / `asc_*` methods reachable without `any` casts at every call site.
 */
export interface EditorApi {
  /** Insert HTML at the current cursor position. */
  pluginMethod_PasteHtml(html: string): void;
  /** Type plain text at the current cursor (preserves surrounding formatting). */
  pluginMethod_InputText(text: string): void;
  /** Return the currently selected text (empty string when nothing is selected). */
  pluginMethod_GetSelectedText(): string;
  /** Return the current selection type, e.g. "none" | "text" | "image". */
  pluginMethod_GetSelectionType(): string;
  /** Replace the current selection with the given lines (one array entry per line). */
  pluginMethod_ReplaceTextSmart(lines: string[]): void;
  /** Toggle track-changes (revision) mode. */
  asc_SetTrackRevisions(value: boolean): void;
  /** Whether track-changes mode is currently on. */
  asc_IsTrackRevisions(): boolean;
  [method: string]: unknown;
}

/** Thrown when an agent tool runs before the editor iframe is ready. */
export class EditorNotReadyError extends Error {
  constructor(message = 'OnlyOffice editor is not ready') {
    super(message);
    this.name = 'EditorNotReadyError';
  }
}

/**
 * Locate the editor iframe and return its asc_docs_api instance, or null if the
 * editor isn't mounted yet (or — defensively — if it's unexpectedly cross-origin).
 *
 * Looked up fresh on every call: the editor can be destroyed and recreated when
 * switching documents, so caching the reference would risk a stale handle.
 */
export function getEditorApi(): EditorApi | null {
  if (typeof document === 'undefined') return null;
  // Try the named editor iframe first, then fall back to scanning every iframe
  // for one whose window exposes `editor` (defends against name changes).
  const named = document.querySelector(`iframe[name="${EDITOR_FRAME_NAME}"]`);
  const iframes: Element[] = [];
  if (named) iframes.push(named);
  for (const f of document.querySelectorAll('iframe')) {
    if (f !== named) iframes.push(f);
  }
  for (const iframe of iframes) {
    try {
      const win = (iframe as HTMLIFrameElement).contentWindow as Window | null;
      const api = (win as unknown as { editor?: unknown } | null)?.editor;
      if (api && typeof api === 'object') return api as unknown as EditorApi;
    } catch {
      // Cross-origin access would throw; in a same-origin deploy this never
      // fires, but skipping keeps the scan from crashing on an odd iframe.
    }
  }
  return null;
}

/** Return the editor API, throwing {@link EditorNotReadyError} if unavailable. */
export function requireEditorApi(): EditorApi {
  const api = getEditorApi();
  if (!api) throw new EditorNotReadyError();
  return api;
}
