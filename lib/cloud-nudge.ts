/**
 * Soft, dismissible prompt on local /editor sessions: cross-device sync is
 * $5/year after sign-in. Never shown for embed, shell, or `?workbook=` binds.
 */
import { getLanguage, t } from '@ranuts/shared/i18n';
import { isEmbedMode, isAppShellFrame } from './embed-mode';

const STORAGE_KEY = 'editxlsx-cloud-nudge-dismissed';

function loginHref(): string {
  const locale = getLanguage();
  return locale && locale !== 'en' ? `/login?locale=${encodeURIComponent(locale)}` : '/login';
}

function isWorkbookBound(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('workbook');
  } catch {
    return false;
  }
}

export function maybeShowCloudNudge(): void {
  if (typeof window === 'undefined') return;
  if (isEmbedMode() || isAppShellFrame() || isWorkbookBound()) return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch {
    /* private mode: still show once per tab */
  }
  if (document.getElementById('cloud-nudge')) return;

  const bar = document.createElement('div');
  bar.id = 'cloud-nudge';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:12px',
    'z-index:40',
    'display:flex',
    'flex-wrap:wrap',
    'align-items:center',
    'gap:10px 14px',
    'padding:10px 14px',
    'border-radius:10px',
    'border:1px solid var(--ran-color-border, #d0d5dd)',
    'background:var(--ran-color-bg-elevated, #fff)',
    'color:var(--ran-color-text, #101828)',
    'font:14px/1.4 system-ui,sans-serif',
    'box-shadow:0 8px 24px rgba(16,24,40,.12)',
  ].join(';');

  const text = document.createElement('span');
  text.style.flex = '1 1 220px';
  text.textContent = t('cloudCrossDeviceNudge');

  const link = document.createElement('a');
  link.href = loginHref();
  link.textContent = t('cloudCrossDeviceNudgeLink');
  link.style.cssText = 'font-weight:600;color:var(--brand,#0f766e);text-decoration:none;white-space:nowrap';

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = t('cloudCrossDeviceNudgeDismiss');
  dismiss.style.cssText =
    'border:0;background:transparent;color:var(--ran-color-text-secondary,#667085);cursor:pointer;font:inherit;white-space:nowrap';
  dismiss.addEventListener('click', () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    bar.remove();
  });

  bar.append(text, link, dismiss);
  document.body.append(bar);
}
