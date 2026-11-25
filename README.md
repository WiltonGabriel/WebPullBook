# <img src="icons/icon.svg" width="32" height="32" align="absmiddle" alt="WebPullBook"> WebPullBook

**English** | [Português](README.pt.md)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Chrome & Firefox](https://img.shields.io/badge/Browsers-Chrome%20%7C%20Edge%20%7C%20Firefox%20128%2B-2563eb?style=flat-square)](#-getting-started)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Available-FF7139?style=flat-square)](https://addons.mozilla.org/firefox/addon/webpullbook/)
[![Version](https://img.shields.io/badge/Version-1.7.2--beta-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** is an open-source browser extension (Chrome, Edge, Brave, and Firefox 128+) with zero runtime dependencies for **converting web pages into EPUB** (**Web-to-EPUB**): extract web novels, light novels, serialized fiction, fanfiction, blogs, documentation, and open tabs into volume-organized **EPUB 2 / EPUB 3** ebooks (plus **HTML**, **Markdown**, and **TXT**) for **Kindle**, **Kobo**, **Calibre**, and mobile readers.

Firefox Add-ons (AMO): https://addons.mozilla.org/firefox/addon/webpullbook/  
Website: https://wiltongabriel.github.io/WebPullBook/  
Repository: https://github.com/WiltonGabriel/WebPullBook

[Features](#-key-features) • [Installation](#-getting-started) • [Compatibility](#-compatibility) • [FAQ](#-frequently-asked-questions-faq) • [Contribute](#-authorship-maintainers--contributing)

---

## Overview

Reading long serialized works, documentation, or multi-part articles in browser tabs is often inconvenient offline or on E-Ink devices, and printing chapter-by-chapter PDFs introduces broken line wraps and pagination clutter. WebPullBook fetches and sanitizes HTML locally inside your browser (with no intermediate servers) and packages reflowable ebooks with cover art, nested Table of Contents, and standard EPUB series metadata.

### Common Use Cases

- **Web Novels, Light Novels & Fanfiction:** Save multi-chapter series grouped by volume in EPUB 3 or EPUB 2 (*Send to Kindle*, Kobo, Calibre).
- **Articles, Blogs & Docs:** Open multiple tabs and use **Merge Tabs** to preview, reorder, and export a single anthology or separate standalone ebooks.
- **Dynamic Sites / Sequential Chapters:** Use automatic **"Next Chapter"** link crawling or **SPA / JavaScript Tab Mode** when sites render dynamically or lack a table-of-contents page.

### Key Features

- **Automatic Extraction & SPA Support:** Captures the live DOM from the active tab, detects chapters and volumes across structural adapters and generic HTML pages, supports **SPA / JavaScript Tab Mode** with anti-bot pause guards, and includes a visual **Pick** selector tool with saved per-domain rules.
- **Reader Profiles & Book Structure:** Presets for **Kindle (Modern / Legacy)**, **Kobo & E-Readers**, **Modern Default**, **Text Only**, and **Legacy Default** ([guide](docs/READER_PRESETS.md)), with a customizable **Table of Contents** at the start of the book, **Information Page**, **End-of-Book Page (Colophon)**, and **EPUB 3 Pop-up Footnotes**.
- **Chapter Preview, Edit, Merge & Image Pipeline:** Preview and edit chapters before packing, merge selected chapters, upload a cover or use the automatic default cover (with the WebPullBook emblem and book title when no cover is detected), and bundle images with magic-byte MIME detection, content-hash deduplication, and automatic fallbacks.
- **Volume/Range Selection & Merge Open Tabs:** Toggle all volumes at once, select individual items or ranges with **`Ctrl+Click`** and **`Shift+Click`** on volume chips and chapter rows, or combine open browser tabs (**Merge Tabs**) into a single book or separate files.
- **Adaptive Safe Mode, Manual Latency & Local Cache:** Toggle **Safe Mode** during exports (adapts pacing to server latency and honors `Retry-After`), set **manual chapter latency (0–30000 ms)** in Advanced Options independently of Safe Mode, and resume interrupted downloads from **7-day IndexedDB cache**.
- **Library & Batch Updates:** Track ongoing series (unified or grouped by site) and download unread chapters across tracked works with **Download Updates**.
- **Custom Folders, Diagnostic Logs & 4 Themes:** Choose an output folder and subfolder template (`%Root%/%Author%/%Title%`), inspect filterable execution logs, and switch between **Light**, **Dark**, **Sepia**, and **Midnight** themes on Chrome and Firefox 128+.

### Visual Preview

![WebPullBook Main Workspace](website/assets/screenshots/workspace-main.png)

<details>
<summary>More Workspace Views (Preview &amp; Edit, Library &amp; Cache, Settings, EPUB Export)</summary>

| Chapter Preview & Inline Edit | Library & 7-Day IndexedDB Cache |
| :---: | :---: |
| ![Chapter Preview and Edit](website/assets/screenshots/workspace-preview-edit.png) | ![Library and Local Cache](website/assets/screenshots/workspace-library.png) |

| Advanced Options & Reader Profiles | Completed EPUB Packaging |
| :---: | :---: |
| ![Advanced Settings](website/assets/screenshots/workspace-settings.png) | ![Completed EPUB Export](website/assets/screenshots/workspace-epub-export.png) |

</details>

---

## Compatibility

The four-tier compatibility table (**Verified & Tested**, **Added / Not Officially Tested**, **Potentially Compatible**, and **Not Compatible**) lives in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) and can be updated via Pull Request as new sites are tested.

---

## Getting Started

> **Release Status (`v1.7.2-beta`):** WebPullBook is officially published on [Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/webpullbook/) for Firefox 128+. Chrome Web Store submission is planned next; meanwhile, Chrome, Edge, and Brave users can install the official signed release package from [GitHub Releases](https://github.com/WiltonGabriel/WebPullBook/releases).

### Installation (Mozilla Firefox)

Compatible with **Firefox 128+** (Manifest V3):

1. Open the [WebPullBook listing on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/webpullbook/).
2. Click **Add to Firefox** and confirm permissions. Updates arrive automatically via Firefox Add-ons.

### Installation (Chrome / Chromium)

No build step or package manager is required.

1. Download the latest `WebPullBook-v*.zip` package from [Releases](https://github.com/WiltonGabriel/WebPullBook/releases) and extract it to a permanent folder.
2. Open `chrome://extensions/` in Google Chrome (or `edge://extensions/` / `brave://extensions/`).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted folder containing [manifest.json](manifest.json).

> **For Developers:** If you want to modify or contribute code, clone the repository (`git clone https://github.com/WiltonGabriel/WebPullBook.git`) and load it unpacked in Chromium or temporarily via `about:debugging#/runtime/this-firefox` in Firefox. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Basic Usage

1. Navigate to a book's table of contents (or any chapter page) in your browser.
2. Click the **WebPullBook** toolbar icon to open the workspace tab—metadata, volumes, and chapters load from the active tab.
3. Choose **1 File per Volume** or **Single File**, pick your **Reader Profile** and output format (**EPUB**, **HTML**, **MD**, or **TXT**), and adjust chapter selection if needed.
4. Click **Pack EPUB**. Output files are saved under `Downloads/WebPullBook/<Title>/` by default—or in any custom folder and subfolder layout configured under **Advanced Options → Files & EPUB Standard**.
5. To track future chapter releases, click **Save to Library**.

### Customizing Unfamiliar Websites Without Code

When you load an unknown site, WebPullBook checks whether **SPA / JavaScript Mode** is needed and pre-fills suggested CSS selectors when possible. To override or refine manually in **Advanced Options**, use **Pick** directly on the page or click **Auto-detect selectors**:

```text
Parser Selection:                    Generic (Any HTML page)
Chapter list CSS selector:           .chapter-list a
Chapter content CSS selector:        article .chapter-body
Excluded elements CSS selector:      .ads, .translator-note
```

### Output Formats

- **EPUB 2 / EPUB 3 (`.epub`):** Standard OCF archive (`META-INF/container.xml`, `content.opf`, `toc.ncx`, `nav.xhtml`, and strict XHTML chapters) with cover art and series/volume metadata for e-readers, mobile apps, and desktop viewers.
- **Single-File HTML (`.html`), Markdown (`.md`), and Plain Text (`.txt`):** Formats for direct browser reading, note-taking tools, or text archiving.

---

## Project Structure

```text
WebPullBook/
├── .github/            # Issue/PR templates, Security, CoC, Dependabot & CI/Release/Pages/CodeQL workflows
├── _locales/           # Browser extension manifest localization (en, pt_BR)
├── AGENTS.md           # Instructions, architectural rules & guardrails for AI coding agents
├── CHANGELOG.md        # Release history (parsed by scripts/extract-release-notes.mjs)
├── CHROMEWEBSTORE.md   # Store listing readiness, permissions justification & privacy disclosures
├── CONTRIBUTING.md     # Development setup, pipeline overview & parser authoring guide
├── LICENSE             # Project license
├── README.md / README.pt.md  # Repository overview (EN / PT-BR)
├── manifest.json       # Cross-browser Manifest V3 declaration (Chrome + Firefox gecko)
├── docs/               # COMPATIBILITY.md, READER_PRESETS*.md, SEO guide & docs/pt/ mirrors
├── icons/              # Extension toolbar and store icons (SVG + PNG)
├── scripts/            # Linter (check.mjs), website sync/verifier & release notes extractor
├── src/
│   ├── background/     # MV3 background service worker / event script + Firefox Origin DNR rule
│   ├── core/           # Extraction base, net-fetcher, sanitizer, XHTML, image processor, EPUB, cache & ZIP
│   ├── exporters/      # Polymorphic exporters (EPUB 2/3, Single-File HTML, Markdown, TXT)
│   ├── parsers/        # ParserRegistry, GenericHtmlParser & structural adapters (see docs/COMPATIBILITY.md)
│   └── workspace/      # Extension workspace UI, 4 adaptive themes, modular controllers & PT/EN locales
├── tests/              # Native node:test unit/snapshot suites, anonymized fixtures & Playwright Chromium E2E
└── website/            # Static bilingual GitHub Pages site (synced from docs/; excluded from extension ZIP)
```

For the full 5-stage pipeline walkthrough, module summary, and step-by-step parser authoring guide, see [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

---

## Getting Help

- **Inspect execution logs:** Open the **Logs** tab inside the extension workspace and click **Download Log** to save a timestamped trace of network or parsing events.
- **Compatibility table:** Check [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for verified and potentially compatible site structures.
- **Bug reports & site requests:** Open an issue in the repository's GitHub **Issues** tab describing the HTML structure (container classes for chapter list and chapter text) and attach any relevant log output.
- **Developer documentation & tests:** See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for architecture details, the automated test suite (`node:test`, `EPUBCheck`, Playwright E2E), and instructions on adding new parser adapters.
- **Security:** See [SECURITY.md](.github/SECURITY.md) for privately reporting security vulnerabilities.

---

## Frequently Asked Questions (FAQ)

- **Does it work with Kindle and Kobo?** Yes. Choose **Kindle (Legacy)** (classic EPUB 2 for Amazon *Send to Kindle* email/cloud conversion), **Kindle (Modern)** (EPUB 3 with 1200px images for Calibre USB / KFX), or **Kobo & E-Readers** (EPUB 3 with 1080px optimization and full color preserved). See [docs/READER_PRESETS.md](docs/READER_PRESETS.md).
- **How does WebPullBook handle my data and network requests?** WebPullBook has no intermediate servers, no analytics, and no telemetry. All HTML parsing, XHTML sanitization, image processing, and ZIP/EPUB packaging happen locally in your browser, and settings/library/cache stay stored locally on your device (`chrome.storage.local` and `IndexedDB`). Your browser only makes direct HTTP/HTTPS requests to the websites and image CDNs you choose to download from (using your active browser session cookies when needed, with anonymous fallback on CDN errors). See the full [Privacy Policy](https://wiltongabriel.github.io/WebPullBook/privacy.html).
- **What if a website fails to load chapters automatically?** WebPullBook tries automatic SPA rendering and heuristic selector detection automatically; for custom layouts, use **Pick** in **Advanced Options**, **Auto-detect selectors**, or save a **Domain Rule**—or open an issue using our site-support template.

---

## Authorship, Maintainers & Contributing

WebPullBook was created and is maintained by **Wilton Gabriel** ([@WiltonGabriel](https://github.com/WiltonGabriel)), with contributions from the open-source community. The project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0-or-later)](LICENSE) and follows our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

### Ways to Help — Special Focus on Parser Development

Contributions to **parser development**—whether improving the shared generic extractor or adding new structural parser adapters—are the most impactful way to expand WebPullBook across the web:

- **Develop and add new parser adapters (`src/parsers/`):** When a web novel platform, CMS, or documentation engine uses paginated JSON APIs, AJAX chapter lists, or custom DOM layouts that generic heuristics cannot cover, create a new `BaseParser` subclass in [src/parsers/](src/parsers/index.js) and register it with anonymized HTML test fixtures in [tests/fixtures/](tests/fixtures/snapshots.json). See the step-by-step parser guide in [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-parser-adapter) or on the [Contributing page](https://wiltongabriel.github.io/WebPullBook/contributing.html).
- **Improve generic DOM extraction heuristics (`src/core/` & `src/parsers/generic-html.js`):** Enhance [`BaseParser`](src/core/base-parser.js), [`GenericHtmlParser`](src/parsers/generic-html.js), or [`HtmlSanitizer`](src/core/sanitizer.js) so arbitrary websites, blogs, and mirror domains work out of the box without site-specific rules.
- **Test websites & expand compatibility:** Test sites with WebPullBook and open a PR updating [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) (which automatically updates the official website's compatibility tables).
- **Report layouts or bugs with execution logs:** Open an issue in [Issues](https://github.com/WiltonGabriel/WebPullBook/issues) using the *New Site Layout / Adapter Support* or *Bug Report* template and attach the log file saved via **Logs → Download Log**.
