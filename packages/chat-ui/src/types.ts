/** Who a message belongs to. Drives bubble styling and the (optional) role chip. */
export type ChatRole = 'user' | 'agent' | 'tool' | 'error';

/** A single rendered message. */
export interface ChatMessage {
  role: ChatRole;
  text: string;
}

/** Text shown in the UI. Everything is optional so the component works untranslated. */
export interface ChatViewLabels {
  /** Send-button label (idle state). */
  send?: string;
  /** Send-button label while a turn is running (acts as Stop). */
  stop?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Empty-state hint shown when there are no messages. */
  empty?: string;
  /** Map a role to its display chip (e.g. localisation). Return '' to hide the chip. */
  role?: (role: ChatRole) => string;
}

export interface ChatViewOptions {
  /** Called when the user submits the input (Enter or Send). Receives trimmed text. */
  onSend: (text: string) => void;
  /** Called when the user clicks Send while a turn is running (i.e. Stop). */
  onStop?: () => void;
  /** Initial labels; change later with {@link ChatView.setLabels}. */
  labels?: ChatViewLabels;
}
