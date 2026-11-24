# Contributing to WebPullBook

**English** | [Português](docs/pt/CONTRIBUTING.pt.md)

Thank you for your interest in contributing to **WebPullBook**, created and maintained by **Wilton Gabriel** ([@WiltonGabriel](https://github.com/WiltonGabriel)) with community contributors. For AI coding agents (Codex, Cursor, Claude Code, Antigravity, Copilot), see [AGENTS.md](AGENTS.md) for complete architectural and security rules.

> **High-Impact Contribution Area — Parser Development:** Helping develop, refine, and add **parsers** (both improving the universal heuristic extractor in `BaseParser` / `GenericHtmlParser` and adding structural site/CMS adapters in `src/parsers/`) is one of the best ways to help WebPullBook support more platforms reliably. See [Adding a Parser Adapter](#adding-a-parser-adapter) below for the complete step-by-step guide.

## Development Setup

WebPullBook uses native ES modules and browser APIs with **no build step and zero runtime npm dependencies** (`dependencies: {}`). Editing any file under `src/` takes effect immediately when you reload the extension.

1. Clone the repository:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   cd WebPullBook
   ```
2. **Chrome / Chromium / Edge / Brave:** Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `WebPullBook/` root folder.
3. **Firefox (128+):** Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select [manifest.json](manifest.json).
4. After editing any file under `src/`, reload the extension on the extensions page (and reload open workspace tabs).

## How WebPullBook Works (End-to-End)

Understanding the 5-stage pipeline makes it easy to locate where any change belongs:

1. **Toolbar Trigger ([service-worker.js](src/background/service-worker.js)):** Clicking the extension icon opens `src/workspace/workspace.html?url=<activeTabUrl>&sourceTabId=<tabId>`. On Firefox (`moz-extension://`), it also adds a session `declarativeNetRequest` rule (ID `1`) to clean cross-origin `Origin` headers.
2. **Workspace Bootstrap ([workspace.js](src/workspace/workspace.js)):** [theme-init.js](src/workspace/theme-init.js) applies the saved theme without flash; options, library items, and per-domain rules load from `chrome.storage.local`, expired cache entries in `IndexedDB` are pruned, and `handleLoadSeries()` starts extraction.
3. **DOM Acquisition & Parser Selection ([net-fetcher.js](src/core/net-fetcher.js) & [parsers/index.js](src/parsers/index.js)):** WebPullBook first reads the live DOM directly from `sourceTabId` (`readOpenTabDocument`), falling back to charset-aware `fetchWithRetry()` and, for SPAs or JS-rendered pages, a reusable background tab (`TabRenderPool`). `parserRegistry.detect()` scores all adapters via `matchScore(doc, url)` and picks the best match (or `GenericHtmlParser`).
4. **Curation & Reader Profiles ([src/workspace/](src/workspace/workspace.html)):** Users filter/select chapters and volumes (`Ctrl+Click` / `Shift+Click`), preview and inline-edit chapter HTML, merge chapters or open browser tabs, pick selectors visually (`Pick`), or apply fixed presets from `READER_PRESETS` in [state.js](src/workspace/state.js).
5. **Sanitization & Book Packaging ([sanitizer.js](src/core/sanitizer.js), [xhtml-serializer.js](src/core/xhtml-serializer.js), [src/exporters/](src/exporters/index.js)):** `AdaptiveRateLimiter` paces downloads; each chapter is sanitized into strict XML/XHTML (stripping scripts, ads, unsafe URIs, and tracking watermarks) and cached in `IndexedDB`; finally `exporterRegistry` builds **EPUB 2/3** (`epub-builder.js` + `zip.js`), **Single-File HTML**, **Markdown**, or **TXT**, saving via `chrome.downloads` or `showDirectoryPicker()`.

## Repository Structure & Modules

```text
WebPullBook/
├── .github/                  # CI, Release, GitHub Pages, CodeQL workflows, Issue/PR templates, SECURITY, Code of Conduct
├── AGENTS.md                 # Authoritative rules & architecture guide for AI coding agents
├── CHANGELOG.md              # Release history (also used by scripts/extract-release-notes.mjs)
├── CONTRIBUTING.md           # This contributor guide
├── manifest.json             # Cross-browser Manifest V3 declaration (Chrome + Firefox gecko)
├── package.json              # Scripts and devDependencies (jsdom, fake-indexeddb, @biomejs/biome, addons-linter, playwright)
├── docs/                     # Compatibility matrix, Reader Presets guide, SEO guide & docs/pt/ mirrors
├── icons/                    # Extension icons (SVG + PNG sizes)
├── scripts/                  # check.mjs (lint/CSP/i18n), sync-website.mjs, verify-website.mjs, extract-release-notes.mjs
├── src/                      # Extension runtime code (no build step)
│   ├── background/           # MV3 background service worker / event script
│   ├── core/                 # Core engine modules
│   ├── exporters/            # Polymorphic exporters (epub, html, md, txt)
│   ├── parsers/              # ParserRegistry, GenericHtmlParser & site/CMS adapters
│   └── workspace/            # Extension tab UI, 4 themes, modular controllers & PT/EN locales
├── tests/                    # Native node:test unit/snapshot tests, fixtures/, helpers/ & Playwright E2E
└── website/                  # Static bilingual GitHub Pages site (never bundled into extension ZIP)
```

Key module files:

- [manifest.json](manifest.json) — Manifest V3 extension configuration (`service_worker` + Firefox `background.scripts` & `gecko` settings).
- [src/background/service-worker.js](src/background/service-worker.js) — Toolbar click handler opening the workspace tab with `url` and `sourceTabId`.
- [src/core/](src/core/parser-engine.js) — Single-responsibility core modules:
  - `parser-engine.js` (public facade), `base-parser.js` (`BaseParser` + `downloadAndParseChapter`), `net-fetcher.js` (charset-aware HTTP fetch, retries, `PageDomCache`, active-tab live DOM capture & SPA `TabRenderPool`), `rate-limiter.js` (`AdaptiveRateLimiter`), `dnr-rules.js` (session navigation headers), `text-utils.js`, `selector-utils.js`, `epub-css.js`.
  - `sanitizer.js` (`HtmlSanitizer`), `xhtml-serializer.js` (`serializeChapterXhtml`, EPUB 3 pop-up footnotes), `image-processor.js` (magic-byte MIME sniffing, content-hash dedup, animated image detection, safe canvas fallback), `epub-templates.js`, `epub-builder.js`, `zip.js`, `cache-store.js`.
- [src/exporters/](src/exporters/index.js) — `BaseExporter` and `ExporterRegistry` (`epub`, `html`, `md`, `txt`).
- [src/parsers/](src/parsers/index.js) — `ParserRegistry`, multi-domain chapter parser resolution, `GenericHtmlParser`, and the registered structural adapters inventoried in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md#parser-regression-fixtures).
- [src/workspace/](src/workspace/workspace.html) — Modular MV3 workspace (`theme-init.js`, `state.js`, `i18n.js` + `locales/`, `logger.js`, `options-storage.js`, `directory-handle.js`, `domain-rules-ui.js`, `chapters-ui.js`, `cover-ui.js`, `chapter-modals.js`, `volume-modals.js`, `series-loader.js`, `export-runner.js`, `download-storage.js`, `library-ui.js`, `library-view.js`, `cache-sessions-ui.js`, `settings-io.js`, `tab-picker.js`, and `workspace.js`).
- [docs/READER_PRESETS.md](docs/READER_PRESETS.md) — Reader profile guide. Presets live in `READER_PRESETS` ([src/workspace/state.js](src/workspace/state.js)); when adding or changing one, update the guide in both languages (`READER_PRESETS.md` and `READER_PRESETS.pt.md`), `preset*` keys in [locales/pt.js](src/workspace/locales/pt.js) and [locales/en.js](src/workspace/locales/en.js), and run `npm run sync:website`.
- `website/` — Static bilingual website deployed via GitHub Pages (excluded from extension `.zip`; synchronized via `npm run sync:website` and validated by `npm run lint`).

## Language, Style & Security Conventions

- **English Default:** Issues, Pull Requests, commit messages, code comments, and primary documentation (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/*.md`) must be written in **English**.
- **Portuguese Mirrors:** Dedicated Brazilian Portuguese mirrors live in `README.pt.md`, `docs/READER_PRESETS.pt.md`, `docs/pt/`, and `website/pt/`. UI strings in `src/workspace/locales/pt.js` & `en.js` and website pages under `website/pt/` require strict PT/EN parity (enforced by `npm run lint`); updating `docs/pt/` mirrors alongside doc edits is appreciated.
- **Manifest V3 CSP & Hygiene:** Never add inline `<script>` tags or `on*` event attributes in `src/**/*.html`, never use `console.log()` or `debugger` in `src/` (use the workspace logger or `console.error` for fatal errors), and keep LF line endings without trailing whitespace.
- **Untrusted Content:** All extracted chapter HTML must pass through `HtmlSanitizer` and `serializeChapterXhtml`. Never bypass protocol validation (`assertSafeHttpUrl`) or anti-bot/DRM restrictions.

## Adding a Parser Adapter

### Design Philosophy: General Compatibility First

WebPullBook aims to be **as un-specific as possible**, prioritizing **general compatibility** across arbitrary websites over brittle per-site rules. Domains, subdomains, URL paths, and CSS class names frequently change; adapters that hardcode them break silently.

Before writing a new site-specific parser (or adding site-specific logic to an existing one), always prefer improving the shared generic layer first:

- **Extend shared helpers & generic heuristics first:** Check [src/core/parser-engine.js](src/core/parser-engine.js) (`BaseParser`), [src/parsers/generic-html.js](src/parsers/generic-html.js) (`GenericHtmlParser`), and [src/core/sanitizer.js](src/core/sanitizer.js) (`HtmlSanitizer`) for standard web patterns (Schema.org/JSON-LD, Open Graph, `<dl>` metadata, `data-testid`/`itemprop` semantics, `<time>` stripping, container scoring, `.sr-only` cleanup, safe intra-chapter anchors).
- **Only add a dedicated adapter when generic DOM parsing cannot succeed:** E.g., paginated JSON APIs that omit chapters from initial HTML, custom encrypted/obfuscated content payloads, non-standard SPA hydration, or interactive tab fetching.
- **Keep adapters structural and minimal:** Detect pages primarily via **structural DOM signals** (e.g., `#reader-chapter-title`, `data-testid`, theme classes) rather than hostnames or fixed URL paths, inherit from `BaseParser`, and avoid hardcoding third-party brand names or domains unless explicitly required.

### Step-by-Step Guide

1. **Create the adapter module** at `src/parsers/<adapter-name>.js` extending `BaseParser` from [src/core/parser-engine.js](src/core/parser-engine.js):

   ```js
   import { BaseParser } from '../core/parser-engine.js';

   export class CustomAdapter extends BaseParser {
     constructor() {
       super({ id: 'custom-adapter', name: 'Descriptive Adapter Name' });
     }

     matchScore(doc, _url) {
       return doc.querySelector('.my-chapter-list') ? 80 : 0;
     }

     extractSiteMetadata(doc, targetUrl) {
       return {};
     }

     collectChapterNodes(doc, targetUrl, _options, _context) {
       return [];
     }

     findChapterContentRoot(doc) {
       return doc.querySelector('.my-chapter-body');
     }
   }
   ```

2. **Register an instance** inside `parserRegistry` in [src/parsers/index.js](src/parsers/index.js) **before** `genericHtmlParser`. The parser dropdown in `workspace.html` populates automatically from `parserRegistry.list()`.
3. **Add anonymized fixtures & regression snapshots:**
   - Save anonymized HTML fixtures (using fictional domains like `example.org`) under `tests/fixtures/<adapter>-index.html` and `tests/fixtures/<adapter>-chapter.html`.
   - Add expected metadata and chapter output (`url`, `displayTitle`, `volume`) to [tests/fixtures/snapshots.json](tests/fixtures/snapshots.json).
   - Add a regression test in [tests/parsers.test.js](tests/parsers.test.js) and document the pattern in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) (remembering to respect the 4 compatibility tiers and never include real URLs or raw domain names).
4. **Validate everything** with `npm run check` (and `npm run sync:website` if you updated `docs/COMPATIBILITY.md`).

## Automated Testing & Quality Checks

The extension runtime has **zero npm dependencies and zero build steps** (`npm run lint`, `npm run lint:fix`, and `npm run sync:website` run using only the Node.js standard library). Unit/snapshot tests use `jsdom` + `fake-indexeddb` and the Chromium browser E2E test uses Playwright (`devDependencies`, installed once via `npm install`).

| Command | Requirements | What It Validates |
| :--- | :--- | :--- |
| `npm run check` | `npm install` (`Node.js` + `devDependencies`) | Runs `npm run lint && npm test` (recommended before every commit/PR). |
| `npm run lint` | Node.js only | Manifest/package parity, Firefox MV3 keys, JS syntax, MV3 CSP, EPUB media-type, relative Markdown links, PT/EN i18n key parity, DOM IDs, LF/whitespace hygiene, and `verify-website.mjs`. |
| `npm run lint:biome` | `npm install` (`@biomejs/biome`) | Fast static analysis (unused variables/imports, undeclared globals, unreachable code) without modifying formatting. |
| `npm run lint:amo` | `npm install` (`addons-linter`) + `zip` | Builds a compressed preview ZIP (`manifest.json`, `_locales`, `icons`, `src`, `LICENSE`, `README*.md`) and validates it with Mozilla `addons-linter`. |
| `npm run lint:fix` | Node.js only | Auto-fixes LF line endings and trailing whitespace. |
| `npm test` | `npm install` (`jsdom`, `fake-indexeddb`) | Native `node:test` unit & snapshot test suite (`HtmlSanitizer`, `createZipBlob`, `ParserRegistry`, `ExporterRegistry`, `CacheStore`, `ImageProcessor`, `AdaptiveRateLimiter`, `TabRenderPool`, plus W3C EPUBCheck when available). |
| `npm run sync:website` | Node.js only | Updates `website/` compatibility/preset tables and version strings from `docs/` and `manifest.json` (`--check` verifies zero drift). |
| `REQUIRE_EPUBCHECK=1 npm run test:epubcheck` | Java 21+ & EPUBCheck (`.tools/epubcheck` or `EPUBCHECK_JAR`) | Strictly validates generated EPUB 2 & EPUB 3 outputs (0 errors, 0 warnings). |
| `npm run test:e2e` | `npm install` + `npx playwright install chromium` | Loads the unpacked extension in headless Chromium and exercises series loading, selection, profiles, library updates, domains, settings I/O, downloads, and tab merging. |

> **Note on Browser Coverage:** Automated unpacked-extension E2E runs on Chromium via Playwright (`--load-extension`). Firefox MV3 manifest compatibility (`background.scripts` + `browser_specific_settings.gecko`) is statically verified by `npm run lint`, while interactive Firefox runtime testing is performed manually via `about:debugging#/runtime/this-firefox`.

## Pull Request & Release Checklist

### Versioning (`MAJOR.MINOR.PATCH`)

- **`MAJOR` (`1.x.x` → `2.0.0`):** Only for a major milestone after significant progress.
- **`MINOR` (`1.6.0` → `1.7.0`):** Notable feature updates or new verified adapters.
- **`PATCH` (`1.6.0` → `1.6.1`):** Small fixes, minor adjustments, or quick patches.
- **Releases are published by the maintainer:** Contributors do **not** need to bump versions or create tags in Pull Requests.

### Checklist

- Run `npm run check` cleanly before opening a PR (both lint and unit/snapshot tests must pass).
- If modifying UI strings or HTML, keep PT/EN parity in `src/workspace/locales/`, avoid inline `<script>` / `on*` handlers, and verify light, dark, sepia, and midnight themes render cleanly.
- If modifying `docs/COMPATIBILITY.md`, `docs/READER_PRESETS*.md`, or `manifest.json` version, run `npm run sync:website`.
- Before tagging a release (`v*`):
  1. Verify all unit, regression, lint, EPUBCheck, and E2E tests are green in CI.
  2. Ensure [manifest.json](manifest.json) `version` matches the release tag (`vX.Y.Z`) and [package.json](package.json) `version`.
  3. Add a `## [X.Y.Z]` section in [CHANGELOG.md](CHANGELOG.md) (parsed automatically by [extract-release-notes.mjs](scripts/extract-release-notes.mjs) for GitHub Release notes).
  4. Verify the release archive builds cleanly with `manifest.json`, `_locales/`, `icons/`, `src/`, `LICENSE`, `README.md`, and `README.pt.md` (excluding `docs/`, `website/`, `tests/`, and `node_modules/`) plus its `.sha256` checksum.
