# AGENTS.md — AI Coding Agent Instructions for WebPullBook

Authoritative architectural, security, source-of-truth, and workflow instructions for AI coding agents working on **WebPullBook**.

For human contributor guides and parser tutorials, see [CONTRIBUTING.md](CONTRIBUTING.md), [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md), and [docs/READER_PRESETS.md](docs/READER_PRESETS.md).

---

## 1. Project Identity & Stack

- **Purpose:** Open-source cross-browser **Manifest V3** extension (Chrome, Edge, Brave, and Mozilla Firefox 128+) that extracts web novels, light novels, serialized fiction, articles, documentation, and open tabs into volume-organized **EPUB 2**, **EPUB 3**, **Single-File HTML**, **Markdown**, and **Plain Text (TXT)** files locally in the browser.
- **Communication Philosophy:** Quiet design and minimalism (*design silencioso e minimalismo*). Documentation, UI copy, and website text must remain objective, discreet, and honest—never promotional or unverified.
- **Zero Runtime Dependencies:** `dependencies` in [package.json](package.json) is empty (`{}`), with **no build step or bundler**. Vanilla ES modules under `src/` execute directly in the browser. Only test/dev tooling (`jsdom`, `fake-indexeddb`, `@biomejs/biome`, `addons-linter`, `playwright`) is in `devDependencies`.

### Repository Layout

```text
WebPullBook/
├── .github/                  # CI, Release, Pages & CodeQL workflows, Dependabot, templates, SECURITY & CoC
├── _locales/                 # Manifest localization (en, pt_BR)
├── AGENTS.md                 # AI agent rules, architecture & guardrails (this file)
├── CHANGELOG.md              # English release history (parsed by scripts/extract-release-notes.mjs)
├── CHROMEWEBSTORE.md         # Store listing copy, permissions justification & privacy disclosures
├── CONTRIBUTING.md           # Contributor setup, 5-stage pipeline & parser authoring guide
├── LICENSE                   # Project license
├── README.md / README.pt.md  # Primary repository documentation (EN / PT-BR mirrors)
├── manifest.json             # Cross-browser MV3 declaration (Chrome + Firefox gecko)
├── package.json              # Scripts & devDependencies (jsdom, fake-indexeddb, @biomejs/biome, addons-linter, playwright)
├── docs/                     # COMPATIBILITY.md, READER_PRESETS*.md, SEO guide & docs/pt/ mirrors
├── icons/                    # Extension icons (SVG + PNG)
├── scripts/                  # check.mjs (lint), sync-website.mjs, verify-website.mjs, extract-release-notes.mjs
├── src/
│   ├── background/           # MV3 service worker / Firefox background script
│   ├── core/                 # Extraction base, net-fetcher, sanitizer, XHTML, image processor, EPUB, cache & ZIP
│   ├── exporters/            # Polymorphic book exporters (epub, html, md, txt)
│   ├── parsers/              # ParserRegistry, GenericHtmlParser & structural adapters (see docs/COMPATIBILITY.md)
│   └── workspace/            # Extension UI tab, 4 themes, modular controllers & PT/EN locales
├── tests/                    # Split node:test suites, fixtures/, helpers/ & Playwright E2E
└── website/                  # Static bilingual GitHub Pages site (excluded from extension ZIP)
```

---

## 2. Architecture & Critical Contracts

Always inspect the target source file before editing. Key boundaries and invariants:

- **Background ([src/background/service-worker.js](src/background/service-worker.js)):** Opens `workspace.html?url=<tabUrl>&sourceTabId=<tabId>` on toolbar click, refreshes Firefox `declarativeNetRequest` session rule ID `1` (`Origin` removal on cross-origin fetches) on startup and `chrome.permissions.onAdded`, and cleans up orphaned session rules `100..129` when all workspace tabs close.
- **Core (`src/core/`):**
  - `parser-engine.js`: Backwards-compatible barrel facade—preserve existing re-exports when adding core helpers.
  - `base-parser.js` (`BaseParser`) + `parser-helpers.js`: Template Method extraction (`extractJsonLdMetadata`, `extractCommonMetadata`, `collectAllChapters`, `downloadAndParseChapter`), automatic native-adapter fallback when `customListSelector` yields `0` chapters, and shared URL/text/JSON-slice helpers.
  - `net-fetcher.js`: Zero-network active-tab capture (`readOpenTabDocument`), charset-accurate HTTP (`decodeHtmlBytes` / `fetchWithRetry` with request timeout & HTTP-date `Retry-After`), reusable SPA background worker (`TabRenderPool` verifying actual tab URLs), first-page cache (`PageDomCache` keyed by origin/path/search), `assertSafeHttpUrl()`, and per-domain anti-bot circuit breaker (`isSpaDomainCircuitOpen`).
  - `dnr-rules.js`: Serialized (`withDnrLock`) session header rules using IDs `100..119` (navigation) and ref-counted slots `120..129` (image `Referer` hotlink fallback)—never touch Firefox rule ID `1`.
  - `sanitizer.js` (`HtmlSanitizer`) + `xhtml-serializer.js`: Whitelist XHTML sanitizer (strips scripts, handlers, ads, hidden decoy CSS classes, invalid XML 1.0 chars via `stripInvalidXmlChars`; decodes UTF-8 `__cf_email__`; resolves lazy images/comma-safe `srcset`; deduplicates leading headings; prunes dangling `#fragment` links) and strict idempotent XHTML 1.1 / XHTML5 serializer (`normalizeXhtmlForEpub2` + EPUB 3 `<aside epub:type="footnote">`).
  - `image-processor.js`, `epub-builder.js`, `epub-templates.js`, `epub-css.js`, `zip.js`: Strict raster magic-byte MIME sniffing (rejects SVG/HTML/empty payloads), credentialed -> anonymous -> DNR `Referer` image fallback, animated GIF/APNG/WebP detection, white-background JPEG canvas flattening, content-hash deduplication, path-validated ZIP32 `CompressionStream` archive (`mimetype` stored first, deflate error fallback), and internal hyperlink rewriting.
  - `cache-store.js` (`WebPullBookCache` IndexedDB with 7-day TTL, 64 MB single-flight cap, `<parsererror>` hydration guard & `imageFallbacks`), `rate-limiter.js` (`AdaptiveRateLimiter`), `selector-utils.js` (`buildReadableSelector`, `generateCssSelector`), `text-utils.js` (`buildOutputPath`, `toHighResCoverUrl`, volume helpers).
- **Exporters (`src/exporters/`):** `exporterRegistry` (`epub`, `html`, `md`, `txt`) extending `BaseExporter` (`HtmlExporter` escapes `</style>` and scopes per-chapter IDs; cover embeds route through `fetchImageBytes`).
- **Parsers (`src/parsers/`):** `parserRegistry.detectWithScores()` performs single-pass scoring in `loadSeriesWithParser()`, falling back to `TabRenderPool` on empty/403/503 SPA shells (`looksLikeSpaShell`) and resolving cross-domain chapter parsers via `resolveParserForChapterUrl()`. Registered adapters and fixtures live in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Workspace (`src/workspace/`):**
  - `state.js` owns `DEFAULT_OPTIONS`, fixed `READER_PRESETS` (`modern`, `kobo`, `kindle-modern`, `kindle`, `textonly`, `legacy`), and parser-aware `getCacheKey()`.
  - `options-storage.js` enforces `stripSiteScopedOptions()`, `sanitizeImportedOptions()`, and `sanitizeCoverPreviewUrl()`; `domain-rules-ui.js` enforces `sanitizeDomainRules()` and per-series `renderWithTab` scoping.
  - `locales/pt.js` & `locales/en.js` maintain strict PT/EN parity, with `i18n.js` handling `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-aria`, and `data-i18n-alt`.
  - Modular UI controllers (`series-loader.js`, `chapters-ui.js`, `chapter-modals.js` with `pinnedCacheKey` & snapshot restore, `volume-modals.js`, `cover-ui.js`, `export-runner.js`, `library-ui.js`, `library-view.js`, `cache-sessions-ui.js`, `directory-handle.js`, `download-storage.js` with path-traversal validation & lifetime-safe Blob URLs, `domain-rules-ui.js`, `tab-picker.js`, `settings-io.js`, `logger.js` with deferred hidden-tab rendering, `workspace.js`).

---

## 3. Guardrails & Single Sources of Truth

Do **not** edit synced targets directly or duplicate dynamic lists across files. Update the authoritative source and run the corresponding script:

| Artifact / Area | Authoritative Source of Truth | Synced / Verified By | Rule |
| :--- | :--- | :--- | :--- |
| Compatibility tables & summary (`website/{,pt/}compatibility.html`, `index.html`) | [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | `sync-website.mjs`, `verify-website.mjs` | Edit `docs/COMPATIBILITY.md` only; never invent domain names/URLs. |
| Reader Profiles tables (`website/{,pt/}features.html`) | [docs/READER_PRESETS.md](docs/READER_PRESETS.md), [docs/pt/READER_PRESETS.pt.md](docs/pt/READER_PRESETS.pt.md), `READER_PRESETS` ([state.js](src/workspace/state.js)) | `sync-website.mjs`, `verify-website.mjs`, `check.mjs` | Keep presets, both MD docs, and `locales/*.js` keys aligned. |
| Extension version, store & repo URLs, sitemap & robots (`website/**/*.html`, `sitemap.xml`, `robots.txt`, JSON-LD) | [manifest.json](manifest.json), [package.json](package.json), [website/site.config.json](website/site.config.json) | `sync-website.mjs`, `verify-website.mjs`, `check.mjs` | Match `manifest.json` & `package.json` versions; tag official site links with `data-wpb-link`. |
| Parser adapter inventory & regression fixtures | [src/parsers/index.js](src/parsers/index.js), [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md#parser-regression-fixtures) | `tests/parsers.test.js` | Do **not** duplicate per-adapter file lists in `README*.md` or `CONTRIBUTING*.md`. |
| UI localization strings & DOM element IDs | [pt.js](src/workspace/locales/pt.js), [en.js](src/workspace/locales/en.js), `_locales/*/messages.json` | `check.mjs` | Keep exact key parity and verify every `$(id)` exists in `workspace.html`. |
| Primary vs. manual docs (`AGENTS.md`, `CHANGELOG*.md`, `CONTRIBUTING*.md`, `CHROMEWEBSTORE.md`, `docs/pt/`) | Manual edits (validated for links & hygiene) | `check.mjs`, `extract-release-notes.mjs` | Primary repo docs & commits are **English only**; `docs/pt/` holds optional PT-BR mirrors. |

### Prohibited Anti-Patterns

- **No hardcoded dynamic counts:** Never write fixed counts (e.g., `"410 keys"`, `"56 tests"`) into prose docs or `website/` HTML.
- **No client-side repo scraping in `website/`:** Never re-add `raw.githubusercontent.com` fetching (`syncDocsFromRepo`) to `website/assets/js/site.js`; static tables come exclusively from `scripts/sync-website.mjs`.
- **No per-file tree bloat or duplicated helpers:** Reuse `src/core/parser-helpers.js`, `src/core/selector-utils.js`, and `BaseParser` rather than copying helper functions into adapters.
- **No un-sanitized DOM or MV3 CSP violations:** Never bypass `HtmlSanitizer`/`serializeChapterXhtml` or `assertSafeHttpUrl()`; never add inline `<script>`, `on*` handlers, `eval`, `console.log()`, `debugger`, UTF-8 BOM, CRLF endings, or trailing whitespace.
- **No site-name leaks:** Never place compatible site domains or URLs in `docs/COMPATIBILITY.md` or list compatible site names/URLs in `README.md` or `README.pt.md`.
- **Preserve 4 tiers in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md):** Keep `Verified & Tested`, `Added / Not Officially Tested`, `Potentially Compatible`, and `Not Compatible`. Never promote a site to `Verified & Tested` without live E2E verification and regression fixtures.

---

## 4. Security, Privacy & Versioning Rules

- **Privacy:** Zero telemetry or analytics in the extension. Only load user-requested HTTP/HTTPS origins or user-selected open tabs.
- **No Access-Control Circumvention:** Never bypass DRM, paywalls, auth gates, or CAPTCHAs; trip the SPA circuit breaker on challenges and let the user intervene in a normal tab.
- **Versioning (`MAJOR.MINOR.PATCH`):** Do **not** bump `version` in regular PRs unless preparing a release (`MAJOR`: rare milestone; `MINOR`: features/adapters; `PATCH`: fixes).
- **Backward Compatibility:** Preserve `wpbOptions`, `wpbLibrary`, `wpbDomainRules`, `WebPullBookCache` schemas, `READER_PRESETS`, and `src/core/parser-engine.js` exports.

---

## 5. Testing Commands & Validation

**Static scripts (`node scripts/...`) require only Node.js stdlib (`None`); unit tests (`node --test tests/*.test.js`) require `npm ci` / `npm install` (`devDependencies`: `jsdom`, `fake-indexeddb`).**

| Command | Dependencies Required | What It Validates |
| :--- | :--- | :--- |
| `node scripts/sync-website.mjs` | None | Syncs `website/` compatibility/preset tables, `[data-wpb-link]` hrefs, JSON-LD, versions, and git `<lastmod>` from docs/manifest/`site.config.json` (pass `--check` for non-mutating CI drift checks). Must remain idempotent across consecutive runs. |
| `node scripts/verify-website.mjs` | None | Validates 14 bilingual pages plus `404.html`, heading order, links, images, canonicals, `hreflang`, OG/Twitter, JSON-LD, `[data-wpb-link]` parity, unique `sitemap.xml` URLs, version parity, and `robots.txt`. |
| `node scripts/check.mjs` | None | Manifest/package version parity, `_locales/` validation, Firefox MV3 keys, JS syntax (`node --check` incl. `website/assets/js/site.js`), MV3 CSP, EPUB media-type, relative Markdown links, PT/EN i18n & DOM ID parity, LF/whitespace hygiene, `sync-website.mjs --check`, and `verify-website.mjs`. |
| `node --test tests/*.test.js` | `npm ci` (`jsdom`, `fake-indexeddb`; EPUBCheck optional unless `REQUIRE_EPUBCHECK=1`) | Split unit & regression suites (`cache-store`, `epub-validation`, `exporters`, `net-fetcher`, `parsers`, `rate-limiter`, `sanitizer`, `text-utils`, `website-analytics`, `workspace`, `zip`). |
| `npm run lint:biome` | `npm ci` (`@biomejs/biome`) | Targeted static JS analysis (unused vars/imports, undeclared globals, scope/dead-code checks) with formatter disabled. |
| `npm run lint:amo` | `npm ci` (`addons-linter`) + `zip` | Builds compressed extension ZIP (`manifest.json _locales icons src LICENSE README.md README.pt.md`) and validates with Mozilla `addons-linter`. |
| `npm run test:e2e` | `Playwright + Chromium` | Real Chromium unpacked extension E2E covering loading, `sourceTabId` live DOM capture, SPA `TabRenderPool` fallback, selection, preview/edit, presets, library, domain rules, EPUB build, and Merge Tabs. |

---

## 6. Standard Agent Workflow

1. **Read targeted modules:** Inspect exact lines in `src/`, `tests/`, `docs/`, or `website/` before editing.
2. **Design minimally:** Prefer shared generic extraction (`BaseParser`, `GenericHtmlParser`, `HtmlSanitizer`, `parser-helpers.js`) over site-specific logic.
3. **Implement within scope:** Preserve error guards, accessibility attributes, and PT/EN parity in `src/workspace/locales/` and `website/`.
4. **Verify locally before committing:**
   - Run `node scripts/sync-website.mjs` twice (confirming zero diff on the 2nd run if `website/`/`docs/` changed).
   - Run `node scripts/verify-website.mjs`, `node scripts/check.mjs`, and `REQUIRE_EPUBCHECK=1 node --test tests/*.test.js` cleanly with 0 failures and 0 skips.
5. **Check CI after push:** Verify `CI Validation` (including Playwright E2E and `addons-linter`), `Pages` (when docs/site change), and `CodeQL` report `success`.
