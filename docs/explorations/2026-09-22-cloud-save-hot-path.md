# 云端 Save 热路径：两跳到极限（客户端能做的）

## 背景

实测一次热保存（~8 KB xlsx，x2t 已热）到 SFO Appwrite：

| 步骤 | ms |
|------|-----|
| export | 238 |
| GET /account ×2 | 270+187 |
| GET document | 246 |
| DELETE file | 263 |
| POST createFile | 815 |
| PATCH document | 193 |
| **合计** | **~2.2 s** |

瓶颈是串行 RTT，不是 x2t。

## 极致客户端方案（已落地）

1. **热上下文**：打开时把 `userId` + `fileId` 绑进 binding；Save 不再
   `Account.get` / `getDocument`。
2. **轮转 fileId**：`createFile(新 id)` → `updateDocument({ fileId })` →
   **后台** `deleteFile(旧 id)`。DELETE 移出关键路径；下载 URL 也变了，顺带
   缓解同 URL 缓存旧字节。
3. **正确性顺序**：必须先上传成功再改行指针；上传失败时旧文件仍在。PATCH
   失败会留下孤儿新文件，行仍指旧文件，用户可重试。

热路径只剩 **createFile + updateDocument**（约 815+193 ≈ 1.0 s 网络），相对
原先 Appwrite 段约砍半，并去掉 ~0.7 s 的鉴权/读行。

## 再往上只有换拓扑

客户端再也压不出「一跳写完」：Appwrite 没有 content-overwrite，也没有把
create+patch 合成一个浏览器 API。更极致需要：

- Appwrite 区域迁到离用户更近；或
- 自建 Edge Function：浏览器一次 POST，函数在机房内完成 create+patch+delete。

那两件是基础设施，不在本仓库热路径里假扮。
