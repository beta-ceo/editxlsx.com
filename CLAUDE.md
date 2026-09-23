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

`playwright.config.ts`（默认 4173；`E2E_PORT` 隔离 `dist-e2e/<port>/` 与 `test-results/e2e-<port>/`；`E2E_BASE_URL` 打已部署站）。另有 pages / docker / browsers / prod 配置。

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


