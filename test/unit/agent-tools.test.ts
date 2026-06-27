import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the bridge so tool tests don't depend on a live editor iframe.
const pasteHtml = vi.fn();
const getSelectedText = vi.fn(() => 'line1\r\nline2');
const getSelectionType = vi.fn(() => 'text');
const replaceTextSmart = vi.fn();
const setTrackRevisions = vi.fn();
const isTrackRevisions = vi.fn(() => true);
const makeApi = () => ({
  pluginMethod_PasteHtml: pasteHtml,
  pluginMethod_GetSelectedText: getSelectedText,
  pluginMethod_GetSelectionType: getSelectionType,
  pluginMethod_ReplaceTextSmart: replaceTextSmart,
  asc_SetTrackRevisions: setTrackRevisions,
  asc_IsTrackRevisions: isTrackRevisions,
});
const requireEditorApi = vi.fn(makeApi);
vi.mock('../../lib/agent-plugin/editor-bridge', () => ({
  requireEditorApi: () => requireEditorApi(),
  EditorNotReadyError: class EditorNotReadyError extends Error {},
}));

import {
  agentTools,
  getSelectionTool,
  insertTextTool,
  replaceSelectionTool,
  setReviewModeTool,
  textToHtml,
} from '../../lib/agent-plugin/tools';

describe('agent tools', () => {
  afterEach(() => {
    vi.clearAllMocks();
    getSelectedText.mockReturnValue('line1\r\nline2');
    getSelectionType.mockReturnValue('text');
    isTrackRevisions.mockReturnValue(true);
    requireEditorApi.mockImplementation(makeApi);
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

  describe('get_selection tool', () => {
    it('is read-only and registered', () => {
      expect(agentTools.get_selection).toBe(getSelectionTool);
      expect(getSelectionTool.readOnlyHint).toBe(true);
    });

    it('returns the selection type and CRLF-normalised text', async () => {
      const result = await getSelectionTool.execute({});
      expect(result).toEqual({ type: 'text', text: 'line1\nline2' });
      expect(getSelectionType).toHaveBeenCalledTimes(1);
      expect(getSelectedText).toHaveBeenCalledTimes(1);
    });

    it('reports type "none" with empty text when nothing is selected', async () => {
      getSelectionType.mockReturnValue('none');
      getSelectedText.mockReturnValue('');
      expect(await getSelectionTool.execute({})).toEqual({ type: 'none', text: '' });
    });
  });

  describe('replace_selection tool', () => {
    it('is a write tool and registered', () => {
      expect(agentTools.replace_selection).toBe(replaceSelectionTool);
      expect(replaceSelectionTool.readOnlyHint).toBe(false);
    });

    it('splits the replacement text into lines for ReplaceTextSmart', async () => {
      const result = await replaceSelectionTool.execute({ text: 'first\nsecond' });
      expect(replaceTextSmart).toHaveBeenCalledWith(['first', 'second']);
      expect(result).toEqual({ replaced: true, length: 'first\nsecond'.length });
    });

    it('passes a single-element array for single-line text', async () => {
      await replaceSelectionTool.execute({ text: 'one line' });
      expect(replaceTextSmart).toHaveBeenCalledWith(['one line']);
    });

    it('throws a TypeError for non-string input', async () => {
      // @ts-expect-error intentionally wrong type
      await expect(replaceSelectionTool.execute({ text: null })).rejects.toThrow(TypeError);
      expect(replaceTextSmart).not.toHaveBeenCalled();
    });
  });

  describe('set_review_mode tool', () => {
    it('is registered', () => {
      expect(agentTools.set_review_mode).toBe(setReviewModeTool);
    });

    it('enables track-changes and returns the resulting state', async () => {
      isTrackRevisions.mockReturnValue(true);
      const result = await setReviewModeTool.execute({ enabled: true });
      expect(setTrackRevisions).toHaveBeenCalledWith(true);
      expect(result).toEqual({ enabled: true });
    });

    it('disables track-changes', async () => {
      isTrackRevisions.mockReturnValue(false);
      const result = await setReviewModeTool.execute({ enabled: false });
      expect(setTrackRevisions).toHaveBeenCalledWith(false);
      expect(result).toEqual({ enabled: false });
    });

    it('throws a TypeError when enabled is not a boolean', async () => {
      // @ts-expect-error intentionally wrong type
      await expect(setReviewModeTool.execute({ enabled: 'yes' })).rejects.toThrow(TypeError);
      expect(setTrackRevisions).not.toHaveBeenCalled();
    });
  });
});
