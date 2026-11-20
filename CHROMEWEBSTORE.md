# Chrome Web Store & Mozilla Add-ons Listing Readiness — WebPullBook

> Last Updated: 2026-11-20
> Current Release Status: **Beta (`v1.6.1-beta`)** — distributed via [GitHub Releases](https://github.com/WiltonGabriel/WebPullBook/releases); prepared for future store publication.

## Store Listing

**Extension Name** [REQUIRED]
WebPullBook

**Short Description** [REQUIRED] (129 characters — matches `manifest.json` limit ≤ 132 chars)
Extract serialized web fiction and multi-chapter pages into clean, volume-organized EPUB ebooks directly in your browser.

**Detailed Description** [REQUIRED]
WebPullBook converts web novels, light novels, serialized fiction, articles, documentation, and open browser tabs into volume-organized EPUB 2, EPUB 3, single-file HTML, Markdown, and plain text (TXT) files for offline reading.

FEATURES
• Chapter & Volume Extraction — Open a table of contents or chapter page and load detected chapters grouped by volume.
• E-Reader Profiles for Kindle & Kobo — Select presets for Kindle (Legacy EPUB 2 for Send to Kindle), Kindle (Modern EPUB 3 for Calibre USB), Kobo & E-Readers, Modern Default, or Text Only.
• Book Structure — Generates cover pages (including an automatic default cover when the source has no image), an optional Information Page (title, author, genres, source link, synopsis), a navigable Table of Contents at the start of the book, EPUB 3 pop-up footnotes, and an optional End-of-Book page.
• Chapter Preview, Quick Edit & Merge — Preview extracted chapters before exporting, edit titles or paragraphs inline, or merge multiple chapters into one.
• Merge Open Tabs — Combine articles, blog posts, or documentation open across browser tabs into a single volume or separate files.
• Visual Selector Picker & Domain Rules — Select the chapter list, chapter body, or unwanted elements directly on a page, and save CSS selector rules per domain.
• Adaptive Safe Mode & 7-Day Local Cache — Pace requests according to server latency and `Retry-After` headers, and resume interrupted downloads from local IndexedDB cache without re-downloading saved chapters.
• Saved Library & Batch Updates — Save ongoing works locally and check for newly listed chapters across saved entries.

HOW TO USE
1. Navigate to a web novel's table of contents or chapter page in your browser.
2. Click the WebPullBook toolbar icon to open the workspace tab.
3. Choose a Reader Profile (Kindle, Kobo, Modern, or Text Only) and output format (EPUB, HTML, Markdown, or TXT).
4. Select all volumes or choose specific chapters using Ctrl+Click and Shift+Click.
5. Click Pack EPUB to save the file to your Downloads folder.

PRIVACY
WebPullBook processes extracted content locally inside your browser. It uses no external backend servers, no analytics, and no telemetry. Preferences and saved Library entries stay on your device, and network requests are made directly from your browser only to the origin websites you choose to extract.

PERMISSIONS
• "Read your browsing history / tabs" (tabs) — Needed to read the URL of the active tab when you click the extension icon, list open tabs when you use Merge Tabs, and manage a background tab when rendering dynamic pages.
• "Access your data for all websites" (host_permissions) — Needed so you can extract chapters and images from the websites, blogs, or documentation pages you choose to convert.
• "Manage your downloads" (downloads) — Needed to save generated EPUB, HTML, Markdown, and TXT files to your Downloads folder.
• "Store data locally" (storage) — Needed to save your preferences, Reader Profile, Library, and per-domain rules on your device.

SUPPORT
Found a bug or want to suggest an improvement? Open an issue at https://github.com/WiltonGabriel/WebPullBook/issues or visit https://wiltongabriel.github.io/WebPullBook/

Version 1.6.1-beta — Reload Cover button restoring the original series cover in high resolution, vertical 2:3 cover preview, emoji-free language/theme selectors, plus the verified NovelBin React SPA adapter, generic SPA tab-pool & DOM-stability upgrades, and CodeQL security hardening.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Extracts multi-chapter web pages and open browser tabs into offline EPUB, HTML, Markdown, and TXT files.

**Primary Language** [REQUIRED]
Portuguese (Brazil) & English (Bilingual UI)

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 PNG | ✅ Ready | `website/assets/screenshots/workspace-main.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 PNG | ✅ Ready | `website/assets/screenshots/workspace-preview-edit.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 PNG | ✅ Ready | `website/assets/screenshots/workspace-library.png` |
| Screenshot 4 | 1280×800 PNG | ✅ Ready | `website/assets/screenshots/workspace-settings.png` |
| Screenshot 5 | 1280×800 PNG | ✅ Ready | `website/assets/screenshots/workspace-epub-export.png` |
| GitHub / Open Graph Social Preview | 1280×640 PNG | ✅ Ready | `website/assets/images/social-preview.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | Optional for future store submission |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | Optional for future store submission |

### Screenshot Notes
- **Screenshot 1 (`workspace-main.png`):** Main Workspace showing a multi-volume book loaded with cover art, Reader Profile selector, volume chips, and chapter table.
- **Screenshot 2 (`workspace-preview-edit.png`):** Dry-run Chapter Preview and inline Quick Edit modal displaying sanitized prose and footnote references.
- **Screenshot 3 (`workspace-library.png`):** Library & Local Cache tab showing a resumable IndexedDB session and tracked series with new chapter badges.
- **Screenshot 4 (`workspace-settings.png`):** Advanced Options tab showing Reader Profiles, output folder templates, and visual CSS selector picker controls.
- **Screenshot 5 (`workspace-epub-export.png`):** Completed 100% EPUB packaging with per-chapter status badges.

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Reads the active tab URL when the user clicks the extension toolbar icon, lists open HTTP/HTTPS tabs in the user-initiated "Merge Tabs" modal, and manages a single background worker tab when rendering dynamic single-page application (SPA) chapters. |
| `scripting` | permissions | Captures the live rendered DOM from the active tab when the user launches the workspace, extracts hydrated HTML from SPA pages, and runs the visual point-and-click CSS selector picker when triggered by the user. |
| `storage` | permissions | Persists user preferences (`wpbOptions`), tracked Library series (`wpbLibrary`), and user-defined domain rules (`wpbDomainRules`) locally on the device via `chrome.storage.local`. |
| `downloads` | permissions | Saves user-generated `.epub`, `.html`, `.md`, `.txt`, and diagnostic log files into the user's Downloads folder and configured relative subfolders. |
| `declarativeNetRequestWithHostAccess` | permissions | Applies temporary session-scoped rules during active extraction so cross-origin image and chapter requests succeed on protected hosts (and removes the `Origin: moz-extension://` header on Firefox to prevent CORS rejections). Never modifies unrelated browsing traffic. |
| `https://*/*`, `http://*/*` | host_permissions | WebPullBook is a general-purpose Web-to-EPUB converter that works on any website, personal blog, documentation site, or local archive selected by the user. Broad host access is required because target domains are chosen dynamically by the user at runtime. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Authentication info | No | No | N/A | No |
| Personal communications | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | No (Processed 100% locally on device to build user's ebook) | No | Local ebook generation | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
- English: `https://wiltongabriel.github.io/WebPullBook/privacy.html`
- Portuguese (PT-BR): `https://wiltongabriel.github.io/WebPullBook/pt/privacy.html`

---

## Distribution & Developer Info

**Visibility**: Public (Once Beta concludes and store submission is initiated)
**Regions**: All regions
**Publisher Name**: Wilton Gabriel (WebPullBook Contributors)
**Support URL**: `https://github.com/WiltonGabriel/WebPullBook/issues`
**Homepage URL**: `https://wiltongabriel.github.io/WebPullBook/`

---

## Mozilla Add-ons (AMO — Firefox) Submission Readiness

Mozilla Add-ons (`addons.mozilla.org`) does not charge a developer registration fee and accepts the same cross-browser Manifest V3 package directly:

- **Add-on ID (`gecko.id`):** `webpullbook@wiltongabriel.github.io` (configured under `browser_specific_settings.gecko` in `manifest.json`)
- **Minimum Version & Event Script:** `strict_min_version: "128.0"` and `background.scripts` (`src/background/service-worker.js`)
- **Data Collection Consent:** `data_collection_permissions: { "required": ["none"] }` (matches `addons-linter` canonical zero-collection declaration)
- **Submission Package:** Upload `WebPullBook-v<version>.zip` from GitHub Releases directly at `https://addons.mozilla.org/developers/` (no separate source code archive is required because WebPullBook uses native ES modules with zero build steps, zero bundlers, and zero minification)
- **Listing Metadata:**
  - **License:** MIT
  - **Summary (≤ 250 chars):** Extract web novels, serialized fiction, articles, and open browser tabs into volume-organized EPUB 2/3, single-file HTML, Markdown, and TXT ebooks offline in your browser.
  - **Categories:** *Download Management*, *Other*
  - **Homepage / Support / Privacy Policy:** `https://wiltongabriel.github.io/WebPullBook/`, `https://github.com/WiltonGabriel/WebPullBook/issues`, `https://wiltongabriel.github.io/WebPullBook/privacy.html`
  - **Screenshots (`1280×800` PNG):** Reuse the 5 screenshots listed under `website/assets/screenshots/`
- **Ready-to-Paste Notes for Reviewers:**
  > WebPullBook is a 100% client-side, zero-dependency Manifest V3 extension with no build step or remote code execution (`src/` runs unmodified). `tabs` and `scripting` are used only when the user clicks the extension action (to read the active tab URL or DOM cleanly, populate the Merge Tabs dialog, or reuse one background tab when extracting React/JS-hydrated SPAs). `declarativeNetRequestWithHostAccess` sets Firefox session rule ID `1` to remove `Origin: moz-extension://` on extension-initiated fetches so images/chapters are not rejected by CORS, plus temporary rules ID `100..119` for navigation headers during extraction. `http://*/*` and `https://*/*` host permissions are required because users extract books and articles from arbitrary websites of their choice. No user telemetry or analytics are collected by the extension.
- **Target Platforms & Firefox for Android Roadmap:**
  - Currently targets **Firefox Desktop (128+)** only (keep *Firefox for Android* unchecked during AMO submission until mobile testing is complete).
  - **Planned Future Work (`gecko_android`):** Add `browser_specific_settings.gecko_android` in `manifest.json` (`strict_min_version: "142.0"` for `data_collection_permissions`), refine mobile touch/viewport layouts in `src/workspace/workspace.css`, and test `tabs`/`scripting`/downloads behavior on Firefox for Android.

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| `1.6.1` (`1.6.1-beta`) | 2026-11-20 | Reload Cover button (restores the original series cover in high resolution), vertical 2:3 cover preview, emoji-free language/theme selectors, versioning policy and Firefox for Android roadmap documentation. | Draft (GitHub Release Beta) |
| `1.6.0` (`1.6.0-beta`) | 2026-11-20 | Verified NovelBin React SPA adapter, generic SPA `TabRenderPool` & DOM stability upgrades, `.sr-only`/duplicate-heading sanitizer hardening, CodeQL security fixes, 5-theme website improvements, and updated policies/docs. | Released (GitHub Release Beta) |
| `1.5.0` (`1.5.0-beta`) | 2026-11-20 | Automatic default cover fallback with WebPullBook logo, official bilingual GitHub Pages site with dynamic version detection and direct `.zip` download, `AGENTS.md`, `CHROMEWEBSTORE.md`, and quiet/minimalist documentation review. | Released (GitHub Release Beta) |
| `1.4.0` (`1.4.0-beta`) | 2026-11-20 | Reader Profiles for Kindle (Legacy/Modern) & Kobo, Start-of-Book TOC, customizable Information & End-of-Book pages, active-tab live DOM capture, resilient image pipeline, Ctrl/Shift range selection, per-site selector isolation, Library batch updates, and SRP modularization. | Released (GitHub Release Beta) |
| `1.3.0` (`1.3.0-beta`) | 2026-11-15 | Mozilla Firefox 128+ MV3 compatibility, heuristic CSS selector assistant, Royal Road / Novel Mania / Scribble Hub verified adapters, 2-column UI, and 4 color themes. | Released (GitHub Release Beta) |

---

## Packaging Verification

The release workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) packages only runtime and documentation files required by the extension:

```bash
zip -r "WebPullBook-v${VERSION}.zip" manifest.json icons src LICENSE README.md README.pt.md docs
```

This explicitly excludes `.git/`, `node_modules/`, `tests/`, `scripts/`, `website/`, and `CHROMEWEBSTORE.md`.
