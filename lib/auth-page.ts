/**
 * /login -- email/password sign-in and sign-up against Appwrite Auth.
 *
 * Already-authenticated visitors are sent to /workspace. After a successful
 * sign-in or sign-up the same redirect happens. Locale follows ?locale= the
 * same way /history does.
 */
import 'ranui/button';
import 'ranui/input';
import 'ranui/message';
import { Div, View } from 'ranui/builder';
import '../styles/auth.css';
import { applyDocumentLanguage, t } from '@ranuts/shared/i18n';
import { getCurrentUser, signIn, signOut, signUp } from './appwrite/auth';

applyDocumentLanguage();

type Mode = 'signin' | 'signup';

let mode: Mode = 'signin';
let busy = false;
let email = '';
let password = '';
let name = '';

function root(): HTMLElement {
  return document.getElementById('auth-root') as HTMLElement;
}

function workspaceUrl(): string {
  const locale = new URLSearchParams(window.location.search).get('locale');
  return locale ? `/workspace?locale=${encodeURIComponent(locale)}` : '/workspace';
}

function notifyError(message: string): void {
  (window as unknown as { message?: { error?: (msg: string) => void } }).message?.error?.(message);
}

function onInputChange(event: Event, setter: (value: string) => void): void {
  const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
  setter(value);
}

function field(label: string, input: HTMLElement): HTMLElement {
  return Div().class('auth-field').children(View('label').class('auth-label').text(label).build(), input).build();
}

function render(): void {
  const host = root();
  host.replaceChildren();

  const emailInput = View('r-input')
    .attr('type', 'email')
    .attr('name', 'email')
    .attr('autocomplete', 'email')
    .attr('placeholder', t('cloudEmail'))
    .attr('value', email)
    .class('auth-input')
    .on('change', (event) => onInputChange(event, (v) => (email = v)))
    .on('input', (event) => onInputChange(event, (v) => (email = v)))
    .build() as HTMLElement;

  const passwordInput = View('r-input')
    .attr('type', 'password')
    .attr('name', 'password')
    .attr('autocomplete', mode === 'signup' ? 'new-password' : 'current-password')
    .attr('placeholder', t('cloudPassword'))
    .attr('value', password)
    .class('auth-input')
    .on('change', (event) => onInputChange(event, (v) => (password = v)))
    .on('input', (event) => onInputChange(event, (v) => (password = v)))
    .build() as HTMLElement;

  const nameInput =
    mode === 'signup'
      ? (View('r-input')
          .attr('type', 'text')
          .attr('name', 'name')
          .attr('autocomplete', 'name')
          .attr('placeholder', t('cloudNameOptional'))
          .attr('value', name)
          .class('auth-input')
          .on('change', (event) => onInputChange(event, (v) => (name = v)))
          .on('input', (event) => onInputChange(event, (v) => (name = v)))
          .build() as HTMLElement)
      : null;

  const submit = View('r-button')
    .attr('type', 'primary')
    .text(mode === 'signin' ? t('cloudSignIn') : t('cloudSignUp'))
    .class('auth-submit')
    .on('click', () => void onSubmit())
    .build();

  const toggle = View('r-button')
    .attr('type', 'text')
    .text(mode === 'signin' ? t('cloudNeedAccount') : t('cloudHaveAccount'))
    .class('auth-toggle')
    .on('click', () => {
      mode = mode === 'signin' ? 'signup' : 'signin';
      render();
    })
    .build();

  const children: HTMLElement[] = [
    View('h1')
      .class('auth-title')
      .text(mode === 'signin' ? t('cloudSignIn') : t('cloudSignUp'))
      .build(),
    View('p').class('auth-lead').text(t('cloudAuthLead')).build(),
    field(t('cloudEmail'), emailInput),
  ];
  if (nameInput) children.push(field(t('cloudNameOptional'), nameInput));
  children.push(
    field(t('cloudPassword'), passwordInput),
    View('p').class('auth-hint').text(t('cloudPasswordHint')).build(),
    submit,
    toggle,
  );

  host.appendChild(
    Div()
      .class('auth-shell')
      .children(
        Div()
          .class('auth-form')
          .children(...children)
          .build(),
      )
      .build(),
  );
}

async function onSubmit(): Promise<void> {
  if (busy) return;
  const trimmedEmail = email.trim();
  if (!trimmedEmail || password.length < 8) {
    notifyError(t('cloudPasswordHint'));
    return;
  }
  busy = true;
  try {
    if (mode === 'signup') await signUp(trimmedEmail, password, name.trim() || undefined);
    else await signIn(trimmedEmail, password);
    window.location.replace(workspaceUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(`${t('cloudAuthFailed')}${message}`);
  } finally {
    busy = false;
  }
}

void (async () => {
  const user = await getCurrentUser();
  if (user) {
    window.location.replace(workspaceUrl());
    return;
  }
  document.title = t('cloudSignIn');
  render();
})();

export { signOut };
