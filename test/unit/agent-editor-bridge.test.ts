import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorNotReadyError, getEditorApi, requireEditorApi } from '../../lib/agent-plugin/editor-bridge';

/**
 * Build the DOM shape getEditorApi() walks: <div id="iframe"><iframe/></div>,
 * then override the iframe's contentWindow so we can plant a fake editor API
 * (jsdom's real contentWindow can't be assigned a `.editor` reliably).
 */
function mountEditorIframe(contentWindow: unknown): void {
  const container = document.createElement('div');
  container.id = 'iframe';
  const iframe = document.createElement('iframe');
  Object.defineProperty(iframe, 'contentWindow', { value: contentWindow, configurable: true });
  container.appendChild(iframe);
  document.body.appendChild(container);
}

describe('agent editor-bridge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('getEditorApi', () => {
    it('returns null when the container is absent', () => {
      expect(getEditorApi()).toBeNull();
    });

    it('returns null when the container has no iframe', () => {
      const container = document.createElement('div');
      container.id = 'iframe';
      document.body.appendChild(container);
      expect(getEditorApi()).toBeNull();
    });

    it('returns null when the iframe has no editor on its window', () => {
      mountEditorIframe({ editor: undefined });
      expect(getEditorApi()).toBeNull();
    });

    it('returns the editor api when present', () => {
      const api = { pluginMethod_PasteHtml: () => {} };
      mountEditorIframe({ editor: api });
      expect(getEditorApi()).toBe(api);
    });

    it('returns null (fails safe) when contentWindow access throws (cross-origin)', () => {
      const container = document.createElement('div');
      container.id = 'iframe';
      const iframe = document.createElement('iframe');
      Object.defineProperty(iframe, 'contentWindow', {
        get() {
          throw new Error('cross-origin');
        },
        configurable: true,
      });
      container.appendChild(iframe);
      document.body.appendChild(container);
      expect(getEditorApi()).toBeNull();
    });
  });

  describe('requireEditorApi', () => {
    it('throws EditorNotReadyError when the editor is unavailable', () => {
      expect(() => requireEditorApi()).toThrow(EditorNotReadyError);
    });

    it('returns the api when available', () => {
      const api = { pluginMethod_PasteHtml: () => {} };
      mountEditorIframe({ editor: api });
      expect(requireEditorApi()).toBe(api);
    });
  });
});
