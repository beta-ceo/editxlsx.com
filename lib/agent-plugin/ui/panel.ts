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
import { DEFAULT_WEBLLM_MODEL, isModelCached, isWebGPUAvailable, WEBLLM_MODELS, WebLLMProvider } from '../llm/webllm';
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

  // Floating launcher — shown when the panel is closed, reopens it on click.
  const launcher = document.createElement('button');
  launcher.className = 'agent-launcher agent-launcher-hidden';
  launcher.type = 'button';
  launcher.textContent = 'AI';
  launcher.title = '打开 AI 助手';
  const setOpen = (open: boolean): void => {
    panel.classList.toggle('agent-panel-hidden', !open);
    launcher.classList.toggle('agent-launcher-hidden', open);
  };
  launcher.addEventListener('click', () => setOpen(true));

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
  closeBtn.addEventListener('click', () => setOpen(false));
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
  const quoteBtn = document.createElement('button');
  quoteBtn.className = 'agent-panel-quote';
  quoteBtn.type = 'button';
  quoteBtn.textContent = '引用选区';
  quoteBtn.title = '把当前在文档/表格/幻灯片中选中的文字引用到输入框';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'agent-panel-clear';
  clearBtn.type = 'button';
  clearBtn.textContent = '清空对话';
  toolbar.append(reviewLabel, quoteBtn, clearBtn);

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

  // Reflect whether the selected local model is already cached (no re-download).
  const updateLocalHint = async (): Promise<void> => {
    if (currentProvider() !== 'webllm') return;
    if (!isWebGPUAvailable()) {
      note.textContent = '当前浏览器不支持 WebGPU，无法使用本地模式。';
      return;
    }
    const model = WEBLLM_MODELS.find((m) => m.id === modelSelect.value);
    const size = model?.size ?? '';
    const id = modelSelect.value;
    note.textContent = '检查模型缓存…';
    const cached = await isModelCached(id);
    if (currentProvider() !== 'webllm' || modelSelect.value !== id) return; // changed meanwhile
    note.textContent = cached
      ? '该模型已缓存，点击「加载模型」秒开（刷新页面也不会重新下载）。'
      : `首次使用需下载（${size}），之后浏览器缓存，刷新不再下载。`;
  };

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
      void updateLocalHint();
    }
  };
  providerSelect.addEventListener('change', () => {
    controller = null;
    syncProviderUi();
  });
  modelSelect.addEventListener('change', () => {
    controller = null; // different model → rebuild
    void updateLocalHint();
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

  // Quote the current selection (Word text / Excel cells / PPT shape text) into
  // the input so the user can ask about it. Works across editor types because
  // pluginMethod_GetSelectedText is part of the shared plugin command API.
  quoteBtn.addEventListener('click', () => {
    const selected = getEditorApi()?.pluginMethod_GetSelectedText() ?? '';
    if (!selected.trim()) {
      appendTurn({ role: 'error', text: '没有检测到选中的内容，请先在文档中选择文字。' });
      return;
    }
    const quoted = `请参考我选中的内容：\n"""\n${selected.replace(/\r\n/g, '\n')}\n"""\n\n`;
    textarea.value = quoted + textarea.value;
    textarea.focus();
  });

  // Review-mode toggle reads/sets track-changes directly on the editor.
  const api = getEditorApi();
  reviewCheck.disabled = !api;
  if (api) reviewCheck.checked = !!api.asc_IsTrackRevisions();
  reviewCheck.addEventListener('change', () => {
    getEditorApi()?.asc_SetTrackRevisions(reviewCheck.checked);
  });

  panel.append(header, settings, toolbar, conversation, inputRow);
  document.body.append(panel, launcher);
  return panel;
}
