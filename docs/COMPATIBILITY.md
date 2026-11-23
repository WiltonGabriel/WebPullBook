# Compatibility

List of websites and structural patterns supported by **WebPullBook**.
Contributions are welcome—feel free to open a pull request updating the status of sites you test.

> **Contributor guideline:** List **only the site name** in the `Site / Source` column below—do **not** include URLs, links, or domain names (e.g., use `Site Name`, never `example.com` or `https://...`). Do **not** list compatible site names or URLs in `README.md` or `README.pt.md` either.
>
> **Architecture note:** WebPullBook prioritizes **general structural compatibility** (`BaseParser`, `GenericHtmlParser`, `HtmlSanitizer`) over brittle domain- or URL-specific logic. When testing a new site, prefer improving generic heuristics first so compatibility holds even if a site changes domains or URLs.

## Verified & Tested (Verificados e Testados)

Sites and adapters verified end-to-end in live usage and covered by automated regression fixtures:

| Site / Source | Adapter | Last Verified | Reference Fixture | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Central Novel | `wp-lightnovel` | 2026-11-19 | [wp-lightnovel-index.html](../tests/fixtures/wp-lightnovel-index.html) | End-to-end tested (static SSR, zero SPA tabs): multi-volume detection, cover, synopsis, genres, and chapter fidelity. |
| Royal Road | `royalroad` | 2026-11-15 | [royalroad-index.html](../tests/fixtures/royalroad-index.html) | End-to-end tested (20 chapters): volume & chapter metadata, full synopsis, tags, cover, inline images, and hidden `<style>` watermark filtering. |
| Novel Mania | `novelmania` | 2026-11-15 | [novelmania-index.html](../tests/fixtures/novelmania-index.html) | End-to-end tested (20 chapters): paginated chapter API & multi-volume detection, full synopsis, genres, status, original cover, inline images, `.sr-only` heading cleanup, and footnote anchors. |
| Scribble Hub | `scribblehub` | 2026-11-19 | [scribblehub-index-p1.html](../tests/fixtures/scribblehub-index-p1.html) | End-to-end tested (index & direct chapter URL): AJAX full TOC, open-tab reuse, chronological ordering, metadata, inline images, and author note cleanup. |
| NovelBin | `novelbin` | 2026-11-20 | [novelbin-index.html](../tests/fixtures/novelbin-index.html) | End-to-end tested (index & direct chapter URL, 2 novels): automatic SPA tab hydration, reusable tab pool, JSON-LD author & full metadata, cover, sr-only/duplicate-heading cleanup, and ad-free chapter XHTML. |

## Added / Not Officially Tested (Adicionados / Não Testados Oficialmente)

Adapters or structural layouts already implemented (with unit fixtures), awaiting formal live verification across real books:

| Site / Layout | Adapter | Status | Reference Fixture | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Madara-based platforms (`.wp-manga-chapter`, `.reading-content`) | `madara-theme` | Fixture-tested only | [madara-index.html](../tests/fixtures/madara-index.html) | Implemented with volume grouping and chapter extraction; pending official live-site testing checklist. |
| Other WordPress novel theme clones (`.eplister`, `.ts-chl-collapsible`, `.epcontent`) | `wp-lightnovel` | Structural match | [wp-lightnovel-index.html](../tests/fixtures/wp-lightnovel-index.html) | Shares the same WordPress novel DOM layout as Central Novel; awaiting individual live reports. |

## Potentially Compatible (Potencialmente Compatíveis)

Sites without a dedicated adapter that work via WebPullBook's generic HTML extractor and fallback tools:

| Pattern / Layout | Adapter / Mode | Notes |
| :--- | :--- | :--- |
| Static HTML chapter indexes, blogs & paginated lists (`rel="next"`) | `generic-html` | Uses link-cluster scoring, prose density extraction, heuristic selector assistant, and 🎯 visual picker. |
| Sequential chapters without a TOC page | `generic-html` ("Next Chapter" crawl) | Automatically crawls sequential *"Next Chapter"* links when landing on a prose chapter. |
| JavaScript / SPA pages (React, Vue, Next.js) | Tab rendering (`renderWithTab`) | Extracts hydrated DOM via open or background browser tab when static HTML is an empty shell. |
| Open browser tabs | Merge Tabs | Compiles open HTTP/HTTPS tabs into a single anthology or standalone books. |

## Not Compatible (Não Compatíveis)

| Pattern / Limitation | Reason |
| :--- | :--- |
| Proprietary DRM platforms | Content is encrypted and inaccessible as standard DOM text. |
| `<canvas>` or scrambled-image chapters | Text is rendered purely as pixels without HTML text nodes. |
| Locked paywalls without session access | Browser session cannot access chapters behind paywalls. |
| Hard non-bypassable anti-bot / CAPTCHA gates | Automated requests are blocked until the user manually solves verification in a normal tab. |

## Parser Regression Fixtures

Authoritative inventory of every parser module registered in [src/parsers/index.js](../src/parsers/index.js) and its automated HTML snapshot fixtures verified on every CI run:

| Adapter | Last Verified | Index Fixture | Chapter Fixture | Snapshot Expectations |
| :--- | :--- | :--- | :--- | :--- |
| `wp-lightnovel` | 2026-11-19 | [wp-lightnovel-index.html](../tests/fixtures/wp-lightnovel-index.html) | [wp-lightnovel-chapter.html](../tests/fixtures/wp-lightnovel-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `madara-theme` | 2026-11-11 | [madara-index.html](../tests/fixtures/madara-index.html) | [madara-chapter.html](../tests/fixtures/madara-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `royalroad` | 2026-11-15 | [royalroad-index.html](../tests/fixtures/royalroad-index.html) | [royalroad-chapter.html](../tests/fixtures/royalroad-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `novelmania` | 2026-11-15 | [novelmania-index.html](../tests/fixtures/novelmania-index.html) | [novelmania-chapter.html](../tests/fixtures/novelmania-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `scribblehub` | 2026-11-19 | [scribblehub-index-p1.html](../tests/fixtures/scribblehub-index-p1.html) | [scribblehub-chapter.html](../tests/fixtures/scribblehub-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `novelbin` | 2026-11-20 | [novelbin-index.html](../tests/fixtures/novelbin-index.html) | [novelbin-chapter.html](../tests/fixtures/novelbin-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `generic-html` | 2026-11-11 | [generic-index-p1.html](../tests/fixtures/generic-index-p1.html) | [generic-chapter.html](../tests/fixtures/generic-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
