/**
 * Agent sidebar panel — a thin DOM view over {@link AgentChatController}.
 *
 * Header (title + close), a settings block (provider selector → cloud API key
 * for Claude/OpenAI, or a local model picker + load button for WebLLM), a
 * toolbar (review-mode toggle + clear), a conversation list, and an input box
 * whose button toggles between Send and Stop while a run is active. All
 * orchestration lives in the controller and the LLM factory; this file only
 * builds DOM and forwards events. Loaded behind `?agent=1`.
 */
import { getEditorApi } from '../editor-bridge';
import { createProvider, defaultProviderId, type ProviderId } from '../llm/factory';
import { getApiKey, setApiKey } from '../llm/keys';
import { DEFAULT_WEBLLM_MODEL, isWebGPUAvailable, WEBLLM_MODELS, WebLLMProvider } from '../llm/webllm';
import { AgentChatController, type ChatTurn } from './controller';

const TURN_LABEL: Record<ChatTurn['role'], string> = { user: '你', agent: 'Agent', tool: '工具', error: '错误' };

const PROVIDER_OPTIONS: Array<[ProviderId, string]> = [
  ['anthropic', 'Claude（云端，需 API Key）'],
  ['openai', 'OpenAI（云端，需 API Key）'],
  ['webllm', '本地离线（WebLLM，需 WebGPU）'],
];

const KEY_PLACEHOLDER: Partial<Record<ProviderId, string>> = { anthropic: 'sk-ant-...', openai: 'sk-...' };

/** Build the Agent panel, append it to the body, and return its root element. */
export function createAgentPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'agent-panel';

  // ── Header ──────────────────────────────────────────────────────────────
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

  // ── Settings ────────────────────────────────────────────────────────────
  const settings = document.createElement('div');
  settings.className = 'agent-panel-settings';

  const providerSelect = document.createElement('select');
  providerSelect.className = 'agent-panel-provider';
  for (const [value, label] of PROVIDER_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    providerSelect.append(opt);
  }
  providerSelect.value = defaultProviderId();

  // Cloud: API key input
  const keyInput = document.createElement('input');
  keyInput.className = 'agent-panel-key-input';
  keyInput.type = 'password';

  // Local: model picker + load button
  const modelRow = document.createElement('div');
  modelRow.className = 'agent-panel-model-row';
  const modelSelect = document.createElement('select');
  modelSelect.className = 'agent-panel-model';
  for (const model of WEBLLM_MODELS) {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = `${model.label}（${model.size}）`;
    modelSelect.append(opt);
  }
  modelSelect.value = DEFAULT_WEBLLM_MODEL;
  const loadBtn = document.createElement('button');
  loadBtn.className = 'agent-panel-load';
  loadBtn.type = 'button';
  loadBtn.textContent = '加载模型';
  modelRow.append(modelSelect, loadBtn);

  const note = document.createElement('div');
  note.className = 'agent-panel-note';

  settings.append(providerSelect, keyInput, modelRow, note);

  // ── Toolbar ─────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'agent-panel-toolbar';
  const reviewLabel = document.createElement('label');
  reviewLabel.className = 'agent-panel-review';
  const reviewCheck = document.createElement('input');
  reviewCheck.type = 'checkbox';
  reviewLabel.append(reviewCheck, document.createTextNode(' 修订模式'));
  const clearBtn = document.createElement('button');
  clearBtn.className = 'agent-panel-clear';
  clearBtn.type = 'button';
  clearBtn.textContent = '清空对话';
  toolbar.append(reviewLabel, clearBtn);

  // ── Conversation ────────────────────────────────────────────────────────
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

  // ── Input ───────────────────────────────────────────────────────────────
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

  // ── Controller wiring ───────────────────────────────────────────────────
  const currentProvider = (): ProviderId => providerSelect.value as ProviderId;

  let controller: AgentChatController | null = null;
  let controllerKind = '';
  let webllmProvider: WebLLMProvider | null = null;

  const syncProviderUi = (): void => {
    const id = currentProvider();
    const isCloud = id === 'anthropic' || id === 'openai';
    keyInput.style.display = isCloud ? '' : 'none';
    modelRow.style.display = id === 'webllm' ? '' : 'none';
    if (isCloud) {
      keyInput.placeholder = KEY_PLACEHOLDER[id] ?? '';
      keyInput.value = getApiKey(id) ?? '';
      note.textContent = '';
    } else {
      note.textContent = isWebGPUAvailable()
        ? '选择模型后点「加载模型」预下载（之后浏览器缓存），或直接发送。'
        : '当前浏览器不支持 WebGPU，无法使用本地模式。';
    }
  };
  providerSelect.addEventListener('change', () => {
    controller = null;
    syncProviderUi();
  });
  keyInput.addEventListener('change', () => {
    const id = currentProvider();
    if (id === 'anthropic' || id === 'openai') setApiKey(id, keyInput.value.trim());
  });
  syncProviderUi();

  const buildController = (): AgentChatController | null => {
    const id = currentProvider();
    if (id === 'webllm') {
      if (!isWebGPUAvailable()) return null;
      const kind = `webllm:${modelSelect.value}`;
      if (!controller || controllerKind !== kind) {
        webllmProvider = new WebLLMProvider({
          model: modelSelect.value,
          onProgress: (p) => (note.textContent = p.text),
        });
        controller = new AgentChatController(webllmProvider, appendTurn);
        controllerKind = kind;
      }
      return controller;
    }
    const key = keyInput.value.trim();
    if (!key) return null;
    const kind = `${id}:${key}`;
    if (!controller || controllerKind !== kind) {
      controller = new AgentChatController(createProvider(id, { apiKey: key }), appendTurn);
      controllerKind = kind;
      webllmProvider = null;
    }
    return controller;
  };

  loadBtn.addEventListener('click', async () => {
    if (!isWebGPUAvailable()) {
      note.textContent = '当前浏览器不支持 WebGPU。';
      return;
    }
    buildController();
    loadBtn.disabled = true;
    try {
      await webllmProvider?.preload();
      note.textContent = '模型已加载，可以开始对话。';
    } catch (error) {
      appendTurn({ role: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      loadBtn.disabled = false;
    }
  });

  let running = false;
  const setRunning = (value: boolean): void => {
    running = value;
    sendBtn.textContent = value ? '停止' : '发送';
    textarea.disabled = value;
  };

  const submit = async (): Promise<void> => {
    const text = textarea.value.trim();
    if (!text) return;
    const ctl = buildController();
    if (!ctl) {
      appendTurn({
        role: 'error',
        text: currentProvider() === 'webllm' ? '当前浏览器不支持 WebGPU。' : '请先填写 API Key。',
      });
      return;
    }
    textarea.value = '';
    setRunning(true);
    try {
      await ctl.send(text);
    } finally {
      setRunning(false);
      textarea.focus();
    }
  };

  sendBtn.addEventListener('click', () => {
    if (running) controller?.stop();
    else void submit();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  });
  clearBtn.addEventListener('click', () => {
    controller?.reset();
    conversation.replaceChildren();
  });

  // Review-mode toggle reads/sets track-changes directly on the editor.
  const api = getEditorApi();
  reviewCheck.disabled = !api;
  if (api) reviewCheck.checked = !!api.asc_IsTrackRevisions();
  reviewCheck.addEventListener('change', () => {
    getEditorApi()?.asc_SetTrackRevisions(reviewCheck.checked);
  });

  panel.append(header, settings, toolbar, conversation, inputRow);
  document.body.appendChild(panel);
  return panel;
}
