# /workspace：点工作簿后一直 “Opening workbook…”

## 现象

侧栏点 `Untitled.xlsx`（或进入 `/workspace` 自动打开最新一篇）后，右侧遮罩停在
`Opening workbook…`，编辑器区域空白。再点同一个已选中的文件名也没用。

## 根因

壳页用 iframe 打开 `/editor?workbook=&shell=1`，等 iframe 发
`shell:workbook-ready` 才摘遮罩。

本地复现（`localhost:5173`）时，iframe 里的 `index.ts` **模块图没跑起来**：
`body` 没有 `embed-mode` / `opening-document`，`DocsAPI` 不存在。Performance 里能看到
Vite 优化依赖返回 **504**（例如 `ranuts_utils.js?v=…`、`ranui_message.js?v=…` 带过期
hash）。父页 `/workspace` 已经用新 hash 预优化过，子 frame 第一次导航仍拿到旧 URL，
请求失败后整棵模块树停住——于是永远不会 `postShellReady`。

强制给 iframe 再赋一次 `src` 后立刻恢复（同一次会话里第二次加载依赖已是 200）。

两处产品层缺口放大了这个问题：

1. **没有超时 / 启动失败路径**：遮罩只认 bridge 消息，模块挂了就转圈到天荒地老。
2. **点当前项是空操作**：`paintStage` 见 `dataset.workbook === id` 直接 return，无法手动重试。

生产静态资源没有 Vite 504，但仍可能遇到空白 document / 卡住的打开；超时与重试对两边都有用。

## 修复

`lib/workspace-page.ts`：

- iframe `load` 后轮询 body 是否出现 `opening-document` / `embed-mode`（15s）；没有则
  **自动 remount 一次**（URL 加 `_boot=` 冲掉缓存）。
- 90s 仍无 `shell:workbook-ready|failed` → 错误态文案 `cloudOpenTimedOut`。
- 点**当前**工作簿且状态是 loading/error → 清 `dataset.workbook` 强制再挂。

## 反向验证

`test/e2e/cloud-auth.spec.ts`「blank editor boot auto-retries then opens」：第一次 iframe
导航返回无脚本的空 HTML；去掉 boot remount 后遮罩会一直 `loading`，用例变红。
