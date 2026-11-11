# WebPullBook

[🇧🇷 Português](README.md) | **🇺🇸 English**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Version](https://img.shields.io/badge/Version-1.1.0-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** is an open-source, zero-dependency browser extension that extracts multi-chapter web fiction, serialized books, chapter-index pages, and open browser tabs into clean, volume-organized **EPUB 2 / EPUB 3** ebooks (plus **HTML**, **Markdown**, and **TXT**) directly inside your browser.

---

## Why WebPullBook?

Reading long serialized works in a browser tab is inconvenient offline or on e-ink devices, and converting chapter-by-chapter PDFs often introduces broken line wraps and page-break artifacts. WebPullBook fetches the clean source HTML directly and packages structured, reflowable ebooks with cover art, nested Table of Contents, and standard EPUB series metadata.

### Key Features

- **Automatic Volume Detection & Splitting:** Detects volume boundaries from collapsible sections, chapter labels, or URL patterns, letting you export either **1 File per Volume** (with standard series and volume index metadata) or a **Single File** with a nested volume/chapter Table of Contents.
- **Manual Volume Editor:** Split chapters every *N* chapters, assign ranges (`from # to #`), tag checked rows, edit inline in the table, or apply batch rules (e.g., `1-24: Volume 01`).
- **Self-Expiring Persistent Cache (`IndexedDB`) & Resume:** Downloaded chapters are saved locally with configurable expiration (**7 days** default) and storage caps, letting you resume interrupted downloads from the **Library** tab even after closing the browser without permanent bloat.
- **Safe Mode (Anti-Block) & Automatic Rate-Limit Guard:** Dedicated toggle for RPM capping, randomized request jitter, and short batch cooldowns when desired—plus **automatic `HTTP 429`/`503` detection** that pauses the queue immediately without hammering rate-limited servers.
- **SPA / JavaScript Tab Rendering Mode:** Supports dynamic React/Vue/Next.js pages by rendering them in a background browser tab (`chrome.tabs` + `chrome.scripting`) when static `fetch()` finds no chapter links or prose content.
- **Merge Open Tabs Mode (EpubPress Style):** Grab all open tabs in your current browser window and compile their readable article content into a single ebook with 1 click.
- **Built-in Library & Reading List:** Save tracked series in the **Library** tab (`chrome.storage.local`) and click **Load & Select New** to automatically detect and select only chapters published since your last download.
- **Object-Oriented Modular Engine:** `ParserRegistry` ([src/parsers/](src/parsers/index.js)) ranks adapters extending `BaseParser` by DOM structure confidence, while `ExporterRegistry` ([src/exporters/](src/exporters/index.js)) exports to **EPUB 2/3**, **Single-File Offline HTML**, **Markdown (.md)**, and **Plain Text (.txt)**.
- **Clean XHTML & E-Reader-First Typography:** `HtmlSanitizer` ([src/core/sanitizer.js](src/core/sanitizer.js)) preserves bold, italic, underline, strikethrough, alignment (`wpb-center`, `wpb-right`), relative size scaling (`<big>`, `<small>`), and blockquotes without locking fixed `px` font sizes or colors that break Dark Mode in e-readers.
- **Cover & Image Optimization:** Extracts high-resolution covers (converting to optimized JPEG via `<canvas>` when enabled) and supports optional resizing/compression for inline chapter illustrations.
- **Bilingual & Adaptive UI:** Full interface in **Portuguese (`pt-BR`)** and **English (`en`)**, with system, light, and dark color schemes.

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

### Quick Usage

1. Navigate to a book's table of contents (or any chapter page) in your browser.
2. Click the **WebPullBook** toolbar icon to open the workspace tab—metadata and chapters load automatically.
3. Choose **1 File per Volume** or **Single File**, pick your output format (**EPUB**, **HTML**, **MD**, or **TXT**), and adjust chapter ranges if needed.
4. Click **Pack EPUB**. Output files are saved under `Downloads/WebPullBook/<Title>/`.
5. To track future chapter releases, click **Save to Library**.

### Customizing Any Website Without Code

If a site uses an uncommon HTML layout or client-side JavaScript rendering, open **Advanced Options** to set custom CSS selectors or enable **SPA / JavaScript Mode**:

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
    │   ├── wp-lightnovel.js      # WordPress serialized fiction theme adapter
    │   ├── madara-theme.js       # Madara-style chapter/novel theme adapter
    │   └── generic-html.js       # Readability-inspired fallback & pagination adapter
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
- **Developer documentation:** See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details and instructions on adding new parser adapters.
- **Security:** See [SECURITY.md](.github/SECURITY.md) for privately reporting security vulnerabilities.

---

## Maintainers & Contributing

WebPullBook is an open-source project maintained by the **WebPullBook Contributors** under the [MIT License](LICENSE) and follows our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

Contributions—especially new structural parser adapters in [src/parsers/](src/parsers/index.js), UI refinements, and compatibility updates in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)—are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
