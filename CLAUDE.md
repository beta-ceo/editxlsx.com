# CLAUDE.md — editxlsx 项目指南

## 项目概述

基于 OnlyOffice 的浏览器文档编辑器。编辑与转换仍在访客设备上完成；登录后可把 **Excel 工作簿**存进 Appwrite（Auth + Databases + Storage）。本地打开 / 无账号路径仍然可用。

- **线上**：https://editxlsx.com
- **技术栈**：TypeScript + Vite + ranui（`--ran-*` / `r-*`，无 CSS 框架）+ OnlyOffice Web Apps v9 + Appwrite 客户端 SDK
- **当前产品重心**：云工作簿壳 `/workspace`（侧栏库 + 右侧编辑器 iframe）、`/login`、编辑器 `?workbook=<id>` 的本地优先云同步。见 `docs/explorations/2026-09-21-excel-saas-mvp-appwrite.md` 与 `docs/explorations/2026-09-22-cloud-save-local-first.md`。
- **未做**：计费 UI、分享 / 实时协同、把全部 SEO 落地页改成「必须登录」叙事。

**多会话并行**：不要共用同一个 checkout（HEAD / index / dist / test-results 会互相干扰）。第二个及以后的会话用独立 worktree：`git worktree add .claude/worktrees/<name> -b <topic>`（`.claude/` 已在 `.gitignore`），各自 `pnpm install`、各占一个 `E2E_PORT`。

## 开发命令

```bash
pnpm install --frozen-lockfile   # 安装依赖
pnpm run dev                     # 开发服务器（含热更新）
pnpm run build                   # 生产构建（bin/build.sh）
pnpm run build:single            # 打包为单个 HTML
pnpm run lint:ts                 # oxlint --deny-warnings + tsc --noEmit
pnpm run format:check            # prettier 检查
pnpm run test                    # 单元测试（Vitest）
pnpm run test:coverage           # 带覆盖率
pnpm run test:e2e                # E2E（Playwright，自动 build+preview）——不含 @serial
pnpm run test:e2e:serial         # 时序预算（@serial），单 worker
pnpm run test:e2e:docker         # 同套 E2E 跑在生产 Docker 镜像上
CORPUS_DIR=<本地语料目录> pnpm run test:e2e:corpus
pnpm run lint                    # lint:ts + lint:docker
```

本地 Appwrite 覆盖写在 `.env` / `.env.local`（模板见 `.env.example`）。默认 endpoint / project 已指向 editxlsx Cloud；database / collection / bucket id 硬编码在 `lib/appwrite/ids.ts`（不是密钥）。

## 目录结构

```
lib/
  appwrite/             # 客户端：client / auth / workbooks / empty-xlsx / ids
  auth-page.ts          # /login
  workspace-page.ts     # /workspace：侧栏 + 编辑器 iframe（?shell=1）
  cloud-workbook.ts     # ?workbook= 绑定：Save / 节拍器 → 本地优先再 flush Appwrite
  cloud-pending.ts      # IndexedDB editxlsx-cloud-pending（按 workbookId 只留最新一版）
  shell-bridge.ts       # 壳 ↔ 编辑器 postMessage（ready / failed / save-state）
  converter.ts          # 加载 OnlyOffice API / SheetJS 侧转换
  document.ts           # 打开、新建、URL 加载
  embed-api.ts          # iframe postMessage API
  onlyoffice-editor.ts  # 编辑器生命周期门面（挂载 / 重建 / loadEditorApi）
  onlyoffice/           # 周边：guards/、open-state、save-stream、readonly、…
  history/              # 本地 AutoRecover（IndexedDB，七天，非云盘）
  history-page.ts       # /history
  agent-plugin/         # Agent 面板（editor-bridge / tools / ui）
  web-mcp.ts            # 浏览器 Agent 工具（已上线）
  sw-update.ts          # SW 更新：编辑器侧
packages/               # @ranuts/* workspace
  shared/               # 类型、store、i18n（messages/ 一语言一文件）
  converter/            # X2TConverter / SheetJS / PDF 字体（与 vendor x2t_helper 孪生语义）
  agent-core/ chat-ui/
styles/                 # base / history / workspace / auth / confirm-dialog
public/                 # v9 vendor（sdkjs / web-apps / x2t.wasm.br / fonts）+ SW、落地页
bin/                    # build.sh、pages/、font-*、locale-fill、serve-pages-dev、…
content/<locale>/       # 生成页 markdown 源
docs/                   # embed-api / fonts / plugins / explorations / design-system
index.html              # `/` 静态落地页
editor.html             # `/editor`
login.html / workspace.html / history.html
```

## 路由与云工作簿

| 路由 | 作用 |
| ---- | ---- |
| `/` | 落地页（无编辑器 bundle） |
| `/login` | Appwrite email/password |
| `/workspace` | 已登录工作簿库；未登录重定向 `/login` |
| `/editor` | 编辑器；`?workbook=<id>&shell=1` 由壳嵌入 |
| `/history` | 本机 AutoRecover 列表（noindex） |
| `/help` `/changelog` | 由 `content/` 生成 |

**云保存（改这块前必读）**：

1. 身份是 `?workbook=<id>`，不是文件名。
2. 热路径：导出字节 → `putCloudPending` → 清脏位 → chip「本机已存 · 同步中」→ 后台 `flushCloudPending`（Storage create + Documents update）。不要把 Ctrl+S 做成阻塞式跨洋上传。
3. 打开：`takeCloudPendingIfNewer(id, cloud.updatedAt)`；本地更新才用 pending，否则下云端并丢过期 pending。
4. embed / 只读不写云；无 IndexedDB 时退回阻塞式云写入。
5. 壳与 iframe 经 `shell-bridge` 握手；iframe 启动卡住有 remount / 超时文案（见 `docs/explorations/2026-09-22-workspace-editor-boot-stuck-loading.md`）。

本地打开、`?saved=`、磁盘 File System Access 写回仍是独立路径，不要和云绑定搅在一起。

## 核心模块（编辑器）

### embed-api.ts

触发：`?embed=` / 被 iframe 嵌入。消息：`document:open*`、`set-readonly`、`save`、`get-state`。可用 `?embedOrigin=` 限制来源。完整协议见 `docs/embed-api.md`。

### onlyoffice-editor.ts（门面）

只负责挂载 / 重建 / `loadEditorApi`。状态归属：`open-state.ts`、`readonly.ts`、`save-stream.ts`。厂商运行时补丁 = `onlyoffice/guards/` 新文件 + 在 `iframe-guards.ts` 挂上（编号钉在 `guards-numbering.test.ts`）。别往门面塞逻辑。

### packages/shared store

```ts
const [getDocmentObj, setDocmentObj] = createSignal<{
  fileName: string;
  file?: File;
  url?: string | URL;
}>({ fileName: '' });
```

## 测试

### 单元（Vitest + jsdom）

`test/unit/`。覆盖率门槛全局约 34/25/35/35（以 `test:coverage` 为准，别在本文件维护逐文件数字）。

注意：

- `embed-api` 有模块级单例 → `vi.resetModules()` + 动态 `import()`；别用 `toHaveBeenCalledTimes` 断言残留监听器。
- `requestSaveDocument` 要配合 fake timers 清超时。
- 改 `packages/converter/src/**` 后先 `pnpm --filter @ranuts/converter run build`（用例从 `dist` 导入）。
- 云相关：`cloud-workbook` / `cloud-pending` / `appwrite-workbooks`；无 binding 时 `writeCloudWorkbook` 必须是 no-op。

`onlyoffice/guards/**` 与编辑器回调不靠单测堆覆盖——走 E2E。别为了覆盖率去 mock DocsAPI。

### E2E（Playwright）

`playwright.config.ts`（默认 4173；`E2E_PORT` 隔离 `dist-e2e-<port>/` 与 `test-results-<port>/`；`E2E_BASE_URL` 打已部署站）。另有 pages / docker / browsers / prod 配置。

主回归靠 `embed-regression`（真实编辑器 + 真实 x2t）。云鉴权冒烟：`cloud-auth.spec.ts`（匿名 `/workspace` → `/login` 等）。语料：`CORPUS_DIR=…` 才跑，未设则 skip。

**Harness 硬规则**（踩过会把失败伪装成超时）：

1. 投递字节禁止 `page.route`（SW 接管后 route 失效）——用 `setInputFiles` / `document:open-file` / `page.evaluate`。
2. 调 `asc_DownloadAs` 前等 `isDocumentLoadComplete && isLoadFullApi`。
3. 跨 frame 别用 `instanceof ArrayBuffer`；用 `Object.prototype.toString`。
4. 找编辑器窗口用注入的 `window.__ooFrames`（`test/e2e/lib/frames.ts`），别手抄遍历。
5. 全部从 `test/e2e/lib/l0.ts` 导入 `test`/`expect`；预期错误显式 allow。
6. `post()` 类型只在 `test/e2e/lib/embed-demo.d.ts` 声明一次。
7. 并行会话必须各占 `E2E_PORT`；杀干净残留 preview，否则 `reuseExistingServer` 会测到旧构建。

Opt-in：`SLOW_NET` / `API_SWEEP` / `SHORTCUT_SWEEP` / `UI_CRAWL` / `MONKEY` / `CORPUS_*`。夜间 workflow：cross-browser 每天、corpus 周日；`@serial` 必须与并行半成对（`workflow-contract.test.ts` 钉住）。

## CI（`.github/workflows/ci.yml`）

lint / e2e / e2e-docker / e2e-pages 并行起跑（e2e **不等** lint）。E2E 用 matrix 分片；**改分片数要同时改 matrix 与 `--shard=N/M` 的 M**。docker 分片必须 `sh ./bin/test-e2e-docker.sh --shard=…`（经 pnpm 会吞参数）。`@serial` 第二趟 `--workers=1`；pages/docker 直接 invert 掉时序预算。

共用 setup：`.github/actions/setup`；浏览器安装走 `.github/scripts/install-playwright.sh`；wrangler 经 `bin/serve-pages-dev.sh`（固定 compatibility-date）。约定由 `test/unit/workflow-contract.test.ts` 钉死。细节见 `docs/explorations/2026-08-19-ci-workflow-hardening.md`。

## 多语言（站点 7 种）

`SHELL_LOCALES`（`packages/shared/src/i18n.ts`）= `bin/pages/locales.mjs` 的 `LOCALES` = `content/<locale>/` = README 数字。**四处必须一致。**

- 加语言 = 新 `content/<locale>/` + `LOCALES` + UI 表 + sitemap/llms.txt；先确认 vendor 有对应语言包（45 个）。
- 首页编辑器链接必须带 `?locale=`（站点语言 ↔ 编辑器语言的唯一线）。
- RTL 未做：物理方向属性仍在；上 ar/he/ur 前先改逻辑属性。

## 代码规范

- **注释与代码内字符串一律英文**（含测试标题）。中文只在：zh-CN i18n、`public/zh-CN/**`、语言切换器自称、`docs/**`、本文件。共用 demo 页用英文。
- **Lint**：oxlint + TS 严格；`lint:ts` 带 `--deny-warnings`。ignore **只排除 vendor 树**，不要忽略整个 `public/**`（`sw.js` / `sw-register.js` 等是我们的）。
- **格式**：prettier。**路径别名**：`@/*`（无 `baseUrl`）。
- **隐私红线**（公开仓库）：禁止入库本机绝对路径、用户名、邮箱、凭据、第三方个人身份；例外仅 `chaxus` / `ranuts` 公开组织与仓库。

## ran 生态优先

优先 ranui 组件 / builder、`--ran-*` token、`ranuts/utils`（含 zip / base64 / 嗅探 / `saveFileToDisk`）。不够用时改 `chaxus/ran` 沉淀，别在本仓堆 workaround。

版式：两档宽度（1152 / 720），由布局形态决定；`/editor` 与 `/workspace` 是全屏应用，不在两档里。见 `docs/design-system.md`；`design-contract.test.ts` 钉死。

## 重要约定

1. **不锁工具版本**：CI 里 pnpm `latest`、Node `lts/*`。
2. **SW 两个版本戳**：`CACHE_VERSION`（构建戳 → core cache）与 `VENDOR_VERSION`（vendor 内容哈希 → runtime cache）。哈希必须在 `$DIST_DIR` **里面**算。vendor 真变了才走慢路径协调提升；落地页（`sw-register.js`）与编辑器（`sw-update.ts`）两侧缺一不可。改命名 / 提升判据前读 `docs/explorations/2026-08-20-service-worker-update-never-promoted.md` 与 `2026-08-23-promotion-without-reload-blank-editor.md`。新增固定名部署耦合脚本必须进 `_headers` no-cache 与 `DEPLOY_COUPLED`。
3. **用例固化**：缺陷 / 新功能附自动化（E2E 优先）；新用例做反向验证（去掉修复应变红），结论写进 PR / explorations。
4. **本地历史是 AutoRecover 不是 AutoSave**：只进本机 IndexedDB，不碰用户磁盘、不清未保存提示。身份 `?saved=<id>`；七天过期；禁止私自 `asc_DownloadAs`；embed/只读不写。见 `docs/explorations/2026-08-22-autosave-history-implementation.md`。
5. **循环依赖**：`setConverterCallbacks` / `setUICallbacks` 注入解耦。编辑器创建走操作队列。
6. **结构化数据**：固定 `@id` 的图（`/#organization` 等），app 的 `url` 恒为站点根；见 `docs/explorations/2026-08-23-entity-graph-from-apple.md`。

## 编辑器 / vendor 硬约束（改集成前）

完整考古在 `docs/explorations/`；这里只列仍会害死人的规则：

- **唯一路径是 v9**（`public/`）。别再写 Docs Server MockSocket——vendor 已有进程内应答器；x2t 接缝是 `AscCommon.x2t`（我们的 `x2t_helper.js`）。钉：`offline-seam.spec.ts`。
- **x2t 以 `x2t.wasm.br` 发布**，三处声明 `Content-Encoding: br`。扩展名保持 `.br`，且 `_headers` **不要**给它 `Content-Type: application/wasm`（否则 wrangler pages 会二次压缩）。契约钉的是解压后 sha256。加载失败要报两次（rethrow + 通知 `doInitialize`）。`x2t_helper.js` 与 `packages/converter` 加载语义必须一致（`x2t-loader-parity.test.ts`）。
- **转换跑在 worker**（守卫 14）；别 transfer 编辑器活着的 `Editor.bin`；跨 realm 别 `instanceof`；收集字体前 `waitForFontSystem`。
- **283 MB initial 不是可调参数**（`node bin/x2t-memory-report.mjs`）。OOM 分类为 `environment`，排在 `Conversion failed with code` 之后、`Aborted(` 之前。探测勿与重开抢内存。
- **运行时只读**：挂载永远 `edit: true`，之后 `asc_setRestriction(128)`。别改回 view 模式挂载。
- **CSV**：打开前 SheetJS→XLSX，保存再转回；编码嗅探 fatal UTF-8 → GB18030 → latin1。
- **locale 缺键**：`bin/locale-fill.mjs`（build 前）+ 守卫 11 `hint-fallback`；vendor 升级后必须重跑。
- **字体**：XOR catalog；位置 P 的文件 family 必须属于指向 P 的 `__fonts_infos` 行；新增 family = 位置 + infos + selection_bin + 缩略图精灵瓦片（改完跑 `node bin/font-thumbnails.mjs`）。CJK 导 PDF 必须 TrueType（glyf），不能 CFF。槽位号三处联动：`PDF_FONT_MANIFEST`、`landing-prefetch.js` CORE、`landing-prefetch.spec.ts`。详见 `docs/fonts.md` 与 `docs/changelogs/2026-08-22-font-licensing.md`。
- **插件**：框架活着，但仓库不内置 `sdkjs-plugins/`；**绝不能从 URL 读 `pluginsData`**（等于允许任意同源脚本注入）。见 `docs/plugins.md`。
- **WebMCP**：已在 `lib/web-mcp.ts`；仅顶层窗口；结果可 JSON 序列化；扩展名表从 `DOCUMENT_TYPE_MAP` 派生。

深入历史与战役台账（按需，不是日常入口）：`docs/changelogs/`、`docs/test-matrix.md`、`docs/superpowers/plans/`。
