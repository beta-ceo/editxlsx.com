import { ButtonBuilder, Div, Span, View } from 'ranui/builder';
import { throttle } from 'ranuts/utils';
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
 * The DOM is built with the ranui `builder` (View/Div/Span/ButtonBuilder); the
 * scroll handler is throttled with ranuts. Mount {@link ChatView.el} anywhere,
 * drive it with {@link ChatView.append}/{@link ChatView.appendDelta}/
 * {@link ChatView.setRunning}, and receive input via the `onSend`/`onStop`
 * callbacks. No backend assumptions.
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

    this.emptyEl = Div().class('cui-empty').text(this.labels.empty ?? '').build();

    this.messagesEl = Div()
      .class('cui-messages')
      .on('scroll', throttle(() => this.updateScrollBtn(), 100))
      .children(this.emptyEl)
      .build();

    // Jump-to-latest button — appears when the user scrolls up.
    this.scrollBtn = ButtonBuilder()
      .class('cui-scroll-bottom cui-hidden')
      .attr('type', 'button')
      .aria('label', 'Scroll to latest')
      .on('click', () => this.scrollToEnd(true))
      .build();
    this.scrollBtn.innerHTML = ICON_DOWN;

    // Compose toolbar slot: host-populated controls just above the input.
    this.actionsEl = Div().class('cui-actions').build();

    // Composer: rounded container holding the textarea + a circular icon button.
    this.input = View<HTMLTextAreaElement>('textarea')
      .class('cui-input')
      .attr('rows', '1')
      .on('input', () => {
        this.autoGrow();
        this.updateSendState();
      })
      .on('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.submit();
        }
      })
      .build();
    this.input.placeholder = this.labels.placeholder ?? '';

    this.sendBtn = ButtonBuilder()
      .class('cui-send')
      .attr('type', 'button')
      .on('click', () => {
        if (this.running) this.options.onStop?.();
        else this.submit();
      })
      .build();
    this.sendBtn.innerHTML = ICON_SEND;

    const composer = Div().class('cui-composer').children(this.input, this.sendBtn).build();

    // Footer hosts the jump-to-latest button (floats just above it), the action
    // slot, and the composer.
    const footer = Div().class('cui-footer').children(this.scrollBtn, this.actionsEl, composer).build();

    this.el = Div().class('cui-root').children(this.messagesEl, footer).build();
    this.updateSendState();
  }

  /** Append a finished message and scroll to it. Returns the bubble element. */
  append(message: ChatMessage): HTMLDivElement {
    const stick = this.nearBottom();
    this.emptyEl.remove();

    const chip = this.roleChip(message.role);
    const bubble = Div().class('cui-bubble').text(message.text).build();
    const row = Div()
      .class(`cui-msg cui-msg-${message.role}`)
      .children(chip ? Span().class('cui-role').text(chip).build() : null, bubble)
      .build();

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
