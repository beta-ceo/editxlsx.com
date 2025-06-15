import { MessageCodec, Platform, getAllQueryString } from 'ranuts/utils';
import type { MessageHandler } from 'ranuts/utils';
import { handleDocumentOperation, initX2T } from './lib/x2t';
import { getDocmentObj, setDocmentObj } from './store';
import 'ranui/button';
import './styles/base.css';

interface RenderOfficeData {
  chunkIndex: number;
  data: string;
  lastModified: number;
  name: string;
  size: number;
  totalChunks: number;
  type: string;
}

declare global {
  interface Window {
    onCreateNew: (ext: string) => Promise<void>;
    DocsAPI: {
      DocEditor: new (elementId: string, config: any) => any;
    };
  }
}

const fileChunks: RenderOfficeData[] = [];

const events: Record<string, MessageHandler<any, unknown>> = {
  RENDER_OFFICE: async (data: RenderOfficeData) => {
    // Hide the control panel when rendering office
    const controlPanel = document.getElementById('control-panel');
    if (controlPanel) {
      controlPanel.style.display = 'none';
    }

    fileChunks.push(data);
    if (fileChunks.length >= data.totalChunks) {
      const file = await MessageCodec.decodeFileChunked(fileChunks);
      setDocmentObj({
        fileName: file.name,
        file: file,
        url: window.URL.createObjectURL(file),
      });
      await initX2T();
      const { fileName, file: fileBlob } = getDocmentObj();
      await handleDocumentOperation({ file: fileBlob, fileName, isNew: !fileBlob });
    }
  },
  CLOSE_EDITOR: () => {
    if (window.editor && typeof window.editor.destroyEditor === 'function') {
      window.editor.destroyEditor();
    }
  },
};

Platform.init(events);

const { file } = getAllQueryString();

const onCreateNew = async (ext: string) => {
  setDocmentObj({
    fileName: 'New_Document' + ext,
    file: undefined,
  });
  await initX2T();
  const { fileName, file: fileBlob } = getDocmentObj();
  await handleDocumentOperation({ file: fileBlob, fileName, isNew: !fileBlob });
};
// example: window.onCreateNew('.docx')
// example: window.onCreateNew('.xlsx')
// example: window.onCreateNew('.pptx')
window.onCreateNew = onCreateNew;

// Create a single file input element
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.docx,.xlsx,.pptx,.doc,.xls,.ppt';
fileInput.style.setProperty('visibility', 'hidden');
document.body.appendChild(fileInput);

const onOpenDocument = async () => {
  return new Promise((resolve) => {
    // 触发文件选择器的点击事件
    fileInput.click();

    fileInput.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        setDocmentObj({
          fileName: file.name,
          file: file,
          url: window.URL.createObjectURL(file),
        });
        await initX2T();
        const { fileName, file: fileBlob } = getDocmentObj();
        await handleDocumentOperation({ file: fileBlob, fileName, isNew: !fileBlob });
        resolve(true);
        // 清空文件选择，这样同一个文件可以重复选择
        fileInput.value = '';
      }
    };
  });
};

// Create and append the control panel
const createControlPanel = () => {
  // 创建控制面板容器
  const container = document.createElement('div');
  container.style.cssText = `
    width: 100%;
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  `;

  const controlPanel = document.createElement('div');
  controlPanel.id = 'control-panel';
  controlPanel.style.cssText = `
    display: flex;
    gap: 10px;
    padding: 10px;
    z-index: 1000;
  `;

  // Create upload button
  const uploadButton = document.createElement('r-button');
  uploadButton.textContent = 'Upload Document';
  uploadButton.addEventListener('click', onOpenDocument);
  controlPanel.appendChild(uploadButton);

  // Create new document buttons
  const createDocxButton = document.createElement('r-button');
  createDocxButton.textContent = 'New Word';
  createDocxButton.addEventListener('click', () => onCreateNew('.docx'));
  controlPanel.appendChild(createDocxButton);

  const createXlsxButton = document.createElement('r-button');
  createXlsxButton.textContent = 'New Excel';
  createXlsxButton.addEventListener('click', () => onCreateNew('.xlsx'));
  controlPanel.appendChild(createXlsxButton);

  const createPptxButton = document.createElement('r-button');
  createPptxButton.textContent = 'New PowerPoint';
  createPptxButton.addEventListener('click', () => onCreateNew('.pptx'));
  controlPanel.appendChild(createPptxButton);

  // 将控制面板添加到容器中
  container.appendChild(controlPanel);

  // 在 body 的最前面插入容器
  document.body.insertBefore(container, document.body.firstChild);
};

// Initialize the containers
createControlPanel();

if (!file) {
  // Don't automatically open document dialog, let user choose
  // onOpenDocument();
} else {
  setDocmentObj({
    fileName: Math.random().toString(36).substring(2, 15),
    url: file,
  });
}
