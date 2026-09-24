# 廉价 Office 替代：获客落地清单（2026-09-24）

配套实现见首页双路径、SEO lander、`/help` 云/本地 FAQ、登录页 `$5` 文案与本地编辑器轻量云 nudge。

## 人群与漏斗

```
搜索意图 → SEO lander → /editor 本地免费（激活）
                      ↘ /login → /workspace（$5/年意向 → 付费价值）
```

| 人群 | 主路径 | 付费？ |
|------|--------|--------|
| 偶发打开附件 / Chromebook / Linux | 本地 `/editor` | 否 |
| 跨设备个人 | 云工作簿 | $5/年 |
| 嵌入方 | `/embed-document-editor` → `/help/embed-api` | 另议 |

## 关键词簇（优先 en + zh-CN）

**打开 / 免安装**

- `online excel editor`, `edit xlsx online`, `open xlsx without excel`
- `在线编辑Excel`, `不用安装Office`, `免费打开xlsx`

**设备**

- `excel chromebook`, `edit xlsx linux`
- 对应页：`/edit-xlsx-chromebook`, `/edit-xlsx-linux`

**价格 / 对比**

- `excel without microsoft 365`, `excel online alternative`
- `google sheets vs excel editor`, `excel editor no upload`
- 对应页：`/excel-without-microsoft-365`, `/compare/*`

**隐私**

- `private excel editor`, `edit xlsx without uploading`
- 已有：`/private-document-editor`, `/compare/upload-converters`

## 社区发布话术（先修站内再发）

**Show HN / 产品一句话**

> Browser Excel (OnlyOffice WASM): open .xlsx locally for free—no upload, no Office install. Optional cloud sync $5/year. Not a VBA/co-edit replacement.

**Reddit（r/chromeos, r/linux, 隐私向）**

- 讲「邮件附件改一格」场景 + Network 面板可验证不上传。
- 诚实边界：宏 / 重型 Power Query / 实时多人 → 用 Excel 或 Sheets。
- 禁止：「全面替代 Excel / Office」。

**Product Hunt**

- Tagline: Local-first Excel in the browser. Cloud optional at $5/year.
- First comment: link `/compare/upload-converters` + `/help` local vs cloud.

**发布顺序**

1. Phase 0–2 已上线（首页、help、新 lander、sitemap/llms）
2. 再发社区；避免流量进过时「无服务端 / 保存=下载」文案

## 度量

- Search Console：新 slug 展示/点击 vs `/open/xlsx`
- 漏斗：lander → `/editor` → `/login` → `/workspace` 有文档
- 定性：评论是否卡在宏/协同——用诚实边界段落消化
- Analytics：继续用隐私友好的 CF Web Analytics（勿上 GA）

## 已落地 URL（en + zh-CN）

- `/excel-without-microsoft-365`
- `/edit-xlsx-chromebook`
- `/edit-xlsx-linux`
- `/compare/excel-online`
- `/compare/google-sheets`
- `/compare/upload-converters`
