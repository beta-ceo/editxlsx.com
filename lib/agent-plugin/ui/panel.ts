/**
 * Agent sidebar panel — a thin DOM view over {@link AgentChatController}.
 *
 * Layout: header (title + close), a settings row (provider label + API key
 * input persisted to localStorage), a scrolling conversation list, and an input
 * box. All orchestration lives in the controller; this file only builds DOM and
 * forwards events. Created on demand behind `?agent=1`.
 */
import { AnthropicProvider } from '../llm/anthropic';
import { getApiKey, setApiKey } from '../llm/keys';
import { AgentChatController, type ChatTurn } from './controller';

const PROVIDER = 'anthropic';

const TURN_LABEL: Record<ChatTurn['role'], string> = {
  user: '你',
  agent: 'Agent',
  tool: '工具',
  error: '错误',
};

/** Build the Agent panel, append it to the body, and return its root element. */
export function createAgentPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'agent-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'agent-panel-header';
  const title = document.createElement('span');
  title.className = 'agent-panel-title';
  title.textContent = 'AI 助手';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'agent-panel-close';
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => panel.classList.add('agent-panel-hidden'));
  header.append(title, closeBtn);

  // Settings: API key
  const settings = document.createElement('div');
  settings.className = 'agent-panel-settings';
  const keyLabel = document.createElement('label');
  keyLabel.className = 'agent-panel-key-label';
  keyLabel.textContent = 'Claude API Key';
  const keyInput = document.createElement('input');
  keyInput.className = 'agent-panel-key-input';
  keyInput.type = 'password';
  keyInput.placeholder = 'sk-ant-...';
  keyInput.value = getApiKey(PROVIDER) ?? '';
  keyInput.addEventListener('change', () => setApiKey(PROVIDER, keyInput.value.trim()));
  settings.append(keyLabel, keyInput);

  // Conversation
  const conversation = document.createElement('div');
  conversation.className = 'agent-panel-conversation';

  const appendTurn = (turn: ChatTurn): void => {
    const row = document.createElement('div');
    row.className = `agent-turn agent-turn-${turn.role}`;
    const who = document.createElement('span');
    who.className = 'agent-turn-role';
    who.textContent = TURN_LABEL[turn.role];
    const body = document.createElement('div');
    body.className = 'agent-turn-text';
    body.textContent = turn.text;
    row.append(who, body);
    conversation.append(row);
    conversation.scrollTop = conversation.scrollHeight;
  };

  // Input
  const inputRow = document.createElement('div');
  inputRow.className = 'agent-panel-input-row';
  const textarea = document.createElement('textarea');
  textarea.className = 'agent-panel-input';
  textarea.rows = 2;
  textarea.placeholder = '让 AI 帮你编辑文档…（Enter 发送，Shift+Enter 换行）';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'agent-panel-send';
  sendBtn.type = 'button';
  sendBtn.textContent = '发送';
  inputRow.append(textarea, sendBtn);

  // Controller — rebuilt when the API key changes so it picks up the new key.
  let controller: AgentChatController | null = null;
  let lastKey = '';
  const getController = (): AgentChatController | null => {
    const key = keyInput.value.trim();
    if (!key) return null;
    if (!controller || key !== lastKey) {
      controller = new AgentChatController(new AnthropicProvider({ apiKey: key }), appendTurn);
      lastKey = key;
    }
    return controller;
  };

  const submit = async (): Promise<void> => {
    const text = textarea.value.trim();
    if (!text) return;
    const ctl = getController();
    if (!ctl) {
      appendTurn({ role: 'error', text: '请先填写 Claude API Key。' });
      return;
    }
    if (ctl.isRunning()) return;
    textarea.value = '';
    sendBtn.disabled = true;
    textarea.disabled = true;
    try {
      await ctl.send(text);
    } finally {
      sendBtn.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  };

  sendBtn.addEventListener('click', () => void submit());
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  });

  panel.append(header, settings, conversation, inputRow);
  document.body.appendChild(panel);
  return panel;
}
