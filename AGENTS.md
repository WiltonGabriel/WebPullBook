# AGENTS.md — AI Coding Agent Instructions for WebPullBook

This file provides authoritative architectural, security, and workflow instructions for AI coding agents (Codex, Cursor, Claude Code, Antigravity, Copilot, etc.) working on **WebPullBook**.

For human-oriented contributor guidelines and parser tutorials, see [CONTRIBUTING.md](CONTRIBUTING.md), [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md), and [docs/READER_PRESETS.md](docs/READER_PRESETS.md).

---

## 1. Project Identity

- **Purpose:** WebPullBook is an open-source, cross-browser **Manifest V3** extension (Chrome, Edge, Brave, and Mozilla Firefox 128+) that extracts web novels, light novels, serialized fiction, articles, documentation, and open browser tabs into volume-organized **EPUB 2**, **EPUB 3**, **Single-File HTML**, **Markdown**, and **Plain Text (TXT)** files for offline reading.
- **Current Status:** Beta (`v1.5.0-beta`, see [manifest.json](manifest.json) and [package.json](package.json)).
- **Communication Philosophy:** Quiet design and minimalism (*design silencioso e minimalismo*). Documentation, UI strings, and website copy must remain objective, discreet, clear, and honest—free of promotional adjectives, sales language, or unverified claims.
- **Technology Stack:**
  - **Runtime:** Vanilla JavaScript (native ES modules), HTML5, CSS3, Web Extensions API (`chrome.*`), `DOMParser`, `XMLSerializer`, `CompressionStream` (`deflate-raw`), `IndexedDB`, `OffscreenCanvas` / `<canvas>`, and File System Access API (`showDirectoryPicker`).
  - **No Runtime Dependencies:** `dependencies` in [package.json](package.json) is empty (`{}`) and there is **no build step or bundler**. Source files under `src/` run directly in the browser.
  - **Dev Dependencies:** Only `playwright` is listed in `devDependencies` for automated Chromium E2E testing. Unit tests (`node:test`) and static lint checks run on the Node.js standard library.

### Real Directory Structure

```text
WebPullBook/
├── .github/                  # CI, Release, Pages & CodeQL workflows, Dependabot, Issue/PR templates, SECURITY, CoC
├── AGENTS.md                 # AI agent instructions (this file)
├── CHANGELOG.md              # Release history (parsed by scripts/extract-release-notes.mjs)
├── CHROMEWEBSTORE.md         # Store listing readiness, permissions justification & privacy disclosures
├── CONTRIBUTING.md           # Developer setup, architecture summary & parser authoring guide
├── LICENSE                   # MIT License
├── README.md                 # Primary repository documentation (English)
├── README.pt.md              # Primary repository documentation (Brazilian Portuguese)
├── manifest.json             # Cross-browser Manifest V3 declaration (Chrome + Firefox gecko settings)
├── package.json              # Scripts and devDependencies (playwright only)
├── docs/
│   ├── COMPATIBILITY.md      # 4-tier site & pattern compatibility table (no URLs/domains)
│   ├── READER_PRESETS.md     # Reader profile reference (English)
│   ├── READER_PRESETS.pt.md  # Reader profile reference (Portuguese)
│   ├── SEO_AND_GITHUB_PAGES.md # GitHub Pages, SEO & Google Search Console operational guide
│   └── pt/                   # Optional Brazilian Portuguese mirrors (README, CHANGELOG, CONTRIBUTING, SECURITY, CoC)
├── icons/                    # Extension icons (icon.svg, icon-16.png, icon-32.png, icon-48.png, icon-128.png)
├── scripts/
│   ├── check.mjs             # Static linter (manifest parity, JS syntax, MV3 CSP, links, i18n/DOM IDs, formatting)
│   ├── extract-release-notes.mjs # Extracts version notes from CHANGELOG.md for GitHub Releases
│   ├── sync-website.mjs      # Syncs website/ tables & version metadata from docs/ and manifest.json
│   └── verify-website.mjs    # Validates website/ HTML semantics, links, canonicals, hreflang, sitemap & robots.txt
├── src/
│   ├── background/           # MV3 background service worker / event page
│   ├── core/                 # Single-responsibility extraction, network, sanitization, image, cache & EPUB engine
│   ├── exporters/            # Polymorphic book exporters (EPUB 2/3, HTML, Markdown, TXT)
│   ├── parsers/              # Polymorphic DOM parser registry, generic heuristic extractor & structural adapters
│   └── workspace/            # Extension UI tab (HTML, adaptive CSS themes, modular UI controllers & i18n)
├── tests/
│   ├── *.test.js             # Native node:test unit, parser snapshot, sanitizer, cache, exporter & ZIP suites
│   ├── e2e/extension.e2e.mjs # Real Chromium unpacked-extension E2E test via Playwright
│   ├── fixtures/             # Anonymized HTML fixtures and snapshots.json expectations
│   └── helpers/              # DOM shim, IndexedDB shim, ZIP reader & EPUBCheck runner
└── website/                  # Static bilingual official website for GitHub Pages (excluded from extension ZIP)
```

### End-to-End Execution Flow

1. **Action Trigger (`src/background/service-worker.js`):** Clicking the toolbar icon opens `src/workspace/workspace.html?url=<activeTabUrl>&sourceTabId=<tabId>`. On Firefox (`moz-extension://`), it registers `declarativeNetRequest` session rule ID `1` to strip the `Origin` header on cross-origin requests.
2. **Workspace Bootstrap (`src/workspace/theme-init.js` → `src/workspace/workspace.js`):** Applies the active theme without FOUC, loads options/library/domain rules from `chrome.storage.local`, prunes expired `IndexedDB` cache entries, wires UI listeners, and triggers `handleLoadSeries()` in `src/workspace/series-loader.js`.
3. **DOM Acquisition & Parser Selection (`src/parsers/index.js` & `src/core/net-fetcher.js`):**
   - `loadSeriesWithParser()` calls `fetchDocumentWithOptions()`, which first attempts zero-network live DOM capture from `sourceTabId` (`readOpenTabDocument`), falling back to `fetchWithRetry()` (`decodeHtmlBytes` for charset-accurate decoding).
   - If the static response is an HTTP 403/503 or an unhydrated SPA shell (`looksLikeSpaShell`), it automatically falls back to `fetchRenderedTabDocument()`.
   - `parserRegistry.detect()` ranks all registered adapters via `matchScore(doc, url)` and selects the highest-scoring adapter (or `GenericHtmlParser` fallback).
4. **Series & Chapter Discovery (`src/core/base-parser.js`):** `BaseParser.loadSeries()` resolves the index document, extracts metadata (JSON-LD `@graph`, Open Graph, `<dl>` pairs, and site-specific overrides), paginates chapter lists (`collectAllChapters()`), and normalizes volume labels (`extractVolumeLabel()`).
5. **User Curation (`src/workspace/`):** The user can filter/select chapters and volumes (`Ctrl+Click` / `Shift+Click`), preview and quick-edit chapter HTML (`chapter-modals.js`), merge chapters, merge open browser tabs (`tab-picker.js`), pick CSS selectors visually (`🎯 Pick`), or choose a fixed **Reader Profile** (`READER_PRESETS` in `state.js`).
6. **Export Pipeline (`src/workspace/export-runner.js`):**
   - Paces chapter downloads using `AdaptiveRateLimiter` (Smart Safe Mode, `Retry-After` compliance, or manual latency `0–30000 ms`) and reuses a single background worker tab via `TabRenderPool` when SPA mode is active.
   - Resolves per-chapter parsers across multi-domain works via `resolveParserForChapterUrl()`.
   - Sanitizes chapter DOM into strict XHTML via `HtmlSanitizer` (`src/core/sanitizer.js`) and `serializeChapterXhtml()` (`src/core/xhtml-serializer.js`), caching parsed XML in `CacheStore` (`src/core/cache-store.js`).
   - Packages output via `exporterRegistry.get(format).exportBook(...)` (`EpubExporter` → `buildEpubBlob()` in `src/core/epub-builder.js`, `HtmlExporter`, `MarkdownExporter`, or `TxtExporter`) and writes files via `chrome.downloads` or a saved `FileSystemDirectoryHandle`.

---

## 2. Current Architecture & Module Responsibilities

Always inspect the actual files before making changes. Do not invent or assume undocumented classes.

### `src/background/`
- [src/background/service-worker.js](src/background/service-worker.js) — Opens `workspace.html` with `url` and `sourceTabId` query parameters; sets up Firefox `Origin` removal session rule (ID `1`).

### `src/core/`
- [src/core/parser-engine.js](src/core/parser-engine.js) — Public backwards-compatible barrel facade re-exporting core symbols.
- [src/core/base-parser.js](src/core/base-parser.js) — `BaseParser` (Template Method base class for all parsers: `extractJsonLdMetadata`, `extractCommonMetadata`, `collectChaptersByCustomSelector`, `collectAllChapters`, `loadSeries`, `extractChapter`, `downloadChapter`) and `downloadAndParseChapter`. Includes automatic fallback to native adapter extraction if a custom CSS list selector yields `0` chapters.
- [src/core/net-fetcher.js](src/core/net-fetcher.js) — Network and tab acquisition module (often referred to conceptually as `NetFetcher`): `fetchDocumentWithOptions`, `fetchWithRetry`, `fetchHtmlDocument`, `decodeHtmlBytes`, `readOpenTabDocument`, `fetchRenderedTabDocument`, `PageDomCache` (in-memory first-page/hash DOM cache), `TabRenderPool` (reusable single background tab for SPA queues), `assertSafeHttpUrl`, `isAntiBotChallengeDocument`, `isRateLimitDocument`, and the per-domain SPA circuit breaker (`isSpaDomainCircuitOpen`, `tripSpaDomainCircuit`, `clearSpaDomainCircuit`).
- [src/core/rate-limiter.js](src/core/rate-limiter.js) — `AdaptiveRateLimiter`: dynamic concurrency (`getEffectiveBatchWidth`), latency/error backoff (`recordSuccess`, `recordThrottle`), `Retry-After` handling, jittered batch rest windows (`computeNextWait`), and responsive cooperative waiting (`waitCooperatively`).
- [src/core/sanitizer.js](src/core/sanitizer.js) — `HtmlSanitizer` and `sanitizeChapterContent`: whitelist-based DOM-to-XHTML sanitizer, strips scripts/handlers/ads/hidden decoy classes (`extractHiddenClassesFromStyles`), decodes Cloudflare emails (`decodeCloudflareEmail`), resolves lazy images/`srcset`/`<picture>`, strips adjacent `nextPrevUrls`, preserves intra-chapter footnote anchors, and deduplicates leading chapter headings.
- [src/core/xhtml-serializer.js](src/core/xhtml-serializer.js) — `serializeChapterXhtml` and `escapeXml`: emits strict XHTML 1.1 (EPUB 2) or XHTML5 (EPUB 3) documents and converts footnote targets into EPUB 3 pop-up `<aside epub:type="footnote">` elements when `popupFootnotes` is enabled.
- [src/core/image-processor.js](src/core/image-processor.js) — Image pipeline (conceptually `ImageProcessor`): `sniffImageMime` (magic-byte detection for PNG, JPEG, GIF, WebP, AVIF, BMP, SVG, plus mislabeled `text/html` rejection), `fetchImageBytes` (credentialed fetch with anonymous `credentials: 'omit'` retry), `tryConvertImage` / `convertImageViaCanvas` (resizing and JPEG conversion with raw-byte fallback), `hashImageBytes` (content-hash deduplication across distinct URLs), `isAnimatedImage` (GIF, APNG `acTL`, animated WebP `ANIM`/`ANMF` preservation), `decodeDataUrlToBlob`, and `extFromMime`.
- [src/core/epub-builder.js](src/core/epub-builder.js) — `buildEpubBlob` (conceptually `EpubBuilder`): orchestrates EPUB 2 and EPUB 3 packaging, cover/image embedding, cross-chapter internal hyperlink rewriting, front-matter TOC (`nav.xhtml` / `toc.xhtml`), Information Page (`info.xhtml`), End-of-Book Colophon (`end.xhtml`), `toc.ncx`, and `content.opf`.
- [src/core/epub-templates.js](src/core/epub-templates.js) — XML/XHTML generators: `buildContentOpf`, `buildTocNcx`, `buildNavXhtml`, `buildEpub2TocXhtml`, `buildCoverXhtml`, `buildInfoXhtml`, `buildEndXhtml`, and `groupTocByVolume`.
- [src/core/epub-css.js](src/core/epub-css.js) — `DEFAULT_EPUB_CSS` and `buildEpubStylesheet` (generates e-reader CSS from typography options).
- [src/core/zip.js](src/core/zip.js) — `createZipBlob`: zero-dependency ZIP archive builder using native `CompressionStream('deflate-raw')` with stored `mimetype` as the first entry per OCF specification.
- [src/core/cache-store.js](src/core/cache-store.js) — `cacheStore` (`CacheStore` singleton), `serializeNodesForCache`, and `hydrateCachedChapter`: `IndexedDB` persistence (`WebPullBookCache`) for downloaded chapters and resumable sessions with configurable TTL (default 7 days) and 64 MB storage cap eviction.
- [src/core/dnr-rules.js](src/core/dnr-rules.js) — `applyNavigationHeaderRules` and `clearNavigationHeaderRules`: manages temporary `declarativeNetRequest` session rules (IDs `100..119`) without colliding with Firefox rule ID `1`.
- [src/core/selector-utils.js](src/core/selector-utils.js) — `generateCssSelector` for the visual point-and-click selector picker.
- [src/core/text-utils.js](src/core/text-utils.js) — `FOLDER_LAYOUT_TEMPLATES`, `buildOutputPath`, `sanitizeFilename`, `sanitizePathSegment`, `extractVolumeLabel`, `extractVolumeNumber`, `ensureAscendingChapterOrder`, `normalizeSpaces`, `normalizeUrl`, `toHighResCoverUrl`, and `extractCleanSynopsis`.

### `src/exporters/`
- [src/exporters/index.js](src/exporters/index.js) — `ExporterRegistry` and `exporterRegistry` singleton (`epub`, `html`, `md`, `txt`).
- [src/exporters/base-exporter.js](src/exporters/base-exporter.js) — `BaseExporter` base class and DOM-to-text/Markdown traversal helpers.
- [src/exporters/epub-exporter.js](src/exporters/epub-exporter.js) — `EpubExporter` delegating to `buildEpubBlob`.
- [src/exporters/html-exporter.js](src/exporters/html-exporter.js) — `HtmlExporter` (standalone offline single-file HTML with embedded cover and TOC).
- [src/exporters/markdown-exporter.js](src/exporters/markdown-exporter.js) — `MarkdownExporter` (`.md`).
- [src/exporters/txt-exporter.js](src/exporters/txt-exporter.js) — `TxtExporter` (`.txt`).

### `src/parsers/`
- [src/parsers/index.js](src/parsers/index.js) — `ParserRegistry`, `parserRegistry`, `selectParser`, `getParserById`, `resolveParserForChapterUrl`, `looksLikeSpaShell`, and `loadSeriesWithParser`.
- [src/parsers/generic-html.js](src/parsers/generic-html.js) — `GenericHtmlParser` (`genericHtmlParser`): universal heuristic extractor (link-cluster scoring, `"Innermost Node Wins"` prose density detector, `<br>` prose support, TOC vs. chapter page classifier, sequential `"Next Chapter"` crawler, and `suggestSelectors()` heuristic assistant).
- Structural adapters extending `BaseParser`:
  - [src/parsers/wp-lightnovel.js](src/parsers/wp-lightnovel.js) (`wp-lightnovel`)
  - [src/parsers/madara-theme.js](src/parsers/madara-theme.js) (`madara-theme`)
  - [src/parsers/royalroad.js](src/parsers/royalroad.js) (`royalroad`)
  - [src/parsers/scribblehub.js](src/parsers/scribblehub.js) (`scribblehub`)
  - [src/parsers/novelmania.js](src/parsers/novelmania.js) (`novelmania`)
  - [src/parsers/novelbin.js](src/parsers/novelbin.js) (`novelbin`)

### `src/workspace/`
- [src/workspace/workspace.html](src/workspace/workspace.html) & [src/workspace/workspace.css](src/workspace/workspace.css) — Main extension UI, native `<dialog>` modals, and 4 adaptive color themes (`light`, `dark`, `sepia`, `midnight`).
- [src/workspace/theme-init.js](src/workspace/theme-init.js) — Synchronous `<head>` script preventing theme flash (FOUC).
- [src/workspace/state.js](src/workspace/state.js) — Centralized state object, `DEFAULT_OPTIONS`, fixed `READER_PRESETS` (`modern`, `kobo`, `kindle-modern`, `kindle`, `textonly`, `legacy`), `resolveReaderPreset`, `$()` DOM helper, and `t()` translation helper.
- [src/workspace/i18n.js](src/workspace/i18n.js), [src/workspace/locales/pt.js](src/workspace/locales/pt.js), [src/workspace/locales/en.js](src/workspace/locales/en.js) — Bilingual dictionary and `applyI18nToDom()`. Every key in `pt.js` must exist in `en.js` (enforced by `npm run lint`).
- [src/workspace/options-storage.js](src/workspace/options-storage.js) — Persists `wpbOptions` and `wpbLibrary` in `chrome.storage.local`, strips site-scoped selectors via `stripSiteScopedOptions()` so custom selectors never leak across domains, and syncs UI fields with `READER_PRESETS`.
- [src/workspace/directory-handle.js](src/workspace/directory-handle.js) & [src/workspace/download-storage.js](src/workspace/download-storage.js) — File System Access API directory handle persistence in `IndexedDB`, output path preview, and `chrome.downloads` fallback.
- [src/workspace/domain-rules-ui.js](src/workspace/domain-rules-ui.js) — Per-domain CSS selector rules (`wpbDomainRules`).
- [src/workspace/series-loader.js](src/workspace/series-loader.js) — `handleLoadSeries`, `setLoadingOverlay`, and `handleAutoDetectSelectors`.
- [src/workspace/chapters-ui.js](src/workspace/chapters-ui.js), [src/workspace/chapter-modals.js](src/workspace/chapter-modals.js), [src/workspace/volume-modals.js](src/workspace/volume-modals.js), [src/workspace/cover-ui.js](src/workspace/cover-ui.js) — Chapter table, volume chips, `Ctrl+Click` / `Shift+Click` range selection, dry-run preview & inline editor, chapter merging, manual volume assignment, cover upload, and automatic default cover generation with the WebPullBook logo (`generateDefaultCoverDataUrl`).
- [src/workspace/export-runner.js](src/workspace/export-runner.js) — `handlePackEpub` export queue, pause/resume/cancel confirmation, live Safe Mode reactions, and post-export report triggers.
- [src/workspace/library-ui.js](src/workspace/library-ui.js), [src/workspace/library-view.js](src/workspace/library-view.js), [src/workspace/cache-sessions-ui.js](src/workspace/cache-sessions-ui.js) — Saved series tracking, unified vs. by-site grouping, one-click batch updates (`handleDownloadLibraryUpdates`), and cached session resumption.
- [src/workspace/tab-picker.js](src/workspace/tab-picker.js) — **Merge Open Tabs** workflow and live in-page `🎯 Point` CSS selector picker.
- [src/workspace/logger.js](src/workspace/logger.js) — Structured diagnostic logging (`[NET]`, `[TAB]`, `[SPA]`, `[IMG]`, `[SAFE]`, `[PARSER]`, `[BUILD]`, `[AUTO]`, `[CFG]`, `[DONE]`), log filtering, and post-export severity report.
- [src/workspace/settings-io.js](src/workspace/settings-io.js) — Section-specific and global reset modals, plus JSON settings export/import.
- [src/workspace/workspace.js](src/workspace/workspace.js) — Thin event/lifecycle orchestrator wiring the workspace modules together.

### `tests/`, `scripts/`, `docs/`, and `website/`
- `tests/` — Unit tests (`*.test.js`), HTML fixtures (`tests/fixtures/`), helper shims (`tests/helpers/`), and Playwright Chromium E2E test (`tests/e2e/extension.e2e.mjs`).
- `scripts/` — `check.mjs` (linter), `extract-release-notes.mjs` (release helper), and `verify-website.mjs` (static site & SEO verifier).
- `docs/` — Compatibility matrix and reader preset guides.
- `website/` — Static bilingual GitHub Pages site (`index.html`, `features.html`, `installation.html`, `compatibility.html`, `faq.html`, `privacy.html`, `contributing.html`, and `pt/` counterparts). Never bundled into the extension `.zip`.

---

## 3. Mandatory Rules for AI Agents

1. **Respect the Existing Architecture:** Keep `src/core/`, `src/exporters/`, `src/parsers/`, and `src/workspace/` decoupled. Do not collapse modular files back into monolithic scripts.
2. **Single Responsibility Principle (SRP):** Place new logic in the module that owns that responsibility.
3. **Avoid Duplication:** Reuse existing helpers in `src/core/text-utils.js`, `src/core/net-fetcher.js`, `src/core/sanitizer.js`, `src/core/image-processor.js`, and `src/workspace/state.js`.
4. **Zero Runtime Dependencies:** Never add runtime npm packages, bundlers, or external CDN scripts to the extension or `website/`.
5. **No Over-Abstraction:** Write direct, readable vanilla JavaScript. Do not introduce unnecessary wrappers, factories, or configuration layers for single-use logic.
6. **Stay Strictly Within Scope:** Do not refactor or touch unrelated modules when fixing a bug or adding a localized feature.
7. **General Compatibility First:** Before adding or modifying a site-specific adapter in `src/parsers/`, always prefer improving shared generic extraction in `BaseParser`, `GenericHtmlParser`, or `HtmlSanitizer`. Only add a dedicated adapter when generic DOM heuristics cannot handle an API/AJAX/custom structure, and match via structural DOM signals rather than hardcoded domain names whenever possible.
8. **Never Invent Features or APIs:** Do not document or reference nonexistent classes, permissions, store links, or capabilities.
9. **Never Replace Working Code with Simplified Stubs:** Preserve all existing edge-case guards, fallbacks, i18n keys, accessibility attributes, and error handling.
10. **Preserve Backward Compatibility:** Maintain existing storage schemas (`wpbOptions`, `wpbLibrary`, `wpbDomainRules`, `WebPullBookCache`), preset behavior (`READER_PRESETS`), and barrel exports in `src/core/parser-engine.js`.
11. **Compatibility Documentation Rules:**
    - Preserve all four mandatory tiers in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md):
      1. `Verified & Tested (Verificados e Testados)`
      2. `Added / Not Officially Tested (Adicionados / Não Testados Oficialmente)`
      3. `Potentially Compatible (Potencialmente Compatíveis)`
      4. `Not Compatible (Não Compatíveis)`
    - Never move a site to `Verified & Tested` without real end-to-end verification and regression fixtures.
    - Never include URLs or raw domain names in `docs/COMPATIBILITY.md`, and never list compatible site names or URLs inside `README.md` or `README.pt.md`.
12. **Repository Language Policy (English Default + Optional Portuguese Mirror):**
    - **Mandatory:** **English is the default and primary language of the repository.** Always write and maintain all primary documentation (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CHROMEWEBSTORE.md`, `AGENTS.md`, `docs/*.md`), release notes (`scripts/extract-release-notes.mjs`), GitHub Issue/PR templates (`.github/`), code comments/docstrings, and commit messages **in English only** (never mix Portuguese into English primary docs or GitHub Releases).
    - **Recommended (Optional):** Dedicated Portuguese reference mirrors are organized in `README.pt.md`, `docs/READER_PRESETS.pt.md`, `website/pt/`, and `docs/pt/` (`docs/pt/CHANGELOG.pt.md`, `docs/pt/CONTRIBUTING.pt.md`, `docs/pt/SECURITY.pt.md`). When adding or updating primary repository documentation or release changelogs, it is helpful—though optional and not strictly required unless requested—to also add or update the corresponding Portuguese mirror in `docs/pt/` (while UI string changes in `src/workspace/locales/` and official pages in `website/pt/` remain required to preserve PT/EN parity enforced by `npm run lint`).

---

## 4. Security & Privacy Guidelines

- **Untrusted HTML Sanitization:** All extracted chapter content is untrusted. It must pass through `HtmlSanitizer` ([src/core/sanitizer.js](src/core/sanitizer.js)) and be serialized into strict XML/XHTML via `serializeChapterXhtml` ([src/core/xhtml-serializer.js](src/core/xhtml-serializer.js)). Never bypass tag/attribute whitelisting or protocol validation (`http:` / `https:` only for links and images; safe raster `data:image/*` only where explicitly validated).
- **XSS & Manifest V3 CSP Compliance:**
  - Extension pages (`src/workspace/workspace.html`) operate under strict Manifest V3 Content Security Policy.
  - Never add inline `<script>` blocks or inline `on*` event attributes (`onclick`, `onload`, etc.) in `src/**/*.html` (`npm run lint` enforces this).
  - Never execute arbitrary code from extracted pages (`eval`, `new Function`, or injecting remote scripts).
- **SPA & Auxiliary Tab Safety:**
  - Any URL opened via `chrome.tabs` (`TabRenderPool`, `fetchRenderedTabDocument`) must be validated with `assertSafeHttpUrl()` (`http:` or `https:` only).
  - Preserve the per-domain anti-bot circuit breaker (`isSpaDomainCircuitOpen` / `tripSpaDomainCircuit`) so background tab rendering immediately halts when a site presents a Cloudflare/CAPTCHA challenge or HTTP 429 rate limit.
  - Only extract `document.documentElement.outerHTML` and `window.location.href` from target tabs; never mutate or bypass security controls on target pages.
- **No Circumvention of Access Controls:** Never implement mechanisms to bypass DRM, locked paywalls, authentication walls, or CAPTCHA / anti-bot challenges. When a challenge is encountered, pause the queue and prompt the user to complete verification normally in their browser tab.
- **Local Data & Per-Site Isolation:**
  - Keep custom CSS selectors and regex strip rules isolated to the active site session or explicit per-domain rules (`stripSiteScopedOptions` in `src/workspace/options-storage.js`).
  - Do not introduce telemetry, analytics, or external server communication.
- **Formatting & Hygiene:** `src/` files must not contain `console.log()` (use `console.error` for fatal background errors or the workspace `appendLog` logger) or `debugger` statements, and all text files must use LF (`\n`) line endings without trailing whitespace (`npm run lint` enforces this).

---

## 5. Testing Commands & Validation

WebPullBook separates zero-dependency checks from browser/Java integration tools. **Do not run `npm install` when a change can be validated with the native Node.js stdlib checks.**

| Command | Dependencies Required | What It Validates |
| :--- | :--- | :--- |
| `npm run lint` | **None** (Node.js stdlib only) | Manifest/package version parity, Firefox MV3 manifest keys, JS syntax (`node --check`), MV3 CSP (no inline scripts/handlers), EPUB container media-type, relative Markdown links, PT/EN i18n key parity (410 keys), workspace DOM ID references, LF/whitespace/hygiene rules, and `verify-website.mjs`. |
| `npm test` | **None** (Node.js `node:test` stdlib) | 65 unit and regression tests covering `CacheStore`, `ExporterRegistry` (EPUB 2/3, HTML, MD, TXT), `ImageProcessor` (magic-byte MIME sniffing, canvas fallback, content-hash dedup, animated images), `ParserRegistry`, all parser fixture snapshots (`tests/fixtures/snapshots.json`), `AdaptiveRateLimiter`, `TabRenderPool`, SPA circuit breaker, `HtmlSanitizer`, and `createZipBlob`. (Automatically runs EPUBCheck test if Java + EPUBCheck are present, or skips that single test cleanly if absent.) |
| `npm run check` | **None** (Node.js stdlib only) | Runs `npm run lint && npm test`. Mandatory before completing any code or documentation task. |
| `npm run sync:website` | **None** (Node.js stdlib only) | Synchronizes `website/` compatibility/preset tables, version strings, and `site.config.json` from `manifest.json`, `docs/COMPATIBILITY.md`, `docs/READER_PRESETS.md`, and `docs/READER_PRESETS.pt.md`. |
| `node scripts/verify-website.mjs` | **None** (Node.js stdlib only) | Validates `website/` HTML pages, bilingual parity, internal links, image paths, canonical URLs, `hreflang` tags, Open Graph/social tags, `sitemap.xml`, `robots.txt`, and verifies `website/` is not bundled in extension packaging. |
| `npm run test:epubcheck` | **Java 21+** + **W3C EPUBCheck** (`.tools/epubcheck/` or `EPUBCHECK_JAR`) | Validates generated EPUB 2 and EPUB 3 archives against W3C `EPUBCheck` (set `REQUIRE_EPUBCHECK=1` in CI to fail if EPUBCheck is missing). |
| `npm run test:e2e` | **Playwright + Chromium** (`devDependencies`) | Launches Chromium with the unpacked extension loaded, testing series extraction, volume/chapter selection (`Ctrl`/`Shift`), preview & quick-edit, chapter merge, Reader Profiles, Library & batch updates, Domain Rules, JSON settings I/O, custom output folders, real EPUB download, diagnostic logs, and Merge Open Tabs. |

---

## 6. Recommended Agent Workflow

1. **Read `AGENTS.md`:** Understand the module boundaries, zero-dependency constraint, and security rules.
2. **Inspect Target Modules:** Read the exact source files involved in `src/`, `tests/`, `docs/`, or `website/`.
3. **Understand Existing Implementations:** Trace how state, options, i18n (`locales/pt.js` & `locales/en.js`), and error handling flow through the existing modules.
4. **Examine Related Tests:** Check `tests/*.test.js`, `tests/e2e/extension.e2e.mjs`, and `scripts/check.mjs` to see how the area is currently tested.
5. **Plan a Localized Change:** Design the minimal, single-responsibility change that solves the task without side effects.
6. **Implement Carefully:** Follow MV3 CSP rules, maintain PT/EN i18n parity if touching UI strings, and avoid `console.log()` in `src/`.
7. **Validate Locally:** Run `npm run check` (and `node scripts/verify-website.mjs` if touching `website/`, plus `npm run test:e2e` / `npm run test:epubcheck` when available in the environment).
8. **Check for Regressions:** Verify that existing tests, snapshots, relative links, and CI packaging rules remain intact.
9. **Update Pertinent Documentation:** If user-facing behavior, presets, or compatibility changed, update both English and Portuguese docs (`README.md`, `README.pt.md`, `docs/READER_PRESETS*.md`, `docs/COMPATIBILITY.md`, or `website/`).
