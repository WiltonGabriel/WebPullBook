# Compatibility Matrix — WebPullBook

[🇧🇷 Português](COMPATIBILITY.md) | **🇺🇸 English**

This document tracks **WebPullBook**'s compatibility across serialized fiction platforms, CMS theme engines, and e-reader pipelines.

Because WebPullBook uses an object-oriented architecture driven by DOM structure scoring (`ParserRegistry`), it does not rely on hardcoded domains in its source code and can extract books from both dedicated novel themes and generic or JavaScript-rendered (SPA) web pages.

---

## 1. Verified Compatible

Sources and workflows verified end-to-end (metadata extraction, high-resolution cover processing, volume boundary detection and splitting, line-by-line chapter text fidelity, and final archive validation):

| Source / Workflow | Adapter / Module | Verification Details |
| :--- | :--- | :--- |
| **Central Novel** | `wp-lightnovel` | Tested end-to-end in Google Chrome: 300+ chapter index loading, automatic 13-volume detection, clean synopsis & genre extraction, JPEG cover conversion, inline typography preservation (bold, italic, centered text, status cards), and both **1 EPUB per Volume** and **Single EPUB** modes. |
| **Standard EPUB 2 / EPUB 3 Output** | `epub-builder` | Standard OCF packaging (`META-INF/container.xml` with `application/oebps-package+xml`, `content.opf`, `toc.ncx`, `nav.xhtml`, strict `application/xhtml+xml` chapters), full series/volume metadata (`belongs-to-collection`), JPEG cover, and nested TOC. |

---

## 2. Potentially Compatible

Site structures and extraction modes natively supported by WebPullBook's heuristic adapters and built-in tools:

| Category / Layout | Adapter / Feature | How It Works |
| :--- | :--- | :--- |
| **WordPress Novel Themes (LightNovel / Tsundoku)** | `wp-lightnovel` | Automatically detects collapsible volume blocks (`.ts-chl-collapsible`), chapter lists (`.eplister`), chapter bodies (`.epcontent`), and resolves the series index page from any individual chapter via breadcrumbs. |
| **WordPress Madara Themes (Novels & Webfics)** | `madara-theme` | Automatically detects `.wp-manga-chapter` lists, `.parent.has-child` volume groups, and `.reading-content` / `.text-left` chapter containers. |
| **Serialized Web Fiction, Blogs & HTML Documentation** | `generic-html` | Scores repeating link clusters on index pages, follows automatic pagination (`a[rel="next"]`, `.pagination a.next`), extracts prose via Readability-inspired text density scoring, and parses JSON-LD (`schema.org/Book`) and OpenGraph metadata. |
| **Dynamic JavaScript / SPA Pages (React, Vue, Next.js)** | Tab Rendering Mode (`renderWithTab`) | When enabled (or triggered via automatic fallback), opens pages in a background browser tab to allow client-side JavaScript DOM hydration before extracting the index or chapter content. |
| **Custom Layouts via CSS Selectors** | Custom CSS Overrides (`Advanced Options`) | Lets users specify custom CSS selectors for chapter links, chapter body containers, and excluded elements (ads/author notes) without writing code. |
| **Open Browser Tabs (Articles & Chapters)** | **Merge Open Tabs** Mode (EpubPress-style) | Captures open tabs in the current browser window and compiles their readable content into a single organized ebook. |

---

## 3. Incompatible (Known Limitations)

Scenarios that are currently **not** supported by WebPullBook:

| Scenario | Technical Reason |
| :--- | :--- |
| **Proprietary DRM Platforms** | Services that deliver encrypted binary payloads or require closed native apps for decryption. |
| **`<canvas>` or Scrambled-Image Text Rendering** | Sites that paint text characters onto `<canvas>` elements or sliced images with no underlying HTML text nodes in the DOM (would require OCR). |
| **Hard Paywalls Without Browser Session Access** | Locked chapters that the user's current browser session cannot access. |
| **Per-Chapter Interactive CAPTCHAs** | If a server challenges every automated request with an interactive CAPTCHA, users must solve the challenge in an active tab and use a higher request delay or Tab Rendering Mode. |

---

[← Back to main README](../README.en.md)
