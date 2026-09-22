# 云端工作簿：Save 后再打开仍是旧内容

## 现象

在 `/workspace` 里改单元格，看到 “Saved to your account”，再点左侧同一文件
（或 Home 后再点开），编辑器里不是刚才改过的版本。

## 根因

保存走 `replaceFile`：同一 `fileId` 先 `deleteFile` 再 `createFile`，下载 URL
不变。Appwrite Storage 的 download 响应带：

```
Cache-Control: private, max-age=3888000
```

（约 45 天。）浏览器按 URL 缓存了**第一次打开**的字节；之后 Save 已把新文件写上
云端，再 `fetch` 同一 URL 仍命中本地缓存。

Toast 是真的写成功了；错在读路径。

## 修复

`downloadWorkbookFile`：

1. `fetch(..., { cache: 'no-store' })` —— 不读、不写 HTTP 缓存；
2. URL 加 `?v=<workbook.updatedAt>`（打开时由 `getWorkbook` 传入），挡住忽略
   `Request.cache` 的中间层。

单测钉住 `cache: 'no-store'` 与 bust query。反向：去掉这两项后，同一 fileId
在带 `max-age` 的响应下会复现旧字节（浏览器里已用真实 header 证实）。
