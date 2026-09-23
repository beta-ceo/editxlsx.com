/**
 * Folder destination picker for batch Move.
 *
 * Same modal shell as confirm-dialog; the body is a selectable folder list
 * (root + nested folders). Resolves the chosen parent id, or null on dismiss.
 */
import 'ranui/modal';
import 'ranui/button';
import { Div, View } from 'ranui/builder';
import '../styles/confirm-dialog.css';

export type FolderPickerOption = {
  id: string;
  title: string;
  depth: number;
};

export type FolderPickerOptions = {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  rootLabel: string;
  folders: FolderPickerOption[];
  /** Pre-selected parent id (`''` = root). */
  initialId?: string;
};

export function pickFolderDialog(options: FolderPickerOptions): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let chosen = options.initialId ?? '';

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      modal.removeAttribute('open');
      window.setTimeout(() => modal.remove(), 300);
    };

    const list = document.createElement('div');
    list.className = 'folder-picker-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', options.title);

    const paintSelection = (): void => {
      for (const btn of list.querySelectorAll<HTMLButtonElement>('.folder-picker-option')) {
        const selected = btn.dataset.id === chosen;
        btn.classList.toggle('is-selected', selected);
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      }
    };

    const addOption = (id: string, title: string, depth: number): void => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-picker-option';
      btn.dataset.id = id;
      btn.setAttribute('role', 'option');
      btn.style.setProperty('--folder-depth', String(depth));
      btn.textContent = title;
      btn.addEventListener('click', () => {
        chosen = id;
        paintSelection();
      });
      btn.addEventListener('dblclick', () => finish(id));
      list.append(btn);
    };

    addOption('', options.rootLabel, 0);
    for (const folder of options.folders) {
      addOption(folder.id, folder.title, folder.depth);
    }
    paintSelection();

    const cancel = View('r-button')
      .class('confirm-cancel')
      .attr('type', 'text')
      .text(options.cancelLabel)
      .on('click', () => finish(null))
      .build();

    const confirm = View('r-button')
      .class('confirm-ok')
      .attr('type', 'primary')
      .text(options.confirmLabel)
      .on('click', () => finish(chosen))
      .build();

    const modal = View('r-modal')
      .class('confirm-dialog folder-picker-dialog')
      .attr('title', options.title)
      .children(
        Div().class('confirm-body').text(options.body).build(),
        list,
        Div().class('confirm-actions').attr('slot', 'footer').children(cancel, confirm).build(),
      )
      .on('close', () => finish(null))
      .build();

    document.body.appendChild(modal);
    modal.setAttribute('open', 'true');
  });
}
