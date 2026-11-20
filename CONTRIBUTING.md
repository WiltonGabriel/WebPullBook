# Contributing to WebPullBook

**English** | [Português](docs/pt/CONTRIBUTING.pt.md)

Thank you for your interest in contributing to **WebPullBook**, created and maintained by **Wilton Gabriel** ([@WiltonGabriel](https://github.com/WiltonGabriel)) with community contributors. For AI coding agents (Codex, Cursor, Claude Code, Antigravity, Copilot), see [AGENTS.md](AGENTS.md) for complete architectural and security rules.

> **High-Impact Contribution Area — Parser Development:** Helping develop, refine, and add **parsers** (both improving the universal heuristic extractor in `BaseParser` / `GenericHtmlParser` and adding structural site/CMS adapters in `src/parsers/`) is one of the best ways to help WebPullBook support more platforms reliably. See [Adding a Parser Adapter](#adding-a-parser-adapter) below for the complete step-by-step guide.

## Development Setup

WebPullBook uses native ES modules and browser APIs with no build step or runtime npm dependencies.

1. Clone the repository:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   cd WebPullBook
   ```
2. **Chrome / Chromium:** Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select the `WebPullBook/` root folder.
3. **Firefox (128+):** Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select [manifest.json](manifest.json).
4. After editing any file under `src/`, reload the extension on the respective extensions page (and reload open workspace tabs).

## Project Architecture

- [manifest.json](manifest.json) — Manifest V3 extension configuration.
- [src/background/service-worker.js](src/background/service-worker.js) — Toolbar click handler opening the workspace tab with `url` and `sourceTabId`.
- [src/core/](src/core/parser-engine.js) — Single-responsibility core modules:
  - `parser-engine.js` (public facade), `base-parser.js` (`BaseParser` + `downloadAndParseChapter`), `net-fetcher.js` (charset-aware HTTP fetch, retries, `PageDomCache`, active-tab live DOM capture & SPA fallback), `dnr-rules.js` (session navigation headers), `text-utils.js`, `selector-utils.js`, `epub-css.js`.
  - `sanitizer.js` (`HtmlSanitizer`), `xhtml-serializer.js` (`serializeChapterXhtml`, EPUB 3 pop-up footnotes), `image-processor.js` (magic-byte MIME sniffing, content-hash dedup, animated image detection, safe canvas fallback), `epub-templates.js`, `epub-builder.js`, `zip.js`, `cache-store.js`.
- [docs/READER_PRESETS.md](docs/READER_PRESETS.md) — Reader profile guide. Presets live in `READER_PRESETS` ([src/workspace/state.js](src/workspace/state.js)); when adding or changing one, update the guide in both languages and the `preset*` keys in [locales/pt.js](src/workspace/locales/pt.js) and [locales/en.js](src/workspace/locales/en.js).
- [src/exporters/](src/exporters/index.js) — `BaseExporter` and `ExporterRegistry` (`epub`, `html`, `md`, `txt`).
- [src/parsers/](src/parsers/index.js) — `ParserRegistry`, multi-domain chapter parser resolution, and `BaseParser` subclasses.
- [src/workspace/](src/workspace/workspace.html) — Modular MV3 workspace (`state.js`, `i18n.js` + `locales/`, `logger.js`, `options-storage.js`, `directory-handle.js`, `domain-rules-ui.js`, `chapters-ui.js`, `cover-ui.js`, `chapter-modals.js`, `volume-modals.js`, `series-loader.js`, `export-runner.js`, `download-storage.js`, `library-ui.js`, `library-view.js`, `cache-sessions-ui.js`, `settings-io.js`, `tab-picker.js`, and `workspace.js`).
- `website/` — Static bilingual website deployed via GitHub Pages (never bundled in extension releases; validated with `node scripts/verify-website.mjs`).

## Adding a Parser Adapter

### Design Philosophy: General Compatibility First

WebPullBook aims to be **as un-specific as possible**, prioritizing **general compatibility** across arbitrary websites over brittle per-site rules. Domains, subdomains, URL paths, and CSS class names frequently change; adapters that hardcode them break silently.

Before writing a new site-specific parser (or adding site-specific logic to an existing one), always prefer improving the shared generic layer first:

1. **Extend shared helpers & generic heuristics first:** Check [src/core/parser-engine.js](src/core/parser-engine.js) (`BaseParser`), [src/parsers/generic-html.js](src/parsers/generic-html.js) (`GenericHtmlParser`), and [src/core/sanitizer.js](src/core/sanitizer.js) (`HtmlSanitizer`) for standard web patterns (Schema.org/JSON-LD, Open Graph, `<dl>` metadata, `data-testid`/`itemprop` semantics, `<time>` stripping, container scoring, `.sr-only` cleanup, safe intra-chapter anchors).
2. **Only add a dedicated adapter when generic DOM parsing cannot succeed:** E.g., paginated JSON APIs that omit chapters from initial HTML, custom encrypted/obfuscated content payloads, non-standard SPA hydration, or interactive tab fetching.
3. **Keep adapters structural and minimal:**
   - Detect pages primarily via **structural DOM signals** (e.g., `#reader-chapter-title`, `data-testid`, theme classes) rather than relying heavily on hostnames or fixed URL paths, so mirror domains and URL migrations keep working.
   - Inherit from `BaseParser` and reuse its extraction/cleaning methods instead of reimplementing them.
   - Avoid hardcoding third-party brand names or domains unless explicitly required.

1. Create a module in `src/parsers/<adapter-name>.js` extending `BaseParser` from [src/core/parser-engine.js](src/core/parser-engine.js):

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

2. Register an instance inside `parserRegistry` in [src/parsers/index.js](src/parsers/index.js) **before** `genericHtmlParser`. The options dropdown in `workspace.html` populates automatically from `parserRegistry.list()`.

## Pull Request & Release Checklist

- Run `npm run lint` and `npm test` cleanly (both must pass before opening a PR).
- When running tests with `EPUBCheck` (`REQUIRE_EPUBCHECK=1 npm run test:epubcheck`) and Playwright E2E (`npm run test:e2e`), ensure all generated EPUB 2 and EPUB 3 files report 0 errors and 0 warnings.
- Ensure all generated EPUB XML (`content.opf`, `toc.ncx`, `nav.xhtml`, chapter `.xhtml`) parses cleanly without XML errors.
- Avoid inline `<script>` tags or inline event handlers in extension HTML (strict MV3 CSP).
- Verify both light and dark color schemes render cleanly.
- Before tagging a release (`v*`), verify:
  1. All unit, regression, lint, and E2E tests are green in CI.
  2. `EPUBCheck` passes with 0 errors/warnings on EPUB 2 and EPUB 3 outputs.
  3. [manifest.json](manifest.json) `version` matches the release tag (`vX.Y.Z`) and [package.json](package.json) `version`.
  4. [CHANGELOG.md](CHANGELOG.md) contains a `## [X.Y.Z]` section (used automatically by the release workflow to populate GitHub Release notes).
  5. Generated release `.zip` contains only extension runtime/doc assets (`manifest.json`, `icons/`, `src/`, `LICENSE`, `README*.md`, `docs/`).

## Automated Testing & Quality Checks

The extension runtime has **zero npm dependencies and zero build steps** (`node --test` unit/regression tests and lint checks also run with zero `npm install` needed). Only the optional Chromium browser E2E test uses Playwright (`devDependencies`).

1. **Lint, syntax, CSP, i18n, and formatting check:**
   ```bash
   npm run lint        # checks manifest, syntax, MV3 CSP, links, i18n/DOM parity, LF/whitespace
   npm run lint:fix    # auto-fixes LF line endings and trailing whitespace
   ```
2. **Unit & parser regression tests (native `node:test`, zero dependencies):**
   ```bash
   npm test
   ```
   Covers [`HtmlSanitizer`](src/core/sanitizer.js), [`createZipBlob`](src/core/zip.js), [`ParserRegistry`](src/parsers/index.js) / [`BaseParser`](src/core/parser-engine.js), [`ExporterRegistry`](src/exporters/index.js), [`CacheStore`](src/core/cache-store.js), and HTML fixture snapshots in [tests/fixtures/](tests/fixtures/snapshots.json).
3. **EPUBCheck validation (requires Java + `epubcheck` in `.tools/epubcheck` or `EPUBCHECK_JAR`):**
   ```bash
   REQUIRE_EPUBCHECK=1 npm run test:epubcheck
   ```
4. **End-to-End Chromium extension test (requires Playwright Chromium):**
   ```bash
   npm install
   npx playwright install chromium
   npm run test:e2e
   ```
   > **Note on Browser E2E Coverage:** Automated unpacked-extension E2E runs on Chromium via Playwright (`--load-extension`). Firefox MV3 manifest compatibility (`background.scripts` + `browser_specific_settings.gecko`) is statically verified by `npm run lint`, while interactive Firefox runtime testing is performed manually via `about:debugging#/runtime/this-firefox`.
5. **Static Website & SEO Verification (zero dependencies):**
   ```bash
   node scripts/verify-website.mjs
   ```

### Adding Parser Fixtures & Regression Snapshots

1. Save anonymized HTML fixtures (using fictional domains like `example.org`) under `tests/fixtures/<adapter>-index.html` and `tests/fixtures/<adapter>-chapter.html`.
2. Add the expected metadata and ordered chapter list (`url`, `displayTitle`, `volume`) to [tests/fixtures/snapshots.json](tests/fixtures/snapshots.json).
3. Add or update the corresponding regression test in [tests/parsers.test.js](tests/parsers.test.js) and reference the fixture in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
