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
 */

/** The id of the container div that OnlyOffice mounts its editor iframe into. */
const EDITOR_CONTAINER_ID = 'iframe';

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
  /** Toggle track-changes (revision) mode. */
  asc_SetTrackRevisions(value: boolean): void;
  /** Whether track-changes mode is currently on. */
  asc_IsTrackRevisions?(): boolean;
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
  const container = document.getElementById(EDITOR_CONTAINER_ID);
  const iframe = container?.querySelector('iframe') as HTMLIFrameElement | null;
  if (!iframe) return null;
  try {
    const win = iframe.contentWindow as Window | null;
    const api = (win as unknown as { editor?: unknown } | null)?.editor;
    return api && typeof api === 'object' ? (api as unknown as EditorApi) : null;
  } catch {
    // Cross-origin access would throw; in a same-origin deploy this never fires,
    // but failing safe keeps callers from crashing on an unexpected setup.
    return null;
  }
}

/** Return the editor API, throwing {@link EditorNotReadyError} if unavailable. */
export function requireEditorApi(): EditorApi {
  const api = getEditorApi();
  if (!api) throw new EditorNotReadyError();
  return api;
}
