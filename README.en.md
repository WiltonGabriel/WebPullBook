# WebPullBook

[🇧🇷 Português](README.md) | **🇺🇸 English**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Version](https://img.shields.io/badge/Version-1.3.0--beta-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** is an open-source, zero-dependency browser extension that extracts multi-chapter web fiction, serialized books, chapter-index pages, and open browser tabs into clean, volume-organized **EPUB 2 / EPUB 3** ebooks (plus **HTML**, **Markdown**, and **TXT**) directly inside your browser.

---

## Why WebPullBook?

Reading long serialized works in a browser tab is inconvenient offline or on e-ink devices, and converting chapter-by-chapter PDFs often introduces broken line wraps and page-break artifacts. WebPullBook fetches the clean source HTML directly and packages structured, reflowable ebooks with cover art, nested Table of Contents, and standard EPUB series metadata.

### Key Features

- **General Compatibility via DOM Heuristics:** Extracts series from universal web patterns (JSON-LD/Schema.org, Open Graph, semantic lists, and Readability-style prose scoring) instead of relying solely on per-domain rules. For non-standard layouts, a **built-in heuristic scanner** in Advanced Options can auto-suggest CSS selectors (with manual override available).
- **Automatic Volume Detection:** Identifies volumes from collapsible sections, headings, chapter labels, or URL patterns to export **1 File per Volume** or a **Single File** with a nested TOC. If a source lacks volume groupings, manual range/batch rules remain available as a fallback.
- **SPA / JavaScript Tab Rendering:** Dynamic React/Vue/Next.js pages that return empty HTML on static `fetch()` are automatically hydrated via a background browser tab (`chrome.tabs` + `chrome.scripting`).
- **Local Cache (`IndexedDB`), Resume & Rate-Limit Guard:** Downloaded chapters stay cached locally (**7 days** default TTL) so interrupted runs can resume without re-fetching, backed by **Safe Mode** (RPM throttling and jitter) and automatic pause on `HTTP 429`/`503`.
- **Built-in Library & New-Chapter Tracking:** Save series in the **Library** tab (`chrome.storage.local`) and click **Load & Select New** to pick only chapters published since your last export.
- **Merge Open Tabs:** Capture open HTTP/HTTPS tabs in the current window and compile them into a single ebook.
- **Clean E-Reader-First XHTML:** Strict XHTML sanitization ([sanitizer.js](src/core/sanitizer.js)) preserves bold, italic, quotes, alignments, and intra-chapter anchors (such as footnotes) without locking `px` font sizes or colors that break Dark Mode, plus cover extraction and optional image compression.
- **Cross-Browser, 2-Column Layout & 4 Themes:** Runs on **Chrome/Chromium** and **Mozilla Firefox 128+** as a zero-dependency Manifest V3 extension, featuring a responsive 2-column workspace (metadata sidebar + chapters panel), keyboard-accessible ARIA tabs (`Series`, `Library`, `Advanced Options`, `Logs`), bilingual UI (**PT-BR** / **EN**), and a **4-theme** quick picker (**Light**, **Dark**, **Sepia**, **Midnight**) in the top bar.

---

## Compatibility

The compatibility table (**Verified Compatible**, **Potentially Compatible**, and **Not Compatible**) lives in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) and is designed to be easily updated via Pull Request as new sites are tested.

---

## Getting Started

### Installation (Chrome / Chromium)

No build step or package manager is required.

1. Download the latest `WebPullBook-v*.zip` package from [Releases](https://github.com/WiltonGabriel/WebPullBook/releases) and extract it, **or** clone this repository:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   ```
2. Open `chrome://extensions/` in Google Chrome (or any Chromium-based browser).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `WebPullBook/` directory containing [manifest.json](manifest.json).

### Installation (Mozilla Firefox)

Compatible with **Firefox 128+** (Manifest V3):

1. Download and extract `WebPullBook-v*.zip` (or clone this repository).
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on...** and select [manifest.json](manifest.json) (or the `.zip` archive directly).

### Quick Usage

1. Navigate to a book's table of contents (or any chapter page) in your browser.
2. Click the **WebPullBook** toolbar icon to open the workspace tab—metadata and chapters load automatically.
3. Choose **1 File per Volume** or **Single File**, pick your output format (**EPUB**, **HTML**, **MD**, or **TXT**), and adjust chapter ranges if needed.
4. Click **Pack EPUB**. Output files are saved under `Downloads/WebPullBook/<Title>/`.
5. To track future chapter releases, click **Save to Library**.

### Customizing Any Website Without Code

If a site uses an uncommon HTML layout or client-side JavaScript rendering, open **Advanced Options**, enable **SPA / JavaScript Mode** if needed, and click **Auto-detect selectors** so the heuristic scanner fills in the fields automatically (or refine CSS selectors manually):

```text
Parser Selection:                    Generic (Any HTML page)
Chapter list CSS selector:           .chapter-list a
Chapter content CSS selector:        article .chapter-body
Excluded elements CSS selector:      .ads, .translator-note
```

### Output Formats

- **EPUB 2 / EPUB 3 (`.epub`):** Standard OCF archive (`META-INF/container.xml`, `content.opf`, `toc.ncx`, `nav.xhtml`, and strict XHTML chapters) with cover art and series/volume metadata compatible with e-readers, mobile apps, and desktop viewers.
- **Single-File HTML (`.html`), Markdown (`.md`), and Plain Text (`.txt`):** Lightweight formats for direct offline reading or archiving.

---

## Project Structure

```text
WebPullBook/
├── .github/                      # Issue/PR templates, Security, CoC & CI/Release workflows
├── manifest.json                 # Extension manifest (MV3)
├── LICENSE                       # MIT License
├── CONTRIBUTING.md               # Development setup and parser authoring guide
├── README.md                     # Documentation (Português)
├── README.en.md                  # Documentation (English)
├── docs/
│   └── COMPATIBILITY.md          # Compatibility table (PR-friendly)
├── icons/                        # Extension toolbar and store icons
└── src/
    ├── background/
    │   └── service-worker.js     # Opens workspace tab on toolbar action click
    ├── core/
    │   ├── cache-store.js        # IndexedDB persistent cache with automatic TTL cleanup
    │   ├── epub-builder.js       # OPF, NCX, NAV, cover, and XHTML packaging
    │   ├── parser-engine.js      # BaseParser (OOP), SPA tab renderer, CSS, retries
    │   ├── sanitizer.js          # HtmlSanitizer -> valid XHTML with semantic styles
    │   └── zip.js                # Native CompressionStream ZIP archive builder
    ├── exporters/
    │   ├── index.js              # ExporterRegistry (EPUB, HTML, Markdown, TXT)
    │   ├── base-exporter.js      # BaseExporter with DOM -> Markdown/TXT helpers
    │   ├── epub-exporter.js      # EPUB 2/3 exporter
    │   ├── html-exporter.js      # Single-file offline HTML exporter
    │   ├── markdown-exporter.js  # Markdown (.md) exporter
    │   └── txt-exporter.js       # Plain text (.txt) exporter
    ├── parsers/
    │   ├── index.js              # ParserRegistry ranking adapters by DOM score
    │   ├── generic-html.js       # Heuristic extractor, selector scanner & pagination
    │   ├── wp-lightnovel.js      # WordPress serialized fiction theme adapter
    │   ├── madara-theme.js       # Madara-style chapter/novel theme adapter
    │   ├── royalroad.js          # Adapter for fiction TOC, volumes & hidden CSS rules
    │   ├── scribblehub.js        # Adapter with AJAX/tab TOC & anti-bot challenge check
    │   └── novelmania.js         # Adapter for API-paginated TOC & volume grouping
    └── workspace/
        ├── i18n.js               # Bilingual UI dictionary & DOM translator (PT / EN)
        ├── theme-init.js         # Zero-FOUC theme bootstrapper
        ├── workspace.html        # Workspace UI layout, Library & native dialogs
        ├── workspace.css         # Adaptive light/dark styling
        └── workspace.js          # State, chapter cache, partial resilience & queue
```

---

## Getting Help

- **Inspect execution logs:** Open the **Logs** tab inside the extension workspace and click **Download Log** to save a timestamped trace of network or parsing errors.
- **Compatibility table:** Check [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for verified and potentially compatible site structures.
- **Bug reports & site requests:** Open an issue in the repository's GitHub **Issues** tab describing the HTML structure (container classes for chapter list and chapter text) and attach any relevant log output.
- **Developer documentation & tests:** See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details, the automated test suite (`node:test`, `EPUBCheck`, Playwright E2E), and instructions on adding new parser adapters.
- **Security:** See [SECURITY.md](.github/SECURITY.md) for privately reporting security vulnerabilities.

---

## Maintainers & Contributing

WebPullBook is an open-source project maintained by the **WebPullBook Contributors** under the [MIT License](LICENSE) and follows our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

Contributions—especially new structural parser adapters in [src/parsers/](src/parsers/index.js), UI refinements, and compatibility updates in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)—are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
