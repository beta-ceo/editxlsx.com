# OnlyOffice Web

🌐 **Live Demo**: https://ranuts.github.io/document/

[English](readme.md) | [中文](readme.zh.md)

A local web-based document editor based on OnlyOffice, allowing you to edit documents directly in your browser without server-side processing, ensuring your privacy and security.

## ✨ Key Features

- 🔒 **Privacy-First**: All document processing happens locally in your browser, with no uploads to any server
- 📝 **Multi-Format Support**: Supports DOCX, XLSX, PPTX, CSV, and many other document formats
- ⚡ **Real-Time Editing**: Provides smooth real-time document editing experience
- 🚀 **No Server Required**: Pure frontend implementation with no server-side processing needed
- 🎯 **Ready to Use**: Start editing documents immediately by opening the webpage
- 🌐 **Open from URL**: Load documents directly from remote URLs via URL parameters
- 🌍 **Multi-Language**: Supports multiple languages with easy language switching

## 🛠️ Technical Architecture

This project is built on the following core technologies:

- **OnlyOffice SDK**: Provides powerful document editing capabilities
- **WebAssembly**: Implements document format conversion through x2t-wasm
- **Pure Frontend Architecture**: All functionality runs in the browser

## 📖 Usage

### Basic Usage

1. Visit the [Online Editor](https://ranuts.github.io/document/)
2. Upload your document files or open from URL
3. Edit directly in your browser
4. Download the edited documents

### URL Parameters

The editor supports the following URL parameters for enhanced functionality:

#### `locale` - Language Selection

Set the interface language for the editor.

- **Values**: `en` (English), `zh` (Chinese)
- **Default**: Browser language or `en`
- **Examples**:
  - `?locale=en` - English interface
  - `?locale=zh` - Chinese interface

#### `src` - Open Document from URL (Recommended)

Load and open a document directly from a remote URL.

- **Type**: String (URL)
- **Priority**: Used if `file` parameter is not provided
- **Examples**:
  - `?src=https://example.com/document.docx`
  - `?src=https://example.com/spreadsheet.xlsx`
  - `?src=https://example.com/presentation.pptx`

#### `file` - Open Document from URL (Backward Compatible)

Same functionality as `src`, kept for backward compatibility.

- **Type**: String (URL)
- **Priority**: Higher than `src` (if both are provided, `file` takes precedence)
- **Examples**:
  - `?file=https://example.com/document.docx`
  - `?file=https://example.com/spreadsheet.xlsx`

#### Combined Parameters

You can combine multiple parameters:

- `?locale=zh&src=https://example.com/doc.docx` - Chinese interface with document from URL
- `?locale=en&file=https://example.com/doc.xlsx` - English interface with document from URL

**Note**: When both `file` and `src` are provided, `file` takes priority.

### As a Component Library

This project also provides foundational services for document preview components in the [@ranui/preview](https://www.npmjs.com/package/@ranui/preview) WebComponent library.

📚 **Preview Component Documentation**: [https://chaxus.github.io/ran/src/ranui/preview/](https://chaxus.github.io/ran/src/ranui/preview/)

## 🌍 Multi-Language Support

This project supports multiple languages! You can access the editor in different languages:

- **English**: [https://ranuts.github.io/document/?locale=en](https://ranuts.github.io/document/?locale=en)
- **中文**: [https://ranuts.github.io/document/?locale=zh](https://ranuts.github.io/document/?locale=zh)

Want to add support for more languages? We'd love your help! Feel free to submit a Pull Request. 😊

## 🚀 Deployment

- **Auto Deployment**: The project is automatically deployed to GitHub Pages when changes are pushed to the main branch
- **Manual Deployment**: You can also deploy the project to any static website hosting service

### Important Notes

- **CORS Requirements**: When using `src` or `file` parameters to load documents from remote URLs, the remote server must support CORS (Cross-Origin Resource Sharing). Otherwise, the browser will block the request.
- **File Size**: Large files may take longer to load. Please be patient during the download process.
- **Supported Formats**: DOCX, XLSX, PPTX, CSV, DOC, XLS, PPT, ODT, ODS, ODP, RTF, TXT, and more.

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

## 🔧 Local Development

```bash
# Clone the repository
git clone https://github.com/ranuts/document.git

# Navigate to the project directory
cd document

# Install dependencies
npm install

# Start local development server
npm run dev
```

## 📚 References

- [onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm) - WebAssembly-based document converter
- [se-office](https://github.com/Qihoo360/se-office) - Secure document editor
- [web-apps](https://github.com/ONLYOFFICE/web-apps) - OnlyOffice web applications
- [sdkjs](https://github.com/ONLYOFFICE/sdkjs) - OnlyOffice JavaScript SDK
- [onlyoffice-web-local](https://github.com/sweetwisdom/onlyoffice-web-local) - Local web-based OnlyOffice implementation

## 🤝 Contributing

Issues and Pull Requests are welcome to help improve this project!

## 📄 License

see the [LICENSE](LICENSE) file for details.
