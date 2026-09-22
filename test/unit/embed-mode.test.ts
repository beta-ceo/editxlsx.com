import { afterEach, describe, expect, it } from 'vitest';
import { isAppShellFrame, isEmbedMode } from '../../lib/embed-mode';

function frame(search: string, parentOrigin: string | 'throw'): Window {
  const view = {
    location: { origin: 'https://edit.example', search },
    parent: {
      get location(): { origin: string } {
        if (parentOrigin === 'throw') throw new Error('cross-origin');
        return { origin: parentOrigin };
      },
    },
  };
  return view as unknown as Window;
}

describe('app shell frame', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('is not a shell at the top level, even with ?shell=1', () => {
    window.history.replaceState(null, '', '/editor?shell=1&workbook=abc');
    expect(isAppShellFrame()).toBe(false);
  });

  it('recognizes a same-origin /workspace host', () => {
    expect(isAppShellFrame(frame('?workbook=abc&shell=1', 'https://edit.example'))).toBe(true);
  });

  it('rejects a frame that did not ask to be the shell', () => {
    expect(isAppShellFrame(frame('?workbook=abc', 'https://edit.example'))).toBe(false);
  });

  it('rejects a cross-origin parent that cannot be this site', () => {
    expect(isAppShellFrame(frame('?shell=1', 'throw'))).toBe(false);
    expect(isAppShellFrame(frame('?shell=1', 'https://evil.example'))).toBe(false);
  });

  it('still treats ?embed=1 on the top window as an embed', () => {
    window.history.replaceState(null, '', '/editor?embed=1');
    expect(isEmbedMode()).toBe(true);
    expect(isAppShellFrame()).toBe(false);
  });
});
