import { afterEach, describe, expect, it, vi } from 'vitest';
import { closePrintOverlay, deliverPrintPdf } from '../../lib/onlyoffice/guards/print-delivery';

/**
 * Guard 18: Print-panel PDF must leave the tab (download), and print() must
 * not target a display:none iframe. Close uses the vendor Back control.
 */
describe('print delivery (guard 18)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('downloads the blob PDF via an <a download> in the given window', () => {
    const click = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        el.click = click;
      }
      return el;
    });

    deliverPrintPdf(window, 'blob:http://localhost/test-pdf', { fileName: 'Sheet.pdf', print: false });

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = document.querySelector('a[download]') as HTMLAnchorElement | null;
    // Anchor is removed after click; assert via the mock call side effects.
    expect(click.mock.instances[0]).toMatchObject({
      href: 'blob:http://localhost/test-pdf',
      download: 'Sheet.pdf',
    });
    expect(anchor).toBeNull();
  });

  it('uses a laid-out iframe for print, not display:none', () => {
    deliverPrintPdf(window, 'blob:http://localhost/test-pdf', { print: true });
    const frame = document.querySelector('iframe[title="Print"]') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame!.style.display).not.toBe('none');
    expect(frame!.style.opacity).toBe('0');
    expect(frame!.src).toContain('blob:');
  });

  it('closes via the vendor Back control when present', () => {
    document.body.innerHTML = '<li id="fm-btn-return"><a href="#">Back</a></li>';
    const back = document.querySelector('#fm-btn-return a') as HTMLAnchorElement;
    const spy = vi.spyOn(back, 'click').mockImplementation(() => undefined);
    closePrintOverlay(document);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
