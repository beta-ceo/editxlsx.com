import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the bridge so tool tests don't depend on a live editor iframe.
const pasteHtml = vi.fn();
const requireEditorApi = vi.fn(() => ({ pluginMethod_PasteHtml: pasteHtml }));
vi.mock('../../lib/agent-plugin/editor-bridge', () => ({
  requireEditorApi: () => requireEditorApi(),
  EditorNotReadyError: class EditorNotReadyError extends Error {},
}));

import { agentTools, insertTextTool, textToHtml } from '../../lib/agent-plugin/tools';

describe('agent tools', () => {
  afterEach(() => {
    pasteHtml.mockClear();
    requireEditorApi.mockClear();
    requireEditorApi.mockImplementation(() => ({ pluginMethod_PasteHtml: pasteHtml }));
  });

  describe('textToHtml', () => {
    it('escapes HTML-significant characters', () => {
      expect(textToHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    });

    it('converts all newline styles to <br />', () => {
      expect(textToHtml('a\nb\r\nc\rd')).toBe('a<br />b<br />c<br />d');
    });

    it('escapes before converting so injected markup cannot survive', () => {
      expect(textToHtml('<script>')).toBe('&lt;script&gt;');
    });
  });

  describe('insert_text tool', () => {
    it('is registered in the agentTools map and marked as a write tool', () => {
      expect(agentTools.insert_text).toBe(insertTextTool);
      expect(insertTextTool.readOnlyHint).toBe(false);
      expect(insertTextTool.inputSchema).toMatchObject({ required: ['text'] });
    });

    it('inserts escaped HTML via pluginMethod_PasteHtml and reports the length', async () => {
      const result = await insertTextTool.execute({ text: 'Hello <world>' });
      expect(pasteHtml).toHaveBeenCalledTimes(1);
      expect(pasteHtml).toHaveBeenCalledWith('Hello &lt;world&gt;');
      expect(result).toEqual({ inserted: true, length: 'Hello <world>'.length });
    });

    it('throws a TypeError for non-string input', async () => {
      // @ts-expect-error intentionally wrong type
      await expect(insertTextTool.execute({ text: 42 })).rejects.toThrow(TypeError);
      expect(pasteHtml).not.toHaveBeenCalled();
    });

    it('propagates the error when the editor is not ready', async () => {
      requireEditorApi.mockImplementation(() => {
        throw new Error('OnlyOffice editor is not ready');
      });
      await expect(insertTextTool.execute({ text: 'x' })).rejects.toThrow('not ready');
      expect(pasteHtml).not.toHaveBeenCalled();
    });
  });
});
