# 2026-09-22 — Cloud documents + nested folders

## What shipped

Vault items in the existing `workbooks` collection can be files (`.xlsx` /
`.docx` / `.pptx`) or folders with arbitrary nesting via `parentId`.

## Appwrite one-time setup (editxlsx / `6aa93e64000c2801517e`)

Collection `editxlsx` / `workbooks`:

| Attribute | Type | Default | Notes |
|-----------|------|---------|--------|
| `kind` | enum `file` \| `folder` | `file` | existing rows inherit default |
| `format` | enum `xlsx` \| `docx` \| `pptx` \| `none` | `xlsx` | folders store `none` |
| `parentId` | string(36) | `''` | root |
| `sortOrder` | integer | `0` | sibling order within `parentId` (asc) |

Index `user_parent` on (`userId`, `parentId`).

Bucket `workbooks` `allowedFileExtensions`: `xlsx`, `docx`, `pptx` (was xlsx-only).

## Client mapping

- Appwrite `format: 'none'` ↔ client `format: ''` on folders.
- `VaultItem` covers both kinds; `Workbook` remains the file-shaped alias used by the editor binding.
- New menu creates into `currentFolderId`; URL uses `?workbook=` for files and `?folder=` for navigation.
- Sidebar is an expandable tree: chevron toggles children in place; folder click sets
  `currentFolderId` and expands that node (ancestors auto-expand for deep selection).
- Folder hover `+` opens the shared New menu anchored under the control.
- Double-click a row (or press F2) to rename inline via `renameVaultItem`.
- Sibling order: `sortOrder` asc, then `$createdAt` desc for legacy ties (all `0`).
  Drag-and-drop reorders siblings and can move into/out of folders (`placeVaultItem` →
  `reorderVaultSiblings`). Drop on folder middle = into; edges = before/after.
- Blank pptx for New presentation uses vendor `sdkjs/slide/themes/src/01_blank.pptx`
  (hand-rolled OOXML lacked slide masters → open code -82 / `reading 'Master'`).
