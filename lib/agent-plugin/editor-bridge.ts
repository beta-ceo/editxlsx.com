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
  /** Select the entire document body. */
  asc_EditSelectAll(): void;
  /** Clear the current selection. */
  asc_RemoveSelection(): void;
  /** Add a comment built from {@link CommentData} to the current selection. */
  asc_addComment(data: CommentData): void;
  /** Toggle track-changes (revision) mode. */
  asc_SetTrackRevisions(value: boolean): void;
  /** Whether track-changes mode is currently on. */
  asc_IsTrackRevisions(): boolean;
  [method: string]: unknown;
}

/** A Word comment-data object, built via `Asc.asc_CCommentDataWord`. */
export interface CommentData {
  asc_putText(text: string): void;
  asc_putUserName(name: string): void;
  asc_putUserId(id: string): void;
}

/** The editor frame's `Asc` namespace (only the parts we construct are typed). */
export interface EditorAsc {
  asc_CCommentDataWord: new () => CommentData;
  [key: string]: unknown;
}

/** Editor API plus the frame's `Asc` namespace, needed to build SDK objects. */
export interface EditorContext {
  api: EditorApi;
  Asc: EditorAsc;
}

/** The fields we read off the editor iframe's window (not a full Window type). */
interface EditorWindow {
  editor?: unknown;
  Asc?: EditorAsc;
}

/** Thrown when an agent tool runs before the editor iframe is ready. */
export class EditorNotReadyError extends Error {
  constructor(message = 'OnlyOffice editor is not ready') {
    super(message);
    this.name = 'EditorNotReadyError';
  }
}

/**
 * Locate the editor iframe and return its window (with `editor` + `Asc`), or
 * null. Tried named iframe first, then any iframe whose window exposes `editor`.
 * Looked up fresh each call — the editor is destroyed/recreated across documents.
 */
function findEditorWindow(): EditorWindow | null {
  if (typeof document === 'undefined') return null;
  const named = document.querySelector(`iframe[name="${EDITOR_FRAME_NAME}"]`);
  const iframes: Element[] = [];
  if (named) iframes.push(named);
  for (const f of document.querySelectorAll('iframe')) {
    if (f !== named) iframes.push(f);
  }
  for (const iframe of iframes) {
    try {
      const win = (iframe as HTMLIFrameElement).contentWindow as unknown as EditorWindow | null;
      if (win && win.editor && typeof win.editor === 'object') return win;
    } catch {
      // Cross-origin access would throw; in a same-origin deploy this never
      // fires, but skipping keeps the scan from crashing on an odd iframe.
    }
  }
  return null;
}

/**
 * Locate the editor iframe and return its asc_docs_api instance, or null if the
 * editor isn't mounted yet (or — defensively — if it's unexpectedly cross-origin).
 *
 * Looked up fresh on every call: the editor can be destroyed and recreated when
 * switching documents, so caching the reference would risk a stale handle.
 */
/** Return the editor's asc_docs_api instance, or null if not mounted. */
export function getEditorApi(): EditorApi | null {
  const win = findEditorWindow();
  return win ? (win.editor as unknown as EditorApi) : null;
}

/** Return the editor API, throwing {@link EditorNotReadyError} if unavailable. */
export function requireEditorApi(): EditorApi {
  const api = getEditorApi();
  if (!api) throw new EditorNotReadyError();
  return api;
}

/**
 * Return the editor API together with the frame's `Asc` namespace. Needed by
 * tools that must construct SDK objects (e.g. `Asc.asc_CCommentDataWord`) in the
 * editor's own realm so they match the instance passed to `asc_addComment`.
 */
export function getEditorContext(): EditorContext | null {
  const win = findEditorWindow();
  if (!win || !win.editor || !win.Asc) return null;
  return { api: win.editor as unknown as EditorApi, Asc: win.Asc };
}

/** Return the editor context, throwing {@link EditorNotReadyError} if unavailable. */
export function requireEditorContext(): EditorContext {
  const ctx = getEditorContext();
  if (!ctx) throw new EditorNotReadyError();
  return ctx;
}
