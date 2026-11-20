# Changelog

All notable changes to **WebPullBook** are documented in this file.

## [1.5.0] - 2026-11-20 (Beta)

### New Features & Fixes
- **Automatic Default Cover with Logo (`src/workspace/cover-ui.js`):** When a source page has no detectable cover image (or when creating a book via **Merge Tabs** or after a remote cover load failure), WebPullBook automatically generates and applies a default cover featuring the official project emblem, book title, and author (also available manually via **Generate Cover**).
- **End-of-Book Page (`OEBPS/text/end.xhtml` — Closing / Colophon):** Configurable closing page under **Advanced Options → Files & EPUB Standard** (supporting custom heading, multi-line closing message, book summary, source URL link, and credits/generation date); the Table of Contents (`nav.xhtml` / `text/toc.xhtml`) always remains at the start of the book when enabled.
- **Volume & Chapter Multi-Selection (`Ctrl+Click` & `Shift+Click`):** Added toggling behavior to **Select All** on Volumes, `Ctrl+Click` individual toggles and `Shift+Click` range selection directly on volume chips and chapter rows, plus normalization of generic chapter headings (`"Capítulos"`, `"Chapters"`, `"Sumário"`) to **`Volume 01`**.
- **Per-Domain CSS Selector Isolation:** CSS selectors and regex strip filters (`customListSelector`, `customContentSelector`, `customExcludeSelector`, `customStripPatterns`) are no longer persisted globally in `wpbOptions` (staying scoped to the active site session or saved **Domain Rules**), with automatic fallback in `BaseParser` to native adapter extraction when a stale custom selector matches zero chapters.
- **Centralized Manual Latency in Advanced Options:** Manual delay between chapters (`0–30000 ms`, adjustable live and independent from Safe Mode) consolidated under **Advanced Options → Network, SPA & Resilience**.
- **Official Website (GitHub Pages), Documentation & Security Tooling:** Static bilingual website under `website/` synced automatically from repository documentation, `AGENTS.md`, `CHROMEWEBSTORE.md`, GitHub Pages workflow (`pages.yml`), CodeQL `security-and-quality` scanning (`codeql.yml`), and Dependabot monitoring (`dependabot.yml`), alongside URL protocol hardening (`resolveSafeHttpUrl`, `assertSafeHttpUrl`, `sanitizeCoverPreviewUrl`) and Web Crypto UUID generation.

## [1.4.0] - 2026-11-20 (Beta)

### New Features
- **Redesigned Reader Profiles:** Added **Kindle (Legacy)** (EPUB 2, tailored for *Send to Kindle*) and **Kindle (Modern)** (EPUB 3 for Calibre/KFX), alongside Modern Default, Kobo & E-Readers, Text Only, and Legacy Default. All profiles preserve image color (removed forced grayscale conversion). Updated selector order (`Legacy Default` above `Custom`). Reference guide available in `docs/READER_PRESETS.md` / `docs/READER_PRESETS.pt.md`.
- **Profile Selector in Advanced Options:** Profiles act as complete fixed presets—picking a profile updates all corresponding advanced fields immediately, while modifying any advanced option switches the selector to **Custom** automatically.
- **Start-of-Book TOC & Customizable Information Page:** Table of Contents (`nav.xhtml` / `text/toc.xhtml`) placed at the start of the book by default (with options to disable, move to end, or customize its title); Information Page allows toggling title, author/language/chapters, genres, source link, and synopsis.
- **Loading Overlay & Active-Tab Live DOM Capture:** Instant loading overlay (`#loading-overlay`) on workspace launch and live DOM capture directly from the active tab (`sourceTabId`) via `service-worker.js` + `PageDomCache`, avoiding cold `fetch()` calls on SPAs and authenticated sessions.
- **Resilient Image Pipeline & `[IMG]` Logs:** Binary magic-byte MIME sniffing (fixes `octet-stream` and rejects HTML 200 error pages disguised as images), automatic fallback to raw bytes if canvas conversion fails, anonymous retry (`credentials: 'omit'`) on HTTP errors, content-hash deduplication across distinct URLs, animated GIF/APNG/WebP preservation, `srcset`/`<picture>`/`data-orig-file` resolution, and detailed `[IMG]` logging.
- **`GenericHtmlParser` & XHTML Sanitizer Upgrades:** Added `<br>`-separated prose support, TOC vs. chapter classification (`isTableOfContents`), explicit TOC link discovery, automatic ascending order normalization, exact adjacent `nextPrevUrls` removal, `__cf_email__` decoding, `wp-block-spacer` → `<hr>` conversion, inline-wrapped block unwrapping, leading duplicate heading removal, and internal cross-chapter EPUB link rewriting.
- **Adaptive Safe Mode, Manual Delay & SPA Security:** `AdaptiveRateLimiter` with dynamic latency/error backoff, `Retry-After` compliance, and cooperative waiting; reusable `TabRenderPool` (1 background worker tab per queue), DOM stabilization wait, per-domain anti-bot circuit breaker, strict `http(s):` validation, and **"Open page to verify ↗"** banner button.
- **Library & Batch Updates:** Added **Download All Updates** to check and export newly published chapters across saved works, plus optional unified vs. by-site grouping with domain filter and origin badges.
- **Visual Selector Picker (`🎯 Pick`), Quick Edit & Merge:** Preview and inline quick-edit/merge chapters (with `Edited` badge), **EPUB 3 Pop-up Footnotes**, and `COMPATIBILITY.md` structured into 4 tiers.
- **Always-Visible Pause / Cancel Controls:** Cancel prompts for confirmation, and closing an active export tab triggers a browser confirmation prompt (Chrome and Firefox).
- **Diagnostic Logs:** Structured prefixes (`[NET]`, `[TAB]`, `[SPA]`, `[IMG]`, `[SAFE]`, `[PARSER]`, `[BUILD]`, `[AUTO]`, `[CFG]`, `[DONE]`) with All/Warnings/Errors filters and **Copy Log** button.

### Architecture & Testing
- Modularized codebase following the **Single Responsibility Principle (SRP)**:
  - `src/core/` split into focused modules (`base-parser.js`, `net-fetcher.js`, `rate-limiter.js`, `dnr-rules.js`, `image-processor.js`, `epub-templates.js`, `epub-css.js`, `text-utils.js`, `selector-utils.js`, `xhtml-serializer.js`, with `parser-engine.js` as a backwards-compatible facade).
  - `src/workspace/` split into focused UI controllers (`state.js`, `i18n.js` + `locales/`, `logger.js`, `options-storage.js`, `directory-handle.js`, `domain-rules-ui.js`, `chapters-ui.js`, `cover-ui.js`, `chapter-modals.js`, `volume-modals.js`, `series-loader.js`, `export-runner.js`, `download-storage.js`, `library-ui.js`, `library-view.js`, `cache-sessions-ui.js`, `settings-io.js`, `tab-picker.js`, `workspace.js`).
- Added per-chapter parser resolution (`resolveParserForChapterUrl`) for multi-domain books and *Merge Tabs*.
- Expanded test suite (`54` unit/integration tests covering image pipeline, Adaptive Safe Mode, SPA security, generic extractor, presets, and i18n parity) plus Playwright Chromium E2E and W3C `EPUBCheck` in CI.

## [1.3.0] - 2026-11-15 (Beta)

### New Features & Compatibility
- **Mozilla Firefox (128+) Support:** Cross-browser Manifest V3 (`background.scripts` + `browser_specific_settings.gecko`) and automatic removal of the `Origin: moz-extension://` header via `declarativeNetRequest` in `service-worker.js` to avoid CORS rejections when fetching chapters and covers on Firefox.
- **Heuristic CSS Selector Assistant:** Added **Auto-detect selectors** under **Advanced Options**, analyzing the index and sample chapter DOM (with SPA tab fallback) to suggest chapter list, content body, and exclusion selectors automatically.
- **Generic Extractor & Sanitizer Improvements:**
  - *"Innermost Node Wins"* rule in `GenericHtmlParser.findChapterContentRoot()` to prioritize true prose containers over outer wrappers.
  - Expanded `BaseParser` detection for JSON-LD metadata (`genre`, `creativeWorkStatus`), `<dl>` pairs (`Author`, `Status`), synopses (`[data-testid*="synopsis"]`, `[itemprop="description"]`), `<time>` stripping from chapter titles, `.sr-only` cleanup inside `<h1>`, and volume inference from ancestor headings.
  - Selective preservation of intra-chapter footnote anchors (`#id`) in `HtmlSanitizer` and removal of top-level `<style>` hidden decoy classes.
- **Verified Adapters:**
  - **Royal Road** (`royalroad.js`), **Novel Mania** (`novelmania.js`), and **Scribble Hub** (`scribblehub.js`), including pagination, chronological ordering, anti-bot challenge detection, and regression fixtures/snapshots.

### UI & Accessibility
- **2-Column Layout & Accessible Tabs:** Reorganized workspace into a left metadata/cover sidebar and chapter table column, renamed tabs (`Series`, `Library`, `Advanced Options`, `Logs`), added keyboard navigation (`role="tablist"`/`tabpanel`), and improved responsiveness.
- **4 Quick Color Themes:** Added **Sepia** and **Midnight** alongside **Light** and **Dark** in the top bar next to the language selector.

### Docs & Testing
- Updated documentation for Firefox installation, new layout/themes, adapters, and the **General Compatibility First** philosophy in `CONTRIBUTING.md` and `docs/COMPATIBILITY.md`.
- Expanded suite to `30` passing tests (lint, syntax, MV3 CSP, 228-key i18n parity, adapter regressions, and Chromium/Firefox verification).

## [1.2.1] - 2026-11-11 (Beta)

### Improvements
- **Clickable URLs in Logs:** `http(s)://` URLs inside the **Logs** tab open directly in a new tab (`rel="noopener noreferrer"`), making it easier to inspect chapters or media URLs that failed.
- **Direct Links in Report & Table:** Post-export report displays **`Open chapter ↗`** and **`Open image ↗`** per item (besides `View in log`), and the chapter table displays **`Open page ↗`** next to warnings/errors.
- **Full Image Failure Context:** Media failure logs record both the chapter page URL and the failing image URL.
- **Automated Release Pipeline:** Release notes generated automatically from `CHANGELOG.md` after full CI validation (`lint`, unit tests + `EPUBCheck v5.4.0`, and Playwright E2E) before publishing the `.zip` asset.

## [1.2.0] - 2026-11-11 (Beta)

### New Features
- **Post-Export Report & Severity Separation:** Summary panel below the status banner distinguishing **Errors (chapters)** and **Warnings (images/cover)** with impact descriptions, numbered list, and clickable log navigation.
- **Clickable Status & Log Badges:** Chapters display `Downloaded ✓` / `Cached ✓`, image warnings (`⚠ N`), and clickable errors linking directly to the highlighted row in **Logs** (with error and warning badge counters).
- **Image Resilience & W3C EPUBCheck Validation:** Anonymous fallback (`credentials: 'omit'`) on `HTTP 401/403` for CDNs/S3 buckets, rejection of HTML error responses disguised as images, automatic WebP/AVIF conversion for EPUB 2, Chromium XML declaration fix, `toc.ncx` (`playOrder`/DOCTYPE), and `svg` manifest property in `content.opf`.
- **Sanitizer Hardening:** Strict blocking of unsafe protocols on `<img>` (`javascript:`, `data:text/html`).
- **Quality & CI (P0/P1/P2):** Zero-dependency native `node:test` suite (23 tests), regression fixtures/snapshots (`wp-lightnovel`, `madara-theme`, `generic-html`), W3C `EPUBCheck`, and Chromium unpacked-extension E2E test via Playwright.

## [1.1.0] - 2026-11-11 (Beta)

- **Optional Safe Mode (Anti-Throttle)** + automatic rate-limit detection (`HTTP 429`/`503`).
- **Auto-Expiring Persistent Cache (`IndexedDB`)** and session resumption in the **Library** tab.
- **CDN Proxy Image Fallback (`i0.wp.com`)**.

## [1.0.2] - 2026-11-11 (Beta)

- Pure EPUB 3 collection metadata (`belongs-to-collection` / `group-position`) and `docs/COMPATIBILITY.md`.

## [1.0.1] - 2026-11-11 (Beta)

- Fixed `META-INF/container.xml` (`application/oebps-package+xml`), `dc:subject`, and `landmarks` in `nav.xhtml`.

## [1.0.0] - 2026-11-11 (Beta)

- Initial open-source release of WebPullBook (MV3, EPUB 2/3, HTML, Markdown, TXT, SPA tab mode, Merge Tabs, and Library).
