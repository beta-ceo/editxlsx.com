import { ensureChatUiStyles } from './styles';
import type { ChatMessage, ChatRole, ChatViewLabels, ChatViewOptions } from './types';

const ICON_SEND =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>';
const ICON_DOWN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>';

/** Distance (px) from the bottom within which we keep auto-scrolling on new content. */
const STICK_THRESHOLD = 60;

/**
 * A framework-free chat UI: a scrolling message list with streaming support and
 * a modern, auto-growing composer whose icon button doubles as Send / Stop.
 *
 * Mount {@link ChatView.el} anywhere. Drive it with {@link ChatView.append},
 * {@link ChatView.appendDelta}, and {@link ChatView.setRunning}; receive user
 * input through the `onSend` / `onStop` callbacks. No backend assumptions.
 */
export class ChatView {
  /** Root element — append this to your container. */
  readonly el: HTMLDivElement;
  /**
   * An action slot directly above the input row. Populate it with your own
   * controls (toggles, quick actions) for an IM-style compose toolbar; it
   * collapses when empty.
   */
  readonly actionsEl: HTMLDivElement;

  private readonly messagesEl: HTMLDivElement;
  private readonly emptyEl: HTMLDivElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly scrollBtn: HTMLButtonElement;
  private labels: ChatViewLabels;
  private running = false;
  /** The agent bubble currently receiving streamed deltas, if any. */
  private liveMsg: HTMLDivElement | null = null;

  constructor(private readonly options: ChatViewOptions) {
    ensureChatUiStyles();
    this.labels = options.labels ?? {};

    this.el = document.createElement('div');
    this.el.className = 'cui-root';

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'cui-messages';
    this.messagesEl.addEventListener('scroll', () => this.updateScrollBtn());

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'cui-empty';
    this.emptyEl.textContent = this.labels.empty ?? '';
    this.messagesEl.appendChild(this.emptyEl);

    // Jump-to-latest button — appears when the user scrolls up.
    this.scrollBtn = document.createElement('button');
    this.scrollBtn.type = 'button';
    this.scrollBtn.className = 'cui-scroll-bottom cui-hidden';
    this.scrollBtn.setAttribute('aria-label', 'Scroll to latest');
    this.scrollBtn.innerHTML = ICON_DOWN;
    this.scrollBtn.addEventListener('click', () => this.scrollToEnd(true));

    // Compose toolbar slot: host-populated controls just above the input.
    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'cui-actions';

    // Composer: rounded container holding the textarea + a circular icon button.
    const composer = document.createElement('div');
    composer.className = 'cui-composer';
    this.input = document.createElement('textarea');
    this.input.className = 'cui-input';
    this.input.rows = 1;
    this.input.placeholder = this.labels.placeholder ?? '';
    this.input.addEventListener('input', () => {
      this.autoGrow();
      this.updateSendState();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    this.sendBtn = document.createElement('button');
    this.sendBtn.type = 'button';
    this.sendBtn.className = 'cui-send';
    this.sendBtn.innerHTML = ICON_SEND;
    this.sendBtn.addEventListener('click', () => {
      if (this.running) this.options.onStop?.();
      else this.submit();
    });
    composer.append(this.input, this.sendBtn);

    // Footer hosts the jump-to-latest button (floats just above it), the action
    // slot, and the composer.
    const footer = document.createElement('div');
    footer.className = 'cui-footer';
    footer.append(this.scrollBtn, this.actionsEl, composer);

    this.el.append(this.messagesEl, footer);
    this.updateSendState();
  }

  /** Append a finished message and scroll to it. Returns the bubble element. */
  append(message: ChatMessage): HTMLDivElement {
    const stick = this.nearBottom();
    this.emptyEl.remove();
    const row = document.createElement('div');
    row.className = `cui-msg cui-msg-${message.role}`;

    const chip = this.roleChip(message.role);
    if (chip) {
      const who = document.createElement('span');
      who.className = 'cui-role';
      who.textContent = chip;
      row.appendChild(who);
    }

    const bubble = document.createElement('div');
    bubble.className = 'cui-bubble';
    bubble.textContent = message.text;
    row.appendChild(bubble);

    this.messagesEl.appendChild(row);
    if (stick) this.scrollToEnd();
    return bubble;
  }

  /**
   * Append streamed text to a live agent bubble, creating it on the first delta.
   * Call {@link endStream} when the turn completes.
   */
  appendDelta(delta: string): void {
    if (!delta) return;
    const stick = this.nearBottom();
    if (!this.liveMsg) {
      this.liveMsg = this.append({ role: 'agent', text: '' }).parentElement as HTMLDivElement;
      this.liveMsg.classList.add('cui-streaming');
    }
    const bubble = this.liveMsg.querySelector('.cui-bubble');
    if (bubble) bubble.textContent = (bubble.textContent ?? '') + delta;
    if (stick) this.scrollToEnd();
  }

  /** Finalise the current streaming bubble (removes the caret). */
  endStream(): void {
    this.liveMsg?.classList.remove('cui-streaming');
    this.liveMsg = null;
  }

  /** Toggle the running state: Send becomes Stop and the input locks. */
  setRunning(running: boolean): void {
    this.running = running;
    this.input.disabled = running;
    this.updateSendState();
  }

  /** Remove all messages and restore the empty state. */
  clear(): void {
    this.messagesEl.replaceChildren(this.emptyEl);
    this.emptyEl.textContent = this.labels.empty ?? '';
    this.liveMsg = null;
    this.updateScrollBtn();
  }

  /** Current input text. */
  getInput(): string {
    return this.input.value;
  }

  /** Replace the input text (e.g. to prepend a quoted selection). */
  setInput(text: string): void {
    this.input.value = text;
    this.autoGrow();
    this.updateSendState();
  }

  focus(): void {
    this.input.focus();
  }

  /** Update labels (e.g. on a language change) and re-apply them live. */
  setLabels(labels: ChatViewLabels): void {
    this.labels = labels;
    this.input.placeholder = labels.placeholder ?? '';
    this.updateSendState();
    if (this.emptyEl.parentElement) this.emptyEl.textContent = labels.empty ?? '';
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text || this.running) return;
    this.input.value = '';
    this.autoGrow();
    this.updateSendState();
    this.options.onSend(text);
  }

  /** Reflect run state + empty input on the send button (icon, disabled, title). */
  private updateSendState(): void {
    this.sendBtn.innerHTML = this.running ? ICON_STOP : ICON_SEND;
    this.sendBtn.classList.toggle('cui-send-stop', this.running);
    this.sendBtn.title = this.running ? this.labels.stop ?? 'Stop' : this.labels.send ?? 'Send';
    this.sendBtn.setAttribute('aria-label', this.sendBtn.title);
    // Disabled only when idle with an empty input; while running it acts as Stop.
    this.sendBtn.disabled = !this.running && this.input.value.trim() === '';
  }

  private roleChip(role: ChatRole): string {
    if (this.labels.role) return this.labels.role(role);
    return role === 'agent' ? 'Agent' : '';
  }

  private autoGrow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 160)}px`;
  }

  private nearBottom(): boolean {
    const el = this.messagesEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }

  private scrollToEnd(smooth = false): void {
    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    this.updateScrollBtn();
  }

  private updateScrollBtn(): void {
    this.scrollBtn.classList.toggle('cui-hidden', this.nearBottom());
  }
}
