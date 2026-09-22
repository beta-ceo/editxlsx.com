import { afterEach, describe, expect, it } from 'vitest';
import { relocateHeaderFindComments } from '../../lib/onlyoffice/guards/header-find-comments';

/**
 * Guard 19: Find joins the header; Comments / About go away; left rail
 * collapses while the Find panel is closed.
 */
function mountFixture(options: { panelOpen?: boolean } = {}): void {
  const panelDisplay = options.panelOpen ? 'block' : 'none';
  document.body.innerHTML = `
    <div id="box-right-btn-group">
      <div class="hedset">
        <div class="btn-slot" id="slot-btn-mode"></div>
        <div class="btn-slot" id="slot-btn-search">
          <button type="button" class="btn btn-header" aria-label="Find">
            <i class="icon toolbar__icon icon--inverse btn-menu-search"></i>
          </button>
        </div>
      </div>
    </div>
    <div id="left-menu" style="width: 40px;">
      <div id="view-left-menu" class="tool-menu left">
        <div class="tool-menu-btns">
          <button id="left-btn-searchbar" class="btn btn-category" aria-label="Find"
            data-hint-direction="right">
            <i class="icon toolbar__icon btn-menu-search"></i>
          </button>
          <button id="left-btn-comments" class="btn btn-category" aria-label="Comments"></button>
          <button id="left-btn-about" class="btn btn-category" aria-label="About"></button>
        </div>
        <div class="left-panel side-panel">
          <div id="left-panel-search" class="content-box" style="display: ${panelDisplay};"></div>
          <div id="left-panel-comments" class="content-box" style="display: none;"></div>
        </div>
      </div>
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('header find / comments (guard 19)', () => {
  it('waits until header Find slot and left Find both exist', () => {
    document.body.innerHTML = '<div id="left-btn-searchbar"></div>';
    expect(relocateHeaderFindComments(document)).toBe(false);
  });

  it('moves Find into the header and hides Comments / About', () => {
    mountFixture();
    expect(relocateHeaderFindComments(document)).toBe(true);

    const search = document.getElementById('slot-btn-search')!;
    const findSlot = document.getElementById('oo-header-find');
    expect(findSlot).not.toBeNull();
    expect(search.nextElementSibling).toBe(findSlot);
    expect(findSlot!.querySelector('#left-btn-searchbar')).not.toBeNull();
    expect(document.getElementById('oo-header-comments')).toBeNull();

    const btn = document.getElementById('left-btn-searchbar')!;
    expect(btn.classList.contains('btn-header')).toBe(true);
    expect(btn.classList.contains('btn-category')).toBe(false);
    expect(btn.querySelector('.icon--inverse')).not.toBeNull();
    expect(btn.getAttribute('data-hint-direction')).toBe('bottom');

    const css = document.getElementById('oo-header-find-comments-css')?.textContent ?? '';
    expect(css).toContain('#slot-btn-search');
    expect(css).toContain('#left-btn-comments');
    expect(css).toContain('#left-btn-about');
    expect(css).toContain('.tool-menu-btns');
    expect(css).toContain('oo-side-open');
    expect(css).toContain('300px');
  });

  it('marks the left menu open only while the Find panel is visible', () => {
    mountFixture({ panelOpen: false });
    relocateHeaderFindComments(document);
    expect(document.getElementById('left-menu')!.classList.contains('oo-side-open')).toBe(false);

    mountFixture({ panelOpen: true });
    relocateHeaderFindComments(document);
    expect(document.getElementById('left-menu')!.classList.contains('oo-side-open')).toBe(true);
  });

  it('is idempotent across re-applies', () => {
    mountFixture();
    expect(relocateHeaderFindComments(document)).toBe(true);
    expect(relocateHeaderFindComments(document)).toBe(true);
    expect(document.querySelectorAll('#oo-header-find').length).toBe(1);
    expect(document.querySelectorAll('#oo-header-find-comments-css').length).toBe(1);
  });
});
