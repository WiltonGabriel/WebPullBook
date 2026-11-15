# <img src="icons/icon.svg" width="32" height="32" align="absmiddle" alt="WebPullBook"> WebPullBook

**🇺🇸 English** | [🇧🇷 Português](README.pt.md)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Chrome & Firefox](https://img.shields.io/badge/Browsers-Chrome%20%7C%20Edge%20%7C%20Firefox%20128%2B-2563eb?style=flat-square)](#-getting-started)
[![Version](https://img.shields.io/badge/Version-1.3.0--beta-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** is a zero-dependency, open-source browser extension (Chrome, Edge, Brave, and Firefox 128+) for **converting web pages into EPUB** (**Web-to-EPUB**): extract web novels, light novels, serialized fiction, fanfiction, blogs, documentation, and open tabs into clean, volume-organized **EPUB 2 / EPUB 3** ebooks (plus **HTML**, **Markdown**, and **TXT**) for **Kindle**, **Kobo**, **Calibre**, and mobile readers.

[Features](#-key-features) • [Installation](#-getting-started) • [Compatibility](#-compatibility) • [FAQ](#-frequently-asked-questions-faq) • [Contribute](#-maintainers--contributing)

---

## Why WebPullBook?

Reading long serialized works, documentation, or multi-part articles in browser tabs is inconvenient offline or on E-Ink devices, and printing chapter-by-chapter PDFs introduces broken line wraps and page-break clutter. WebPullBook fetches clean HTML directly inside your browser (no third-party servers) and packages structured, reflowable ebooks with cover art, nested Table of Contents, and standard EPUB series metadata.

### Popular Use Cases

- **Web Novels, Light Novels & Fanfiction:** Save multi-chapter series grouped by volume in EPUB 3 or Kindle-ready EPUB 2 (*Send to Kindle*, Kobo, Calibre).
- **Articles, Blogs & Docs:** Open multiple tabs and use **Merge Tabs** to preview, reorder, and export a single anthology or multiple standalone ebooks.
- **Dynamic Sites / Sequential Chapters:** Use automatic **"Next Chapter"** link crawling or **SPA / JavaScript Tab Mode** when sites render dynamically or lack a table-of-contents page.

### Key Features

- **Automatic SPA Fallback, Smart Selector Prefill & Visual Picker:** Automatically extracts series using universal web patterns (JSON-LD/Schema.org, Open Graph, semantic lists, Readability-style prose scoring, and sequential *"Next Chapter"* crawling). When a site is an empty JS shell (`#root`, `#app`, `#__next`) or returns zero static chapters, **SPA / JavaScript Tab Mode** triggers automatically, and unknown sites automatically pre-fill **CSS selectors** cleanly. Need fine-tuning? Use **🎯 Point** to click elements visually on the page, **text / Regex strip filters**, or **saved per-domain rules**.
- **Chapter Dry-Run Preview, Quick Edit & Chapter Merge:** Preview any sanitized chapter before downloading, switch to **Edit Chapter** inside the preview modal to fix typos or edit titles/content locally (saved to cache with an `Edited` badge), **Merge Selected** chapters into one, **upload a local cover** (`.jpg`/`.png`/`.webp`/`.avif` with auto JPEG conversion), or generate a cover automatically.
- **Color-Safe Reader Profiles, EPUB 3 Pop-up Footnotes & Volume Detection:** Apply one-click reader profiles (**Modern Default**, **Kindle**, **Kobo & E-Readers** preserving full color for both monochrome and color E-Ink devices, **Text Only**, or **Legacy Default** with inline compatibility notice). Optionally convert footnotes into **EPUB 3 Pop-up Footnotes** (`epub:type="noteref"` + `<aside>`). Volumes are auto-inferred with **Re-detect Volumes** and range/batch editors.
- **Interactive Merge Open Tabs Modal:** Clicking **Merge Tabs** lists detected HTTP/HTTPS tabs pre-selected by default with **per-tab preview (👁️)**, reordering, current/all-window scope toggle, and three organization modes (**Same Book**, **Same Book Split into Volumes**, or **Separate Books — 1 standalone EPUB per tab**).
- **Always-Available Pause/Cancel, Concurrency & Local Cache (`IndexedDB`):** Configure **concurrent downloads (1x–6x)** or toggle **Safe Mode** at any time (RPM throttling, jitter, and automatic pause on `HTTP 429`/`503`). Use the always-visible **Pause / Resume** and **Cancel** buttons during single or batch runs; fetched chapters stay cached locally (**7 days** default TTL) for instant resume.
- **Custom Output Destination & Folder Organization:** Save into browser **Downloads** or pick **any local folder on your PC** (`File System Access API`), customize the **root folder name**, choose subfolder layouts (`Root / Title`, `Root / Author / Title`, `Author / Title`, `Format`, flat, or custom `%Root%/%Author%/%Title%` templates), and inspect a **live output path preview**.
- **Diagnostic Execution Logs & Live Typography Preview:** Inspect detailed `[NET]`, `[SPA]`, `[PARSER]`, `[BUILD]`, and `[AUTO]` execution traces with **All / Warnings / Errors** filters, **Copy Log**, and **Download Log**. Customize font family, alignment, line height, and indentation with live preview, CSS editor, and confirmed modular resets.
- **Built-in Library & One-Click Batch Updates:** Save series in the **Library** tab (`chrome.storage.local`), run **Check All** to scan every tracked book, select only unread releases with **Check New**, or click **Download All Updates** to check and export all updated series in a single queued batch.
- **Cross-Browser, 2-Column Layout & 4 Themes:** Runs on **Chrome/Chromium** and **Mozilla Firefox 128+** in pure Manifest V3 with a responsive 2-column layout, keyboard-accessible ARIA tabs, bilingual UI (**PT-BR** / **EN**), and a top-bar theme picker (**Auto**, **Light**, **Dark**, **Sepia**, **Midnight**).

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
4. Click **Pack EPUB**. Output files are saved under `Downloads/WebPullBook/<Title>/` by default—or in any custom folder and subfolder layout configured under **Advanced Options → Files & EPUB Standard**.
5. To track future chapter releases, click **Save to Library**.

### Customizing Any Website Without Code

When you load an unknown site, WebPullBook automatically checks whether **SPA / JavaScript Mode** is needed and pre-fills suggested CSS selectors whenever possible. To override or refine manually in **Advanced Options**, use **🎯 Point** directly on the page or click **Auto-detect selectors**:

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
├── README.md                     # Documentation (English)
├── README.pt.md                  # Documentação (Português)
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
        ├── chapters-ui.js        # Chapter table, volumes, preview quick-edit & merge modal
        ├── export-runner.js      # Export queue, Pause/Cancel, Safe Mode & file output
        ├── i18n.js               # Bilingual UI dictionary & DOM translator (PT / EN)
        ├── library-ui.js         # Saved series library, cache sessions & batch updates
        ├── logger.js             # Diagnostic execution logs, filters & issue report
        ├── options-storage.js    # Persistent options, domain rules, presets & path preview
        ├── series-loader.js      # Series loading, automatic SPA & selector detection
        ├── state.js              # Centralized state, presets & shared utilities
        ├── tab-picker.js         # Merge open tabs modal & visual point-and-click picker
        ├── theme-init.js         # Zero-FOUC theme bootstrapper
        ├── workspace.css         # Adaptive light/dark/sepia/midnight styling
        ├── workspace.html        # Workspace UI layout, Library & native dialogs
        └── workspace.js          # Thin event/lifecycle entrypoint wiring workspace modules
```

---

## Getting Help

- **Inspect execution logs:** Open the **Logs** tab inside the extension workspace and click **Download Log** to save a timestamped trace of network or parsing errors.
- **Compatibility table:** Check [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for verified and potentially compatible site structures.
- **Bug reports & site requests:** Open an issue in the repository's GitHub **Issues** tab describing the HTML structure (container classes for chapter list and chapter text) and attach any relevant log output.
- **Developer documentation & tests:** See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details, the automated test suite (`node:test`, `EPUBCheck`, Playwright E2E), and instructions on adding new parser adapters.
- **Security:** See [SECURITY.md](.github/SECURITY.md) for privately reporting security vulnerabilities.

---

## Frequently Asked Questions (FAQ)

- **Does it work with Kindle and Kobo?** Yes! Select the **Kindle** profile (classic EPUB 2 with optimized JPEG covers/images, ideal for *Send to Kindle* and Calibre) or **Kobo & E-Readers** (EPUB 3 with optimized image sizing and full color preserved for monochrome and color E-Ink readers).
- **Does any data leave my browser?** No. All fetching, HTML sanitization, and ZIP/EPUB packaging run 100% locally in your browser using your own session cookies only when required.
- **What if a website fails to load chapters automatically?** WebPullBook tries automatic SPA rendering and heuristic selector detection automatically; for custom tweaks, use **🎯 Point** in **Advanced Options**, **Auto-detect selectors**, or save a **Domain Rule**—or open an issue using our site-support template!

---

## Maintainers & Contributing

WebPullBook is an open-source project maintained by the **WebPullBook Contributors** under the [MIT License](LICENSE) and follows our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

### Ways to Help (Code & Non-Code)

- **Test websites & expand compatibility:** Open a PR updating the table in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Report layouts or bugs:** Open an issue in [Issues](https://github.com/WiltonGabriel/WebPullBook/issues) and attach the file saved via **Logs → Download Log**.
- **Build parser adapters or UI improvements:** Read [CONTRIBUTING.md](CONTRIBUTING.md) to add structural adapters in [src/parsers/](src/parsers/index.js), improve generic heuristics, or add translations ([i18n.js](src/workspace/i18n.js)).
