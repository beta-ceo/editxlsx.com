# OnlyOffice Web

🌐 **在线体验**: https://ranuts.github.io/document/

[English](readme.md) | [中文](readme.zh.md)

基于 OnlyOffice 的本地网页文档编辑器，让您直接在浏览器中编辑文档，无需服务器端处理，保护您的隐私安全。

## ✨ 主要特性

- 🔒 **隐私优先**: 所有文档处理都在浏览器本地进行，不上传到任何服务器
- 📝 **多格式支持**: 支持 DOCX、XLSX、PPTX、CSV 等多种文档格式
- ⚡ **实时编辑**: 提供流畅的实时文档编辑体验
- 🚀 **无需部署**: 纯前端实现，无需服务器端处理
- 🎯 **即开即用**: 打开网页即可开始编辑文档
- 🌐 **URL 打开**: 通过 URL 参数直接从远程地址加载文档
- 🌍 **多语言支持**: 支持多种语言，轻松切换界面语言

## 🛠️ 技术架构

本项目基于以下核心技术构建：

- **OnlyOffice SDK**: 提供强大的文档编辑能力
- **WebAssembly**: 通过 x2t-wasm 实现文档格式转换
- **纯前端架构**: 所有功能都在浏览器中运行

## 📖 使用方法

### 基本使用

1. 访问 [在线编辑器](https://ranuts.github.io/document/)
2. 上传您的文档文件或从 URL 打开文档
3. 直接在浏览器中编辑
4. 下载编辑后的文档

### URL 参数

编辑器支持以下 URL 参数以增强功能：

#### `locale` - 语言设置

设置编辑器的界面语言。

- **可选值**: `en` (英文), `zh` (中文)
- **默认值**: 浏览器语言或 `en`
- **示例**:
  - `?locale=en` - 英文界面
  - `?locale=zh` - 中文界面

#### `src` - 从 URL 打开文档（推荐）

直接从远程 URL 加载并打开文档。

- **类型**: 字符串 (URL)
- **优先级**: 当 `file` 参数未提供时使用
- **示例**:
  - `?src=https://example.com/document.docx`
  - `?src=https://example.com/spreadsheet.xlsx`
  - `?src=https://example.com/presentation.pptx`

#### `file` - 从 URL 打开文档（向后兼容）

与 `src` 功能相同，保留用于向后兼容。

- **类型**: 字符串 (URL)
- **优先级**: 高于 `src`（如果同时提供，优先使用 `file`）
- **示例**:
  - `?file=https://example.com/document.docx`
  - `?file=https://example.com/spreadsheet.xlsx`

#### 组合使用

可以组合多个参数使用：

- `?locale=zh&src=https://example.com/doc.docx` - 中文界面并打开 URL 文档
- `?locale=en&file=https://example.com/doc.xlsx` - 英文界面并打开 URL 文档

**注意**: 当同时提供 `file` 和 `src` 参数时，`file` 参数优先。

### 作为组件库使用

本项目同时为 [@ranui/preview](https://www.npmjs.com/package/@ranui/preview) WebComponent 组件库提供文档预览组件的基础服务支持。

📚 **预览组件文档**: [https://chaxus.github.io/ran/src/ranui/preview/](https://chaxus.github.io/ran/src/ranui/preview/)

## 🌍 多语言支持

本项目支持多种语言！您可以使用不同语言访问编辑器：

- **English**: [https://ranuts.github.io/document/?locale=en](https://ranuts.github.io/document/?locale=en)
- **中文**: [https://ranuts.github.io/document/?locale=zh](https://ranuts.github.io/document/?locale=zh)

想要添加更多语言支持？非常欢迎您的帮助！欢迎提交 Pull Request。😊

## 🚀 部署说明

- **自动部署**: 当代码推送到主分支时，项目会自动部署到 GitHub Pages
- **手动部署**: 您也可以将项目部署到任何静态网站托管服务

### 重要提示

- **CORS 要求**: 使用 `src` 或 `file` 参数从远程 URL 加载文档时，远程服务器必须支持 CORS（跨域资源共享），否则浏览器会阻止请求。
- **文件大小**: 大文件可能需要较长时间加载，请耐心等待下载过程。
- **支持格式**: DOCX、XLSX、PPTX、CSV、DOC、XLS、PPT、ODT、ODS、ODP、RTF、TXT 等多种格式。

### docker run

```bash
docker run -d --name document -p 8080:8080 ghcr.io/ranui/document:latest
```

### docker compose

```yaml
services:
  document:
    image: ghcr.io/ranui/document:latest
    container_name: document
    ports:
      - 8080:8080
```

## 🔧 本地开发

```bash
# 克隆项目
git clone https://github.com/ranuts/document.git

# 进入项目目录
cd document

# 安装依赖
npm install
# 启动本地开发服务器
npm run dev
```

## 📚 参考资料

- [onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm) - 基于 WebAssembly 的文档转换器
- [se-office](https://github.com/Qihoo360/se-office) - 安全文档编辑器
- [web-apps](https://github.com/ONLYOFFICE/web-apps) - OnlyOffice 网页应用
- [sdkjs](https://github.com/ONLYOFFICE/sdkjs) - OnlyOffice JavaScript SDK
- [onlyoffice-web-local](https://github.com/sweetwisdom/onlyoffice-web-local) - 本地网页版 OnlyOffice 实现

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目！

## 📄 许可证

详情请参阅 [LICENSE](LICENSE) 文件。
