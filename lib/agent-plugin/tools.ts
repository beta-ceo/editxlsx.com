/**
 * Agent tool definitions. Each tool wraps a verified editor capability
 * (see editor-bridge.ts) behind a typed `execute` + JSON Schema.
 *
 * Phase 1 ships the first write tool, `insert_text`. Read tools and richer
 * write tools (replace_selection, add_comment, set_review_mode) follow.
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

/** All registered agent tools, keyed by name for lookup by the runtime. */
export const agentTools: Record<string, AgentTool> = {
  [insertTextTool.name]: insertTextTool as unknown as AgentTool,
};
