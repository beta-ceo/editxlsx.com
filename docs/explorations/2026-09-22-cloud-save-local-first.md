# 云端 Save：本地先落盘，后台再同步

## 目标

在「整本 xlsx + Appwrite 两跳」物理下限不变时，让 Ctrl+S 的体感接近 Docs：
一点就有「已保存」，跨洋上传不挡编辑、不挡刷新。

## 做法

1. **`editxlsx-cloud-pending` IndexedDB**：按 `workbookId` 只留最新一版字节。
2. **`writeCloudWorkbook`**：先 `putCloudPending` → 清脏位 → chip `local`
   （Saved · syncing…）→ `flushCloudPending()` 不 await。
3. **`flushCloudPending`**：`createFile` + `updateDocument`，成功则清 pending；
   上传期间又有新 Save 则循环再推一版。热路径 `fileId` 用 **live binding**，
   避免并发 Save 指到已删的旧 Storage id。
4. **打开**：`takeCloudPendingIfNewer(id, cloud.updatedAt)`，本地更新时间更新
   才用 pending，否则下云端并丢掉过期 pending。
5. **无 IDB**（隐私模式等）：退回阻塞式云写入，行为与改前一致。

## 反向

去掉 `takeCloudPendingIfNewer` 后：Save → 立刻刷新 → 打开仍是云端旧字节。
去掉 `putCloudPending` 后：chip 不再在上传前进入 `local`。
