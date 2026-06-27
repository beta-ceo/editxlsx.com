/**
 * Agent tool definitions. Each tool wraps a verified editor capability
 * (see editor-bridge.ts) behind a typed `execute` + JSON Schema.
 *
 * Phase 1 tools (all over verified editor methods): insert_text, get_selection,
 * replace_selection, set_review_mode. Still pending mechanism verification:
 * get_document_text (non-destructive full-text read) and add_comment.
 */
import { requireEditorApi } from './editor-bridge';
import type { AgentTool } from './types';

/**
 * Convert plain text into the minimal HTML `pluginMethod_PasteHtml` expects.
 * Escapes HTML-significant characters and maps newlines to `<br />` so the
 * inserted text keeps its line breaks without injecting markup.
 */
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\r\n|\r|\n/g, '<br />');
}

export interface InsertTextParams {
  /** The plain text to insert at the cursor. */
  text: string;
}

export const insertTextTool: AgentTool<InsertTextParams, { inserted: true; length: number }> = {
  name: 'insert_text',
  description:
    'Insert plain text at the current cursor position in the document. ' +
    'Newlines are preserved as line breaks. Replaces the current selection if any text is selected.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The plain text to insert at the cursor.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  readOnlyHint: false,
  execute: async ({ text }) => {
    if (typeof text !== 'string') {
      throw new TypeError('insert_text requires a string "text" parameter');
    }
    const api = requireEditorApi();
    api.pluginMethod_PasteHtml(textToHtml(text));
    return { inserted: true, length: text.length };
  },
};

export const getSelectionTool: AgentTool<Record<string, never>, { type: string; text: string }> = {
  name: 'get_selection',
  description:
    'Read the current selection in the document. Returns the selection type ' +
    '("none" when nothing is selected) and the selected plain text.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  readOnlyHint: true,
  execute: async () => {
    const api = requireEditorApi();
    const type = api.pluginMethod_GetSelectionType();
    // The SDK returns CRLF-separated text; normalise to \n for the model.
    const text = api.pluginMethod_GetSelectedText().replace(/\r\n/g, '\n');
    return { type, text };
  },
};

export interface ReplaceSelectionParams {
  /** The replacement text. Newlines are sent as separate lines to the editor. */
  text: string;
}

export const replaceSelectionTool: AgentTool<ReplaceSelectionParams, { replaced: true; length: number }> = {
  name: 'replace_selection',
  description:
    'Replace the currently selected text with new text. Does nothing useful if ' +
    'no text is selected — check get_selection first. In review mode the change ' +
    'is recorded as a tracked revision.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The replacement text.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  readOnlyHint: false,
  execute: async ({ text }) => {
    if (typeof text !== 'string') {
      throw new TypeError('replace_selection requires a string "text" parameter');
    }
    const api = requireEditorApi();
    api.pluginMethod_ReplaceTextSmart(text.split(/\r\n|\r|\n/));
    return { replaced: true, length: text.length };
  },
};

export interface SetReviewModeParams {
  /** True to turn track-changes on, false to turn it off. */
  enabled: boolean;
}

export const setReviewModeTool: AgentTool<SetReviewModeParams, { enabled: boolean }> = {
  name: 'set_review_mode',
  description:
    "Turn the document's track-changes (review) mode on or off. When on, every " +
    'edit is recorded as a revision the user can accept or reject.',
  inputSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'True to enable review mode, false to disable.' },
    },
    required: ['enabled'],
    additionalProperties: false,
  },
  readOnlyHint: false,
  execute: async ({ enabled }) => {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('set_review_mode requires a boolean "enabled" parameter');
    }
    const api = requireEditorApi();
    api.asc_SetTrackRevisions(enabled);
    return { enabled: api.asc_IsTrackRevisions() };
  },
};

/** All registered agent tools, keyed by name for lookup by the runtime. */
export const agentTools: Record<string, AgentTool> = {
  [insertTextTool.name]: insertTextTool as unknown as AgentTool,
  [getSelectionTool.name]: getSelectionTool as unknown as AgentTool,
  [replaceSelectionTool.name]: replaceSelectionTool as unknown as AgentTool,
  [setReviewModeTool.name]: setReviewModeTool as unknown as AgentTool,
};
