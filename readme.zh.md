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
- 🌍 **多语言支持**: 支持多种语言（英文、中文），轻松切换界面语言

## 📖 使用方法

### 基本使用

1. 访问 [在线编辑器](https://ranuts.github.io/document/)
2. 上传您的文档文件或从 URL 打开文档
3. 直接在浏览器中编辑
4. 下载编辑后的文档

### URL 参数

| 参数 | 说明 | 值/类型 | 优先级 |
|------|------|--------|--------|
| `locale` | 设置界面语言 | `en`, `zh` | - |
| `src` | 从 URL 打开文档（推荐） | URL 字符串 | 低 |
| `file` | 从 URL 打开文档（向后兼容） | URL 字符串 | 高 |

**示例：**

```bash
# 设置语言
?locale=zh

# 从 URL 打开文档
?src=https://example.com/document.docx

# 组合使用
?locale=zh&src=https://example.com/doc.docx
```

**注意**: 当同时提供 `file` 和 `src` 参数时，`file` 参数优先。远程 URL 必须支持 CORS。

### 作为组件库使用

本项目为 [@ranui/preview](https://www.npmjs.com/package/@ranui/preview) WebComponent 组件库提供文档预览组件的基础服务支持。

📚 **预览组件文档**: [https://chaxus.github.io/ran/src/ranui/preview/](https://chaxus.github.io/ran/src/ranui/preview/)

## 🛠️ 技术架构

- **OnlyOffice SDK**: 提供强大的文档编辑能力
- **WebAssembly**: 通过 x2t-wasm 实现文档格式转换
- **纯前端架构**: 所有功能都在浏览器中运行

## 🚀 部署说明

### Docker

```bash
# docker run
docker run -d --name document -p 8080:8080 ghcr.io/ranui/document:latest

# docker compose
services:
  document:
    image: ghcr.io/ranui/document:latest
    container_name: document
    ports:
      - 8080:8080
```

### 重要提示

- **CORS**: 使用 `src` 或 `file` 参数时，远程服务器必须支持 CORS
- **文件大小**: 大文件可能需要较长时间加载
- **支持格式**: DOCX、XLSX、PPTX、CSV、DOC、XLS、PPT、ODT、ODS、ODP、RTF、TXT 等多种格式

## 🔧 本地开发

```bash
git clone https://github.com/ranuts/document.git
cd document
npm install
npm run dev
```

## 📚 参考资料

- [onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm) - 基于 WebAssembly 的文档转换器
- [se-office](https://github.com/Qihoo360/se-office) - 安全文档编辑器
- [web-apps](https://github.com/ONLYOFFICE/web-apps) - OnlyOffice 网页应用
- [sdkjs](https://github.com/ONLYOFFICE/sdkjs) - OnlyOffice JavaScript SDK

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目！

## 📄 许可证

详情请参阅 [LICENSE](LICENSE) 文件。
