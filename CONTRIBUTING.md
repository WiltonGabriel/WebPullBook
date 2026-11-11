# Contributing to WebPullBook

Thank you for your interest in improving **WebPullBook**!

## Development Setup

WebPullBook uses native ES modules and browser APIs with **zero build steps or npm dependencies**.

1. Clone the repository:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   cd WebPullBook
   ```
2. Open `chrome://extensions/` in Chrome or a Chromium-based browser.
3. Enable **Developer mode** and click **Load unpacked**.
4. Select the `WebPullBook/` root folder.
5. After editing any file under `src/`, click the **Reload** icon on the extension card in `chrome://extensions/` (and reload open extension workspace tabs).

## Project Architecture

- [manifest.json](manifest.json) — Manifest V3 extension configuration.
- [src/background/service-worker.js](src/background/service-worker.js) — Toolbar click handler opening the workspace tab.
- [src/core/parser-engine.js](src/core/parser-engine.js) — `BaseParser` base class, JSON-LD/OpenGraph metadata, pagination loop, retry logic, and typography CSS builder.
- [src/core/sanitizer.js](src/core/sanitizer.js) — `HtmlSanitizer` converting untrusted chapter HTML to valid XHTML with semantic formatting preservation.
- [src/core/zip.js](src/core/zip.js) — Zero-dependency ZIP builder using `CompressionStream('deflate-raw')`.
- [src/core/epub-builder.js](src/core/epub-builder.js) — EPUB 2/3 packaging (`content.opf`, `toc.ncx`, `nav.xhtml`, cover conversion).
- [src/exporters/](src/exporters/index.js) — `BaseExporter` and `ExporterRegistry` (`epub`, `html`, `md`, `txt`).
- [src/parsers/](src/parsers/index.js) — `ParserRegistry` and `BaseParser` subclasses.
- [src/workspace/](src/workspace/workspace.html) — Adaptive light/dark UI, volume editor, and download manager.

## Adding a Parser Adapter

Keep parsers focused on **structural DOM patterns** rather than hardcoding third-party brand names or domains unless explicitly required.

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

### Adding Parser Fixtures & Regression Snapshots

1. Save anonymized HTML fixtures (using fictional domains like `example.org`) under `tests/fixtures/<adapter>-index.html` and `tests/fixtures/<adapter>-chapter.html`.
2. Add the expected metadata and ordered chapter list (`url`, `displayTitle`, `volume`) to [tests/fixtures/snapshots.json](tests/fixtures/snapshots.json).
3. Add or update the corresponding regression test in [tests/parsers.test.js](tests/parsers.test.js) and reference the fixture in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
