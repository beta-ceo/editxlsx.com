import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ranui/message', () => ({}));
vi.mock('ranuts/utils', () => ({
  createObjectURL: vi.fn().mockResolvedValue('blob:mock'),
}));
vi.mock('../../store', () => ({
  getDocmentObj: vi.fn().mockReturnValue({ fileName: 'test.xlsx', file: undefined }),
}));
vi.mock('../../lib/i18n', () => ({
  getOnlyOfficeLang: vi.fn().mockReturnValue('en'),
  t: vi.fn((key: string) => key),
}));
vi.mock('../../lib/file-types', () => ({ c_oAscFileType2: { 65: 'XLSX', 43: 'DOCX' } }));
vi.mock('../../lib/document-utils', () => ({ getMimeTypeFromExtension: vi.fn().mockReturnValue('image/png') }));

import {
  getReadonlyMode,
  requestSaveDocument,
  setConverterCallbacks,
  setReadonlyMode,
} from '../../lib/onlyoffice-editor';

function makeEditor(extra: Record<string, unknown> = {}) {
  return { sendCommand: vi.fn(), ...extra };
}

describe('onlyoffice-editor', () => {
  beforeEach(() => {
    setReadonlyMode(false);
    delete (window as any).editor;
  });

  afterEach(() => {
    delete (window as any).editor;
  });

  describe('getReadonlyMode / setReadonlyMode', () => {
    it('defaults to false', () => {
      expect(getReadonlyMode()).toBe(false);
    });

    it('returns true after setReadonlyMode(true)', () => {
      setReadonlyMode(true);
      expect(getReadonlyMode()).toBe(true);
    });

    it('returns false after toggling back', () => {
      setReadonlyMode(true);
      setReadonlyMode(false);
      expect(getReadonlyMode()).toBe(false);
    });

    it('sends processRightsChange command to the editor when one exists', () => {
      const editor = makeEditor();
      (window as any).editor = editor;

      setReadonlyMode(true);

      expect(editor.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'processRightsChange' }),
      );
    });

    it('does not throw when no editor is present', () => {
      expect(() => setReadonlyMode(true)).not.toThrow();
    });
  });

  describe('requestSaveDocument', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      // Advance past the 60 s timeout to flush any pending embeddedSaveRequest,
      // ensuring module state is clean for the next test.
      vi.runAllTimers();
      await Promise.resolve();
      vi.useRealTimers();
    });

    it('rejects immediately when no document is open', async () => {
      await expect(requestSaveDocument()).rejects.toThrow('No document is open');
    });

    it('rejects when the document is readonly', async () => {
      (window as any).editor = makeEditor({ downloadAs: vi.fn() });
      setReadonlyMode(true);

      await expect(requestSaveDocument()).rejects.toThrow('readonly');
    });

    it('rejects when editor does not support downloadAs', async () => {
      (window as any).editor = makeEditor(); // no downloadAs

      await expect(requestSaveDocument()).rejects.toThrow('downloadAs');
    });

    it('rejects when a save request is already in progress', async () => {
      const downloadAs = vi.fn();
      (window as any).editor = makeEditor({ downloadAs });

      const first = requestSaveDocument().catch(() => {});
      await expect(requestSaveDocument()).rejects.toThrow('already in progress');

      vi.runAllTimers();
      await first;
    });

    it('normalises the target extension to uppercase', () => {
      const downloadAs = vi.fn();
      (window as any).editor = makeEditor({ downloadAs });

      void requestSaveDocument('xlsx').catch(() => {});

      expect(downloadAs).toHaveBeenCalledWith('XLSX');
    });

    it('defaults target extension to XLSX', () => {
      const downloadAs = vi.fn();
      (window as any).editor = makeEditor({ downloadAs });

      void requestSaveDocument().catch(() => {});

      expect(downloadAs).toHaveBeenCalledWith('XLSX');
    });

    it('rejects after 60 s timeout if no save event arrives', async () => {
      const downloadAs = vi.fn();
      (window as any).editor = makeEditor({ downloadAs });

      const promise = requestSaveDocument();
      vi.advanceTimersByTime(60_001);
      await expect(promise).rejects.toThrow('timed out');
    });
  });

  describe('setConverterCallbacks', () => {
    it('accepts converter and convertAndDownload functions without throwing', () => {
      expect(() =>
        setConverterCallbacks({
          convert: vi.fn(),
          convertAndDownload: vi.fn(),
        }),
      ).not.toThrow();
    });
  });
});
