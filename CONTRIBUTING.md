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

## Pull Request Checklist

- Ensure all generated EPUB XML (`content.opf`, `toc.ncx`, `nav.xhtml`, chapter `.xhtml`) parses cleanly without XML errors.
- Avoid inline `<script>` tags or inline event handlers in extension HTML (strict MV3 CSP).
- Verify both light and dark color schemes render cleanly.
- Validate generated `.epub` archives (`container.xml`, `content.opf`, `toc.ncx`, `nav.xhtml`, cover image) and test opening them in a standard EPUB reader or validator.
