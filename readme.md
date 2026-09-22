# editxlsx

Online Excel and document editor powered by OnlyOffice. Sign in to sync `.xlsx`
workbooks to your account, or open a local file in the browser with no account.

Editing and conversion still run in the tab (OnlyOffice + WASM). Cloud storage
uses [Appwrite](https://appwrite.io) Auth, Databases, and Storage.

**Live:** [editxlsx.com](https://editxlsx.com)

---

## Features

- **Cloud workbooks** — sign in, browse `/workspace`, Save / Ctrl+S and autosave
  sync `.xlsx` to your account (local-first: bytes land on device first, then
  flush to the cloud)
- **Local path stays** — open or create a file without an account; Chromium can
  write back to the file you picked; recovery copies stay in this browser for
  7 days ([details](#data))
- **Real editing** — DOCX, XLSX, PPTX, CSV, ODF, RTF, TXT, legacy binaries; PDF
  annotate / fill / export
- **Offline-capable** — installable PWA; local editing works after the first visit
- **7 languages** — English, 中文, 日本語, Deutsch, Español, 한국어, Português
  (editor UI also ships 45 vendor locales)
- **Embeddable** — postMessage API for iframe hosts
- **Static deploy** — `dist/` behind any web server; Docker image available

---

## Quick start

```bash
git clone https://github.com/ranuts/document.git
cd document
cp .env.example .env.local   # optional: point at your Appwrite project
pnpm install
pnpm run dev
```

Without Appwrite env, the editor and local open still work; `/login` and
`/workspace` need a project (defaults in code already target the editxlsx Cloud
project — see `.env.example`).

**Docker (static site only):**

```bash
docker run -d --name document -p 8080:80 ghcr.io/ranuts/document:latest
```

---

## Formats

| Kind          | Edit                   | Also opens                  |
| ------------- | ---------------------- | --------------------------- |
| Documents     | `.docx`                | `.doc` `.odt` `.rtf` `.txt` |
| Spreadsheets  | `.xlsx` `.csv`         | `.xls` `.ods`               |
| Presentations | `.pptx`                | `.ppt` `.odp`               |
| PDF           | annotate, fill, export | `.pdf`                      |

Any of them can export to PDF. CSV encoding is sniffed on open (UTF-8, GB18030,
Latin-1) and kept on the way back out.

Cloud sync today is **`.xlsx` workbooks** only.

---

## Routes

| Route                 | What it is                                      |
| --------------------- | ----------------------------------------------- |
| `/`                   | Landing page (no editor bundle)                 |
| `/login`              | Sign in / sign up (Appwrite email + password)   |
| `/workspace`          | Cloud workbook library (redirects if anonymous) |
| `/editor`             | The editor                                      |
| `/history`            | Local recovery copies in this browser           |
| `/help`, `/changelog` | Generated from `content/`                       |

### `/editor` parameters

| Parameter        | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `workbook=<id>`  | Open a cloud workbook; binds Save and cloud autosave                        |
| `shell=1`        | Embedded by `/workspace` (shell ↔ editor handshake)                         |
| `src=` / `file=` | Open from a CORS-enabled URL (`file=` wins if both are set)                 |
| `new=xlsx`       | Blank document (`docx` / `xlsx` / `pptx`)                                   |
| `saved=<id>`     | Reopen a local recovery row (this browser only)                             |
| `open=local`     | Hand off a file picked on the landing page                                  |
| `readonly=1`     | View only                                                                   |
| `embed=1`        | Host drives the editor over postMessage                                     |
| `locale=zh-CN`   | Interface language                                                          |

---

## Data

Two paths — do not mix them up:

**Signed-in cloud workbooks** live in your Appwrite account (metadata + Storage
object). Save is local-first: the latest bytes go into this browser immediately,
then sync in the background. A mid-upload reload prefers the newer local pending
copy when it is fresher than the cloud.

**Local / anonymous editing** never requires an account. Where the browser
allows it, Save writes back into the file you picked. Separately, AutoRecover
snapshots can sit in IndexedDB for **7 days** (not a backup — export anything
you want to keep). Manage them at [`/history`](https://editxlsx.com/history).
Embed mode does not write local history.

---

## Embedding

```html
<iframe
  id="documentEditor"
  src="https://your-deployment/editor?embed=1"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

```js
iframe.contentWindow.postMessage(
  { id: '1', type: 'document:open-url', payload: { url: 'https://example.com/doc.xlsx' } },
  'https://your-deployment',
);

window.addEventListener('message', (e) => {
  if (e.data?.type === 'document:opened') console.log('Ready to edit');
  if (e.data?.type === 'document:saved') uploadFile(e.data.payload.file);
});
```

→ **[Embed API](docs/embed-api.md)**

Also powers document preview in
[@ranui/preview](https://www.npmjs.com/package/@ranui/preview).

---

## Deploy

```bash
pnpm build   # → dist/
```

Upload `dist/` to Cloudflare Pages, Nginx, Vercel, Netlify, etc.
`public/_headers` is the caching contract (hashed assets immutable; SW never
cached). For Nginx, fall back to `index.html` for unknown routes.

GitHub Pages: `.github/workflows/pages-build-site.yml` on push to `main`.

Docker with TLS / basic auth:

```bash
docker run -d --name document -p 443:443 \
  -v /path/to/certs:/ssl \
  -e SERVER_BASIC_AUTH='user:$2y$...' \
  -e SERVER_HTTP2_TLS=true \
  -e SERVER_HTTP2_TLS_CERT=/ssl/cert.pem \
  -e SERVER_HTTP2_TLS_KEY=/ssl/key.pem \
  ghcr.io/ranuts/document:latest
```

`SERVER_BASIC_AUTH` is a BCrypt hash (double `$` in the shell). Image caching:
`sws.toml`. The image serves the static build; cloud login needs your own
Appwrite project and matching `VITE_APPWRITE_*` at build time.

---

## Development

```bash
pnpm install --frozen-lockfile
pnpm run dev
pnpm run build
pnpm run lint
pnpm run test
pnpm run test:e2e
```

E2E drives the real editor and WASM converter. Agent-facing notes for this repo
live in `CLAUDE.md`. Font catalog: [docs/fonts.md](docs/fonts.md). Design
history for non-obvious choices: `docs/explorations/`.

---

## License

Application code is [MIT](LICENSE). The embedded ONLYOFFICE editors remain
AGPL-3.0 with Ascensio System SIA's Section 7 terms — see [NOTICE](NOTICE).
ONLYOFFICE is a trademark of Ascensio System SIA; this project is not an
official ONLYOFFICE product and is not affiliated with Ascensio System SIA.
