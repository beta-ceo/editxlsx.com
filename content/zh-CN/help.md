---
title: 帮助——在线文档编辑器使用说明
description: 如何在浏览器里打开、编辑、保存 Word、Excel、PowerPoint、CSV 和 PDF；本地与云工作簿、只读与嵌入、离线、隐私边界、错误码与自托管。
eyebrow: 帮助
breadcrumb: 帮助
h1: 帮助
lead: 使用编辑器的实用解答。本地编辑在浏览器标签页内完成，无需账号；登录后可把云工作簿同步到账号。
---

## 本地打开 vs 云工作簿

### 有什么区别？

**本地打开**——从本机选文件（或新建空白）。编辑在标签页内由 OnlyOffice WebAssembly 引擎完成，不会上传。用下载或**文件 → 下载为**取回副本。可选的恢复副本可在本浏览器保留 7 天（[历史](/zh-CN/history)）。

**云工作簿**——登录后使用[我的工作簿](/workspace)。文件在账号中（`?workbook=<id>`）。保存与自动保存会同步到账号，同一本表可跨设备继续。云同步为**每年 $5**。

### 必须注册账号吗？

本地编辑不需要。可免费打开 `.xlsx`。只有需要跟账号走的云工作簿时才登录。

### 什么时候该付每年 $5？

当你需要**同一本**表出现在另一台设备、清过浏览器缓存、或换了浏览器——又不想再买一个 Microsoft 365 / Google Workspace 席位时。本地打开永远免费。付费不会解锁 VBA、Power Query 或多人实时协同。

### 这能完全替代 Excel 吗？

不能。它适合打开附件、日常公式与保留格式的编辑。需要 **VBA 宏**、重度 **Power Query** 或**多人实时协同**时，请用 Excel 或 Google 表格。

## 打开与新建

### 支持打开哪些格式？

Word（`.docx`，以及旧版 `.doc`）、Excel（`.xlsx`，以及旧版 `.xls`）、PowerPoint（`.pptx`，以及旧版 `.ppt`）、CSV（`.csv`）和 PDF（`.pdf`）。点击**打开**选择文件、把文件拖到页面上，或用 `/editor?file=https://…` / `/editor?src=https://…` 传入网址（文件所在服务器需允许跨域请求）。

### 怎么新建文档？

首页的**新建 Excel（本地）**，或直接访问 `/editor?new=docx`、`/editor?new=xlsx`、`/editor?new=pptx`。本地空白文档只存在于你的标签页里，直到你下载它（或登录后保存进云工作簿）。

### 有文件大小限制吗？

本地编辑没有固定上限；整个文档在浏览器里解析、渲染，实际上限取决于设备内存。云端上传可能有工作区里标明的单文件大小限制。

## 编辑与保存

### 怎么保存修改？

**本地路径：**按 **Ctrl+S / ⌘S**，或用**文件 → 下载为**。浏览器把文件交还给你（下载目录）。在**下载为**里选别的格式即可转换（如 DOCX → PDF、XLSX → CSV）。

**云工作簿：**保存与自动保存会写回账号。你随时也可以再导出一份下载。网络不稳时，编辑可先落在本机，再在联网后同步。

### 保存按钮为什么有时是灰的？

编辑器完整加载文档、且你做过修改后，保存按钮才会点亮。如果编辑后仍是灰色，说明文档没有加载完成——看一下右上角的错误提示，并参考下面的错误码一节。

### 能在格式之间转换吗？

可以，在你的设备上完成：打开文档，在**下载为**里选目标格式。Word 可导出 DOCX / PDF / TXT，表格可导出 XLSX / CSV / PDF，演示文稿可导出 PPTX / PDF。CSV 会以表格方式打开，并可存回 CSV。

### 中文 CSV 在别的工具里乱码，这里呢？

编辑器打开 CSV 前会嗅探编码——先严格 UTF-8，再 GB18030（Excel 导出中文时用的"ANSI"编码），最后 Latin-1——所以在别处乱码的文件这里能正常打开。保存时写入带 BOM 的 UTF-8，Excel 直接双击打开不会乱码。

## PDF

### PDF 能做什么？

打开并阅读（滚动、缩放、搜索），添加评论和文字批注，再下载为保留这些批注的 PDF。可填写的表单可以直接填。

### 能像 Word 一样改写 PDF 里已有的正文吗？

不能像流式文本那样改写——PDF 是固定版式格式。要改措辞，请打开原始的 DOCX / XLSX / PPTX，再从它导出新的 PDF。两步都在你的设备上完成。

## 只读与嵌入

### 能以只读方式打开吗？

能。在 `/editor?file=` 链接后加 `&readonly=1`，或通过嵌入 API 发送 `document:set-readonly`。只读可以在运行时随时开关，不需要重新加载文档。

### 能把编辑器放进我自己的网站吗？

能——编辑器就是为 iframe 嵌入设计的，用 `postMessage` 驱动：你的页面自己（带鉴权）取文件，发进 iframe，再收回编辑后的 `File` 上传到你想要的地方。见 [Embed API 参考](/zh-CN/help/embed-api) 与[在线 demo](/embed-demo.html)。适合网盘、LMS、CRM 等需要把字节留在集成方一侧的产品。

## 浏览器 AI 助手（WebMCP）

### 浏览器里的 AI 助手能操作编辑器吗？

在支持的浏览器上可以。编辑器会注册一组 WebMCP 工具，浏览器内的 AI 助手可以直接调用它们来打开、转换、读取和导出文档，而不必去点击界面。本地路径上，一切仍在你的设备上运行——助手触发的就是按钮触发的那套本地代码。

这些工具是 `open_document_url`、`open_document_buffer`、`create_document`、`save_document`、`get_document_text`、`set_readonly` 和 `get_document_state`。

### 哪些浏览器支持？

WebMCP 是 W3C Web Machine Learning 社区组的提案，目前在 Chrome 的 origin trial 中可用，Firefox 和 Safari 尚未表态。浏览器没有提供该 API 时，什么也不会注册、什么也不会变——它是纯增量能力。

### 嵌入的编辑器里也能用吗？

按设计不能。工具只在编辑器作为顶层页面时注册。跨域 iframe 需要嵌入方页面授予 `allow="tools"`，这与嵌入的使用方式冲突——所以如果你嵌入了编辑器，请改用 [Embed API](/zh-CN/help/embed-api) 驱动它。

### 助手能读取文档正文吗？

文字文档可以：`get_document_text` 会返回正文，助手不必导出就能回答关于内容的问题。表格和演示文稿在当前引擎上没有全文读取接口；工具会明确说明这一点（而不是返回一个看起来像"文件是空的"的空结果），并提示改用导出。

## 离线与安装

### 离线能用吗？

本地编辑可以。首次访问后 Service Worker 会缓存编辑器；你可以从浏览器地址栏把它安装为应用（PWA），没有网络也能打开文档。首次打开用了很多字体的文档仍需联网一次去取这些字体，之后它们也会被缓存。向账号刷新云同步时需要网络。

### 怎么拿到最新版本？

站点会在下次访问时自动更新。如果页面像是卡在旧版本，强制刷新（Ctrl+Shift+R / ⌘⇧R），或在浏览器的站点设置里注销 Service Worker。

## 隐私

### 我的文档会被上传吗？

**本地打开：**不会。文档从磁盘读入浏览器标签页，用 WebAssembly 本地处理。你可以在打开、下载时打开网络面板自行核实——源码也以 MIT 开源。

**云工作簿：**登录后，工作簿字节会存进账号以便跨设备同步。该路径是可选的；未登录的本地编辑不会走它。

### 页面会从网络加载什么？

应用本身：编辑器的 JavaScript、WebAssembly 转换器、字体和页面自己的资源——全部来自本站域名——外加一个注重隐私的 Cloudflare Web Analytics 信标（无 Cookie、无跨站追踪）。已登录的云保存会访问账号 API。如果你用自己的 API key 启用了可选的 AI 助手，它的请求会从你的浏览器直接发往你选择的服务商，不经过本站代理。

## 错误

### 提示里的错误码是什么意思？

- **-85**——文件内容与扩展名不符（例如把 HTML 页面存成了 `.xls`，或 `.docx` 其实是 `.doc`）。改名或重新导出。
- **-82**——文件无法转换；可能已损坏、有密码保护，或是引擎不支持的变体。
- **-24 / -25**——编辑器的某个脚本加载失败，通常是网络抖动或缓存了旧版本。强制刷新后重试。
- **80**——转换器内部导出失败。换一个目标格式试试；持续出现请附上文件类型与步骤提 issue。

### 遇到问题去哪里反馈？

到 [GitHub](https://github.com/ranuts/document/issues) 提 issue，写明浏览器与版本、文件类型，以及——如果不涉密——一个能复现问题的文件。最小复现胜过一切描述。

## 自托管

### 能自己部署一份吗？

能。编辑器壳基本是静态站点，任何 Web 服务器都行：`docker run -d -p 8080:80 ghcr.io/ranuts/document:latest`，或 `pnpm run build` 后托管 `dist/` 目录。HTTPS 与基础认证选项见 [README](https://github.com/ranuts/document#readme)，每个版本改了什么见[更新日志](/zh-CN/changelog)。云工作簿需要本产品使用的 Appwrite 项目配置。

## 场景指南

- [不装 Excel 打开 XLSX](/zh-CN/open/xlsx)
- [在 Chromebook 上编辑 XLSX](/zh-CN/edit-xlsx-chromebook)
- [在 Linux 上编辑 XLSX](/zh-CN/edit-xlsx-linux)
- [不用 Microsoft 365 用 Excel](/zh-CN/excel-without-microsoft-365)
- [对比 Excel 网页版](/zh-CN/compare/excel-online)
- [对比 Google 表格](/zh-CN/compare/google-sheets)
- [对比上传型转换工具](/zh-CN/compare/upload-converters)
