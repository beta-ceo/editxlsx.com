import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the bridge so tool tests don't depend on a live editor iframe.
const pasteHtml = vi.fn();
const getSelectedText = vi.fn(() => 'line1\r\nline2');
const getSelectionType = vi.fn(() => 'text');
const replaceTextSmart = vi.fn();
const setTrackRevisions = vi.fn();
const isTrackRevisions = vi.fn(() => true);
const editSelectAll = vi.fn();
const removeSelection = vi.fn();
const addComment = vi.fn();
const pasteText = vi.fn();
const findCell = vi.fn();
const getCellInfo = vi.fn(() => ({ asc_getText: () => 'cellValue' }));
const makeApi = () => ({
  pluginMethod_PasteHtml: pasteHtml,
  pluginMethod_PasteText: pasteText,
  pluginMethod_GetSelectedText: getSelectedText,
  pluginMethod_GetSelectionType: getSelectionType,
  pluginMethod_ReplaceTextSmart: replaceTextSmart,
  asc_SetTrackRevisions: setTrackRevisions,
  asc_IsTrackRevisions: isTrackRevisions,
  asc_EditSelectAll: editSelectAll,
  asc_RemoveSelection: removeSelection,
  asc_addComment: addComment,
  asc_findCell: findCell,
  asc_getCellInfo: getCellInfo,
});
// Comment-data object built by the editor frame's Asc namespace.
const putText = vi.fn();
const putUserName = vi.fn();
const commentData = { asc_putText: putText, asc_putUserName: putUserName, asc_putUserId: vi.fn() };
// Must be a regular function (not arrow) so it works with `new`.
const makeAsc = () => ({
  asc_CCommentDataWord: vi.fn(function () {
    return commentData;
  }),
});
const requireEditorApi = vi.fn(makeApi);
const requireEditorContext = vi.fn(() => ({ api: makeApi(), Asc: makeAsc() }));
vi.mock('../../lib/agent-plugin/editor-bridge', () => ({
  requireEditorApi: () => requireEditorApi(),
  requireEditorContext: () => requireEditorContext(),
  EditorNotReadyError: class EditorNotReadyError extends Error {},
}));

import {
  addCommentTool,
  agentTools,
  getCellTool,
  getDocumentTextTool,
  getSelectionTool,
  insertTextTool,
  replaceSelectionTool,
  setCellTool,
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
    requireEditorContext.mockImplementation(() => ({ api: makeApi(), Asc: makeAsc() }));
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

  describe('get_document_text tool', () => {
    it('is read-only and registered', () => {
      expect(agentTools.get_document_text).toBe(getDocumentTextTool);
      expect(getDocumentTextTool.readOnlyHint).toBe(true);
    });

    it('selects all, reads CRLF-normalised text, then clears the selection', async () => {
      getSelectedText.mockReturnValue('Alpha.\r\nBeta.');
      const result = await getDocumentTextTool.execute({});
      expect(editSelectAll).toHaveBeenCalledTimes(1);
      expect(removeSelection).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ text: 'Alpha.\nBeta.', truncated: false });
    });

    it('truncates to maxChars and flags it', async () => {
      getSelectedText.mockReturnValue('abcdefghij');
      const result = await getDocumentTextTool.execute({ maxChars: 4 });
      expect(result).toEqual({ text: 'abcd', truncated: true });
    });

    it('defaults maxChars when called with empty params', async () => {
      getSelectedText.mockReturnValue('short');
      const result = await getDocumentTextTool.execute({});
      expect(result).toEqual({ text: 'short', truncated: false });
    });
  });

  describe('add_comment tool', () => {
    it('is a write tool and registered', () => {
      expect(agentTools.add_comment).toBe(addCommentTool);
      expect(addCommentTool.readOnlyHint).toBe(false);
    });

    it('builds a comment data object and adds it with the given author', async () => {
      const result = await addCommentTool.execute({ text: 'Consider rephrasing', author: 'Reviewer' });
      expect(putText).toHaveBeenCalledWith('Consider rephrasing');
      expect(putUserName).toHaveBeenCalledWith('Reviewer');
      expect(addComment).toHaveBeenCalledWith(commentData);
      expect(result).toEqual({ added: true });
    });

    it('defaults the author to "Agent"', async () => {
      await addCommentTool.execute({ text: 'note' });
      expect(putUserName).toHaveBeenCalledWith('Agent');
    });

    it('throws a TypeError for non-string text', async () => {
      // @ts-expect-error intentionally wrong type
      await expect(addCommentTool.execute({ text: 123 })).rejects.toThrow(TypeError);
      expect(addComment).not.toHaveBeenCalled();
    });
  });

  describe('set_cell tool (spreadsheet)', () => {
    it('is registered as a write tool', () => {
      expect(agentTools.set_cell).toBe(setCellTool);
      expect(setCellTool.readOnlyHint).toBe(false);
    });

    it('navigates to the cell and writes the value', async () => {
      const result = await setCellTool.execute({ cell: 'B2', value: 'Revenue' });
      expect(findCell).toHaveBeenCalledWith('B2');
      expect(pasteText).toHaveBeenCalledWith('Revenue');
      expect(result).toEqual({ cell: 'B2', value: 'Revenue' });
    });

    it('errors when the editor is not a spreadsheet (no asc_findCell)', async () => {
      requireEditorApi.mockImplementationOnce(
        () => ({ pluginMethod_PasteText: pasteText }) as ReturnType<typeof makeApi>,
      );
      await expect(setCellTool.execute({ cell: 'A1', value: 'x' })).rejects.toThrow('spreadsheet');
    });

    it('throws a TypeError for non-string params', async () => {
      // @ts-expect-error intentionally wrong type
      await expect(setCellTool.execute({ cell: 'A1', value: 5 })).rejects.toThrow(TypeError);
    });
  });

  describe('get_cell tool (spreadsheet)', () => {
    it('is registered as a read tool', () => {
      expect(agentTools.get_cell).toBe(getCellTool);
      expect(getCellTool.readOnlyHint).toBe(true);
    });

    it('navigates to the cell and reads its text', async () => {
      const result = await getCellTool.execute({ cell: 'C3' });
      expect(findCell).toHaveBeenCalledWith('C3');
      expect(result).toEqual({ cell: 'C3', text: 'cellValue' });
    });

    it('errors when the editor is not a spreadsheet', async () => {
      requireEditorApi.mockImplementationOnce(() => ({}) as ReturnType<typeof makeApi>);
      await expect(getCellTool.execute({ cell: 'A1' })).rejects.toThrow('spreadsheet');
    });
  });

  describe('get_document_text robustness', () => {
    it('does not call asc_RemoveSelection when it is absent (spreadsheet)', async () => {
      requireEditorApi.mockImplementationOnce(
        () =>
          ({
            asc_EditSelectAll: editSelectAll,
            pluginMethod_GetSelectedText: () => 'a\tb',
            // no asc_RemoveSelection
          }) as unknown as ReturnType<typeof makeApi>,
      );
      const result = await getDocumentTextTool.execute({});
      expect(result.text).toBe('a\tb');
    });
  });
});
