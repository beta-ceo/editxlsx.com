import { MessageCodec, Platform, getAllQueryString } from 'ranuts/utils';
import type { MessageHandler } from 'ranuts/utils';
import { showLoading } from './lib/loading';
import { handleDocumentOperation, initX2T } from './lib/x2t';
import { getDocmentObj, setDocmentObj } from './store';
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
      removeLoading();
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

const { removeLoading } = showLoading();

export const getFileName = (res: Response): string => {
  // 获取文件名
  let fileName: string = Math.random().toString(36).substring(2, 15);
  // 2. 如果没有 filename 参数，尝试从 URL 末尾解析
  if (!fileName) {
    const match = decodeURIComponent(file).match(/\/([^/?#]+)$/);
    if (match && match[1].includes('.')) {
      fileName = match[1];
    }
  }

  // 3. 如果 URL 也解析失败，尝试从 Content-Disposition 响应头获取
  if (!fileName) {
    const disposition = res.headers.get('Content-Disposition');
    if (disposition) {
      const match = disposition.match(/filename\*=UTF-8''(.+)|filename="?([^"]+)"?/);
      if (match) {
        fileName = decodeURIComponent(match[1] || match[2]);
      }
    }
  }
  return fileName;
};

const onCreateNew = async (ext: string) => {
  setDocmentObj({
    fileName: 'New_Document' + ext,
    file: undefined,
  });
  await initX2T();
  const { fileName, file: fileBlob } = getDocmentObj();
  await handleDocumentOperation({ file: fileBlob, fileName, isNew: !fileBlob });
  removeLoading();
};
// example: window.onCreateNew('.docx')
// example: window.onCreateNew('.xlsx')
// example: window.onCreateNew('.pptx')
window.onCreateNew = onCreateNew;

const onOpenDocument = async () => {
  return new Promise((resolve) => {
    // 创建文件选择器，选择 Office 文档
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.docx,.xlsx,.pptx,.doc,.xls,.ppt';
    input.style.setProperty('visibility', 'hidden');
    document.body.appendChild(input);
    input.onchange = async (event) => {
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
        removeLoading();
        resolve(true);
        document.body.removeChild(input);
      }
    };
  });
};
if (!file) {
  await onOpenDocument();
} else {
  setDocmentObj({
    fileName: Math.random().toString(36).substring(2, 15),
    url: file,
  });
}
