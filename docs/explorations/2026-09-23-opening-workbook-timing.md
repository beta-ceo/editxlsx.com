# Opening workbook… 分段计时（2026-09-23）

## 探针

- `lib/open-timing.ts`：编辑器 iframe 内 mark → `shell:workbook-ready.timing`
- `/workspace` 合并 shell overlay / iframe load，写入 `window.__openTiming` + `console.info('[open-timing]', …)`
- E2E：`cloud-auth.spec.ts`「opens a workbook」断言并打印 report

## 对照组（mock Appwrite，空 xlsx）

| 环境 | overlay | 备注 |
| --- | ---: | --- |
| Playwright preview build | **~265 ms** | 走 `shell:open-payload`（`wait shell payload` ≈ 0） |
| Vite `E2E_BASE_URL=:5173` | **~0.3 s** | 同左 |

## 优化前 · 真机（串行 iframe：auth → getWorkbook → download）

| 样本 | overlay | auth | getWorkbook | download | DocEditor |
| --- | ---: | ---: | ---: | ---: | ---: |
| Untitled.xlsx | **2942** | 290 | 600 | **1007** | 155 |
| 好的.pptx | **3217** | 292 | **1252** | **1401** | 155 |
| Untitled 再开 | **2949** | 424 | 857 | **1400** | 158 |

## 优化后 · 壳并行 handoff（2026-09-23）

壳在点侧栏时就开始 `getWorkbook`∥`download`（列表 `fileId` 先拉，meta 刷新后若 `fileId` 变了再拉一次），iframe 只 `need-payload` → 收字节 → DocEditor。跳过 iframe 内重复的 auth / getWorkbook / download。

| 样本 | overlay | wait shell payload | DocEditor |
| --- | ---: | ---: | ---: |
| 好的.pptx | **2008** | 1323 | 571 |
| （切换再开） | 见网络抖动 | — | — |

相对基线 **~3.0 s → ~2.0 s（约 −30%）**。剩余墙钟仍主要是壳侧 Appwrite RTT（与 iframe boot 重叠后的尾巴）+ DocEditor。

## 实现要点

- `lib/shell-open-handoff.ts` + `shell:need-payload` / `shell:open-payload`
- 独立 `/editor?workbook=`（无壳）仍走原自拉取路径
- 超时未收到 payload → iframe 回退自拉取

## 下一步（未做）

1. 暖 iframe + postMessage 换文档（去掉每次整页重挂）
2. fileId 级短缓存
3. 遮罩进度文案 / 更早摘罩
