/**
 * The homepage template.
 *
 * Not markdown, because it is not prose: every string sits in a fixed slot and
 * the decoration around them is layout. content/<locale>/home.json holds the
 * strings; this holds the structure.
 */
import { ORIGIN } from './constants.mjs';
import { ID, appEntity, siteEntities, sourceEntity } from './entities.mjs';
import { DEFAULT_LOCALE, LOCALES } from './locales.mjs';
import { langMenu } from './chrome.mjs';
import { escapeHtml } from './markdown.mjs';
import { UI } from './ui.mjs';

/**
 * The homepage.
 *
 * It is not prose, so it is not markdown: every string on it sits in a fixed
 * slot, and the decoration around them is layout, not content.
 * content/<locale>/home.json holds exactly the strings; this holds exactly the
 * structure. Adding a language is then one JSON file rather than one more HTML
 * file to keep in step.
 */
export function renderHome({ locale, data, locales }) {
  const L = LOCALES[locale];
  const ui = UI[locale];
  const home = L.home;
  const url = ORIGIN + home;
  const e = escapeHtml;
  const prefix = L.prefix;

  /**
   * Links into the app carry the locale. The app's own i18n resolves its
   * language from `?locale=` first (then cookie, then localStorage, then
   * navigator.language), so without this a visitor who chose Japanese on the
   * site would land in an editor guessing from browser settings.
   */
  const editor = (query) => `/editor?${locale === DEFAULT_LOCALE ? '' : `locale=${locale}&`}${query}`;
  const appPath = (path) => {
    if (locale === DEFAULT_LOCALE) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}locale=${locale}`;
  };
  /** Site pages under a locale prefix; anchors and absolute URLs pass through. */
  const pageHref = (href) => {
    if (!href || href.startsWith('#') || href.startsWith('http')) return href;
    if (href.startsWith('/editor')) {
      const q = href.includes('?') ? href.slice(href.indexOf('?') + 1) : '';
      return editor(q || 'new=xlsx');
    }
    if (href === '/login' || href === '/workspace' || href === '/history') return appPath(href);
    if (prefix && href.startsWith('/') && !href.startsWith(prefix + '/') && href !== prefix + '/') {
      return prefix + href;
    }
    return href;
  };

  const alternates = locales
    .map((l) => `    <link rel="alternate" hreflang="${l}" href="${ORIGIN + LOCALES[l].home}" />`)
    .join('\n');
  const ogAlternates = locales
    .filter((l) => l !== locale)
    .map((l) => `    <meta property="og:locale:alternate" content="${LOCALES[l].og}" />`)
    .join('\n');

  const graph = [
    ...siteEntities(),
    appEntity({
      description: data.description,
      ...(data.featureList ? { featureList: data.featureList } : {}),
      ...(data.ecosystem
        ? { isPartOf: [{ '@id': ID.site }, { '@type': 'SoftwareApplication', ...data.ecosystem }] }
        : {}),
    }),
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: data.title,
      description: data.description,
      inLanguage: L.lang,
      isPartOf: { '@id': ID.site },
      about: { '@id': ID.app },
      primaryImageOfPage: `${ORIGIN}/img/pwa-512.png`,
    },
    // Machine-readable retention answers only — no visible FAQ section on the
    // mock stack. Assistants and the landing-pages contract still need the
    // seven-day promise as FAQPage.
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      inLanguage: L.lang,
      mainEntity: data.faqLd.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
    sourceEntity(),
  ];
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)
    .split('\n')
    .map((line) => '      ' + line)
    .join('\n');

  const navLinks = data.nav
    .map((item) => {
      const href = pageHref(item.href);
      return `            <a class="navlink" href="${e(href)}">${e(item.label)}</a>`;
    })
    .join('\n');

  const checks = data.checks.map((t) => `<span class="check"><i aria-hidden="true"></i>${e(t)}</span>`).join('');

  const lovedChips = data.loved.chips.map((c) => `<span class="chip-logo">${e(c)}</span>`).join('');

  const featIcons = {
    blue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/><path d="M12 12l3.2-3.2"/></svg>`,
    green: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 18h9a4.5 4.5 0 0 0 .4-9 6 6 0 0 0-11.5 1.6A3.8 3.8 0 0 0 7.5 18Z"/></svg>`,
    purple: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3.5 18.5c.6-2.8 2.7-4.5 5.5-4.5s4.9 1.7 5.5 4.5"/><path d="M14 18.5c.4-1.8 1.7-3 3.5-3 1.3 0 2.4.6 3 1.7"/></svg>`,
  };
  const tagIcons = {
    blue: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5 4 8h4l-.5 6.5L12 8H8l.5-6.5Z"/></svg>`,
    green: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.7-3.5A3.5 3.5 0 0 1 13 11.5H4.2A2.8 2.8 0 0 1 2.5 8Z"/><path d="M8 6.5v5M6 9.5l2 2 2-2"/></svg>`,
    purple: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5.5" r="2"/><circle cx="11" cy="6.5" r="1.6"/><path d="M2.5 13c.4-1.8 1.8-3 3.5-3s3.1 1.2 3.5 3"/><path d="M9.5 13c.3-1.2 1.2-2 2.3-2 .9 0 1.6.4 2 1.1"/></svg>`,
  };
  const featureCards = data.features.items
    .map(
      (item) => `          <article class="feat-card tone-${e(item.tone)}">
            <span class="feat-icon" aria-hidden="true">${featIcons[item.tone] || featIcons.blue}</span>
            <h3>${e(item.h3)}</h3>
            <p>${e(item.p)}</p>
            <span class="feat-tag"><span class="feat-tag-ico" aria-hidden="true">${tagIcons[item.tone] || tagIcons.blue}</span>${e(item.tag)}</span>
          </article>`,
    )
    .join('\n');

  const bentoSnippets = {
    library: `<div class="snip">
              <div class="snip-rows">
                <div class="snip-row"><span class="snip-ico sync" aria-hidden="true"></span><span class="snip-main">sample_workbook.xlsx</span><span class="snip-side">just now</span></div>
                <div class="snip-row"><span class="snip-ico sync" aria-hidden="true"></span><span class="snip-main">Q3_forecast.xlsx</span><span class="snip-side">synced</span></div>
                <div class="snip-row"><span class="snip-ico sync" aria-hidden="true"></span><span class="snip-main">hiring_plan.xlsx</span><span class="snip-side">autosaved</span></div>
              </div>
            </div>`,
    formats: `<div class="snip">
              <div class="snip-chips">
                <span>.xlsx</span><span>.docx</span><span>.pptx</span><span>.pdf</span>
              </div>
            </div>`,
    access: `<div class="snip">
              <div class="snip-rows">
                <div class="snip-row"><span class="snip-main">Signed in</span><span class="snip-side accent">Cloud sync + autosave</span></div>
                <div class="snip-row"><span class="snip-main">Local only</span><span class="snip-side ok">View &amp; edit on device</span></div>
                <div class="snip-row"><span class="snip-main">Recovery</span><span class="snip-side">7-day local copies</span></div>
              </div>
            </div>`,
    offline: `<div class="snip">
              <div class="snip-metrics">
                <span><b>100%</b><em>local continuity</em></span>
                <span><b>0</b><em>lost keystrokes*</em></span>
                <span><b>&lt;1s</b><em>reopen path</em></span>
              </div>
            </div>`,
  };

  const bentoCards = data.essentials.items
    .map((item) => {
      const snip = bentoSnippets[item.snippet] || '';
      return `          <article class="bento-card tone-${e(item.tone)} snip-${e(item.snippet)}">
            <span class="bento-label">${e(item.label)}</span>
            <h3>${e(item.h3)}</h3>
            <p>${e(item.p)}</p>
            ${snip}
          </article>`;
    })
    .join('\n');

  const bandChecks = data.band.checks
    .map((t) => `<span class="check"><i aria-hidden="true"></i>${e(t)}</span>`)
    .join('');

  const docRows = data.docwin.rows
    .map((row) => {
      const cells = row.map((c, i) => `<td class="${i === 3 ? 'num' : ''}">${e(c)}</td>`).join('');
      return `                <tr>${cells}</tr>`;
    })
    .join('\n');
  const docCols = data.docwin.cols.map((c) => `<th>${e(c)}</th>`).join('');

  const footLink = (l) => {
    const href = pageHref(l.href);
    const rel = href.startsWith('http') ? ' rel="noopener"' : '';
    return `<a href="${e(href)}"${rel}>${e(l.label)}</a>`;
  };
  const footColumns = data.foot.columns
    .map((col) => {
      const items = col.links.map((l) => `                <li>${footLink(l)}</li>`).join('\n');
      return `              <div class="foot-col">
                <h3>${e(col.title)}</h3>
                <ul>
${items}
                </ul>
              </div>`;
    })
    .join('\n');
  const footMeta = (data.foot.meta || []).map((l) => footLink(l)).join('\n              ');

  return `<!doctype html>
<!-- GENERATED by bin/build-pages.mjs from content/${locale}/home.json -- edit the JSON, not this file. -->
<html lang="${L.lang}" dir="${L.dir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="/img/64.png" rel="shortcut icon" />
    <link rel="icon" type="image/png" href="/img/64.png" />
    <link rel="manifest" href="/manifest.json" />
    <!-- Route split: this is a static landing page, /editor hosts the app. Deep
         links that used to target it (?file= ?src= ?new= ?open=local ?embed=
         ?embedded= ?readonly ?agent) and any embedding iframe keep working:
         hand them to /editor with the same query before anything renders. -->
    <script>
      (function () {
        try {
          var q = location.search;
          var deep = /[?&](file|src|new|open|workbook|embed|embedded|readonly|agent)(=|&|$)/.test(q);
          var framed = window.parent !== window;
          if (deep || framed) {
            location.replace('/editor' + (q || (framed ? '?embed=1' : '')) + location.hash);
          }
        } catch (e) {}
      })();
    </script>
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />

    <title>${e(data.title)}</title>
    <meta name="description" content="${e(data.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
${alternates}
    <link rel="alternate" hreflang="x-default" href="${ORIGIN + LOCALES[DEFAULT_LOCALE].home}" />
    <script>
      try {
        var t = localStorage.getItem('ran-theme');
        if (t === 'dark' || t === 'light') {
          document.documentElement.setAttribute('data-ran-theme', t);
          document.documentElement.setAttribute('theme', t);
        }
      } catch (e) {}
    </script>
    <link rel="stylesheet" href="/ran-fonts/fonts.css" />
    <link rel="stylesheet" href="/ran-tokens.css" />
    <link rel="stylesheet" href="/brand-tokens.css" />
    <link rel="stylesheet" href="/home.css" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Online Document Editor" />
    <meta property="og:locale" content="${L.og}" />
${ogAlternates}
    <meta property="og:title" content="${e(data.title)}" />
    <meta property="og:description" content="${e(data.ogDescription || data.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${ORIGIN}/img/pwa-512.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${e(data.title)}" />
    <meta name="twitter:description" content="${e(data.ogDescription || data.description)}" />
    <meta name="twitter:image" content="${ORIGIN}/img/pwa-512.png" />

    <script type="application/ld+json">
${jsonLd}
    </script>

    <script src="/ranui-iife/button.iife.js" defer></script>
    <script src="/ranui-iife/popover.iife.js" defer></script>
    <script src="/ranui-iife/content.iife.js" defer></script>
    <script src="/ranui-iife/theme-switch.iife.js" defer></script>
    <script src="/lang-switch.js" defer></script>
    <script src="/open-local.js" defer></script>
    <script src="/landing-prefetch.js" defer></script>
    <script src="/history-recent.js" defer></script>
    <script src="/home-scroll.js" defer></script>
  </head>

  <body>
    <section id="landing-hero">
      <header class="bar">
        <div class="wrap">
          <a class="brand" href="${home}"><span class="mark" aria-hidden="true"></span><span class="wordmark">${e(ui.siteName)}</span></a>
          <nav class="products" aria-label="${e(ui.productsAria)}">
${navLinks}
          </nav>
          <nav class="utils">
${langMenu(locale, locales, ui, (l) => LOCALES[l].home)}
            <r-theme-switch class="theme-switch" label="${e(ui.themeLabel)}"></r-theme-switch>
            <a class="nav-login" href="${e(appPath('/login'))}">${e(data.navActions.logIn)}</a>
            <a class="nav-cta" href="${e(appPath('/login'))}"><r-button type="primary">${e(data.navActions.getStarted)}</r-button></a>
          </nav>
        </div>
      </header>

      <main>
      <div class="hero wrap">
        <span class="hero-badge reveal d1">${e(data.badge)}</span>
        <h1 class="reveal d2">${e(data.h1.plain)} <span class="accent">${e(data.h1.accent)}</span></h1>
        <p class="sub reveal d3">${e(data.sub)}</p>
        <div class="cta reveal d4">
          <button type="button" id="hero-open" data-open-local="${editor('open=local')}">
            <r-button type="primary">${e(data.cta.open)}</r-button>
          </button>
          <a href="${editor('new=xlsx')}" data-prefetch="xlsx" id="hero-new-xlsx"
            ><r-button>${e(data.cta.xlsx)}</r-button></a
          >
        </div>
        <div class="checks reveal d5">${checks}</div>
        <div class="cta-local reveal d5">
          <a class="cta-local-link" href="${e(appPath('/login'))}" id="hero-sign-in">${e(data.cta.signIn)}</a>
          <span class="cta-local-sep" aria-hidden="true">·</span>
          <a class="cta-local-link" href="${e(appPath('/workspace'))}" id="hero-workspace">${e(data.cta.files)}</a>
        </div>
        <div class="recent reveal d5">
          <span data-recent-slot data-recent-label="${e(data.recent.label)}" hidden></span>
          <span class="recent-note">${e(data.recent.note)}</span>
          <a class="recent-all" href="${e(appPath('/history'))}">${e(data.recent.all)}</a>
          ·
          <a class="recent-all" href="${e(appPath('/workspace'))}">${e(data.recent.cloud)}</a>
        </div>
      </div>

      <div class="preview wrap reveal d3">
        <div class="docwin" aria-hidden="true">
          <div class="dw-bar">
            <span class="dw-dots"><i></i><i></i><i></i></span>
            <span class="dw-file">${e(data.docwin.file)}</span>
            <span class="dw-pill eng">${e(data.docwin.engine)}</span>
            <span class="dw-pill ok">${e(data.docwin.encrypted)}</span>
            <span class="dw-pill mute">${e(data.docwin.saved)}</span>
            <span class="dw-actions">
              <span class="dw-btn share">${e(data.docwin.share)}</span>
              <span class="dw-btn export">${e(data.docwin.export)}</span>
            </span>
          </div>
          <div class="dw-ribbon">
            <span class="on">Home</span><span>Insert</span><span>Formulas</span><span>Data</span><span>View</span>
          </div>
          <div class="dw-body">
            <table class="dw-table">
              <thead><tr>${docCols}</tr></thead>
              <tbody>
${docRows}
              </tbody>
            </table>
          </div>
          <div class="dw-net">
            <span class="dw-sheet">${e(data.docwin.sheet)}</span>
            <span>${e(data.docwin.meta)}</span>
            <span class="dw-sync"><i class="ok"></i>${e(data.docwin.sync)}</span>
          </div>
        </div>
      </div>

      <div class="loved wrap">
        <p class="loved-label">${e(data.loved.label)}</p>
        <div class="loved-chips">${lovedChips}</div>
      </div>

      <div class="section features-sec wrap" id="features">
        <div class="section-head center">
          <span class="eyebrow">${e(data.features.eyebrow)}</span>
          <h2>${e(data.features.h2)}</h2>
          <p class="head-note">${e(data.features.p)}</p>
        </div>
        <div class="feat-grid">
${featureCards}
        </div>
      </div>

      <div class="essentials" id="essentials">
        <div class="wrap">
          <div class="section-head left">
            <span class="eyebrow">${e(data.essentials.eyebrow)}</span>
            <h2>${e(data.essentials.h2)}</h2>
            <p class="head-note">${e(data.essentials.p)}</p>
          </div>
          <div class="bento">
${bentoCards}
          </div>
        </div>
      </div>

      <div class="wrap band-wrap">
        <div class="band">
          <div class="band-inner">
            <span class="band-eyebrow">${e(data.band.eyebrow)}</span>
            <h2>${e(data.band.h2)}</h2>
            <p>${e(data.band.p)}</p>
            <div class="band-cta">
              <a class="band-primary" href="${editor('new=xlsx')}" data-prefetch="xlsx">${e(data.band.primary)}</a>
              <a class="band-secondary" href="${e(appPath('/login'))}">${e(data.band.secondary)}</a>
            </div>
            <div class="checks band-checks">${bandChecks}</div>
          </div>
        </div>
      </div>

      </main>

      <footer class="foot">
        <div class="wrap foot-inner">
          <div class="foot-top">
            <div class="foot-brand">
              <a class="brand" href="${home}"><span class="mark" aria-hidden="true"></span><span class="wordmark">${e(ui.siteName)}</span></a>
              <p>${e(data.foot.blurb)}</p>
            </div>
            <nav class="foot-cols" aria-label="Footer">
${footColumns}
            </nav>
          </div>
          <div class="foot-bottom">
            <p class="foot-copy">${e(data.foot.copy)}</p>
            <nav class="foot-meta" aria-label="Legal">
              ${footMeta}
            </nav>
          </div>
          <p class="tm">${e(ui.trademark)}</p>
        </div>
      </footer>
    </section>

    <script src="/sw-register.js" defer></script>
  </body>
</html>
`;
}
