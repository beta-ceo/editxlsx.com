import { afterEach, describe, expect, it } from 'vitest';
import { relocateHomeQuickActions } from '../../lib/onlyoffice/guards/home-quick-actions';

/**
 * Guard 17: the live Save / Print / Undo / Redo controls live in the title-bar
 * dt-slots. The static Home slots for Undo / Redo stay empty in this build.
 */
function mountToolbarFixture(options: { fillDtSlots?: boolean } = {}): void {
  const fill = options.fillDtSlots !== false;
  const dtInner = fill
    ? '<button type="button" class="btn btn-header"><i class="toolbar__icon icon--inverse btn-undo"></i></button>'
    : '';
  document.body.innerHTML = `
    <div id="box-document-title">
      <div class="btn-slot" id="slot-btn-dt-save">${fill ? '<button type="button" class="btn btn-header"><i class="toolbar__icon icon--inverse btn-save"></i></button>' : ''}</div>
      <div class="btn-slot" id="slot-btn-dt-print">${fill ? '<button type="button" class="btn btn-header"><i class="toolbar__icon icon--inverse btn-print"></i></button>' : ''}</div>
      <div class="btn-slot" id="slot-btn-dt-print-quick"></div>
      <div class="btn-slot" id="slot-btn-dt-undo">${dtInner}</div>
      <div class="btn-slot" id="slot-btn-dt-redo">${fill ? '<button type="button" class="btn btn-header"><i class="toolbar__icon icon--inverse btn-redo"></i></button>' : ''}</div>
    </div>
    <div class="toolbar">
      <section class="panel static">
        <div class="group no-mask small" id="group-save-print">
          <div class="elset"><span class="btn-slot" id="slot-btn-save"></span></div>
          <div class="elset"><span class="btn-slot" id="slot-btn-print"></span></div>
        </div>
        <div class="group small" id="group-clipboard">
          <div class="elset">
            <span class="btn-slot split" id="slot-btn-undo"></span>
            <span class="btn-slot" id="slot-btn-redo"></span>
          </div>
        </div>
      </section>
    </div>
  `;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('home quick actions (guard 17)', () => {
  it('waits until the title-bar slots have mounted buttons', () => {
    mountToolbarFixture({ fillDtSlots: false });
    expect(relocateHomeQuickActions(document)).toBe(false);
    expect(document.getElementById('oo-home-quick')).toBeNull();
  });

  it('moves the title-bar slots into a 2x2 grid and strips inverse icons', () => {
    mountToolbarFixture();
    expect(relocateHomeQuickActions(document)).toBe(true);

    const grid = document.getElementById('oo-home-quick');
    expect(grid).not.toBeNull();
    expect([...grid!.children].map((el) => el.id)).toEqual([
      'slot-btn-dt-save',
      'slot-btn-dt-print',
      'slot-btn-dt-undo',
      'slot-btn-dt-redo',
    ]);
    expect(grid!.querySelectorAll('.icon--inverse')).toHaveLength(0);
    expect(grid!.querySelectorAll('button.btn-toolbar').length).toBeGreaterThan(0);
    expect(grid!.querySelectorAll('button.btn-header')).toHaveLength(0);

    const css = document.getElementById('oo-home-quick-css')?.textContent ?? '';
    expect(css).toContain('#slot-btn-undo');
    expect(css).toContain('#slot-btn-dt-print-quick');
  });

  it('is idempotent across re-applies', () => {
    mountToolbarFixture();
    expect(relocateHomeQuickActions(document)).toBe(true);
    expect(relocateHomeQuickActions(document)).toBe(true);
    expect(document.querySelectorAll('#oo-home-quick').length).toBe(1);
    expect(document.querySelectorAll('#oo-home-quick-css').length).toBe(1);
  });
});
