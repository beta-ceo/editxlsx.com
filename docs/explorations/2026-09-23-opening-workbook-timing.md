# Opening workbook… 分段计时（2026-09-23）

## 探针

- `lib/open-timing.ts`：编辑器 iframe 内 mark → `shell:workbook-ready.timing`
- `/workspace` 合并 shell overlay / iframe load，写入 `window.__openTiming` + `console.info('[open-timing]', …)`
- E2E：`cloud-auth.spec.ts`「opens a workbook」断言并打印 report；切换第二本断言 **iframe `src` 不变**（暖宿主）

## 对照组（mock Appwrite，空 xlsx）

| 环境 | overlay | 备注 |
| --- | ---: | --- |
| Playwright preview + warm host | **~260 ms** | `wait shell payload` ≈ 0；二次切换不 remount |

## 优化前 · 真机（串行 iframe：auth → getWorkbook → download）

| 样本 | overlay |
| --- | ---: |
| Untitled / pptx | **~2.9–3.2 s** |

## 优化 1 · 壳并行 handoff（同日）

壳点侧栏即 `getWorkbook`∥`download`，iframe 收 `shell:open-payload`。真机 overlay **~2.0 s**（约 −30%）。

## 优化 2 · 暖 iframe（同日）

- iframe URL 固定 `/editor?shell=1`（不再带 `workbook=`）
- `shell:frame-ready` 后父页 push payload；切换工作簿只重建 DocEditor
- 首次仍付冷启动；**第二次起**省掉整页模块图

真机（localhost + Appwrite SFO）：

| 样本 | overlay | iframe src 复用 |
| --- | ---: | --- |
| 首开 pptx | **~1.2 s** | `/editor?shell=1` |
| 再开 xlsx | **~1.5 s** | 相同 src（未 remount） |

相对最初基线 **~3.0 s → ~1.2–1.5 s**。

实现：`lib/shell-warm-host.ts`、`shell-open-handoff.ts`、`workspace-page.ts`。

## 优化 3 · fileId 内存缓存 + 遮罩阶段文案（同日）

- `lib/workbook-file-cache.ts`：按不可变 Storage `fileId` 缓存字节（最多 8 条 / 64 MiB）
- 命中时跳过 `download` **与** 阻塞式 `getWorkbook`（Documents 后台刷新列表）
- Save 换新 `fileId` 时：编辑器侧 `forget` 旧 id + `put` 新字节；壳在 `shell:save-state=saved` 时 `getWorkbook` 刷新侧栏行
- 遮罩 body：`Downloading from your account…` → `Opening in the editor…`（缓存/pending 命中直接后者）

真机 A→B→A（localhost:5173，同会话）：

| 步 | 样本 | overlay | 遮罩 body |
| --- | --- | ---: | --- |
| A₁ | Untitled.xlsx（冷） | **~1.45 s** | download → editor |
| B | 好的.pptx（冷） | **~2.5 s** | download → editor |
| A₂ | Untitled.xlsx（**cache**） | **~0.53 s** | editor only |

缓存再开相对同本冷开约 **−63%**；相对最初 ~3 s 基线约 **−82%**。

## 下一步（未做）

1. 侧栏 hover prefetch OO 资产（缩短首开后空白）
2. 更早摘罩（DocEditor 构造完成前可先露壳）
