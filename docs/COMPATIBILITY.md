# Compatibility

List of websites and structural patterns tested with **WebPullBook**.
Contributions are welcome—feel free to open a pull request adding sites you have tested.

## Verified Compatible

| Site / Source | Adapter | Last Verified | Reference Fixture | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Central Novel | `wp-lightnovel` | 2026-11-11 | [wp-lightnovel-index.html](../tests/fixtures/wp-lightnovel-index.html) | End-to-end verified: multi-volume detection, cover, synopsis, genres, and full chapter fidelity. |

## Parser Regression Fixtures

Each parser adapter has automated HTML snapshot fixtures verified on every CI run:

| Adapter | Last Verified | Index Fixture | Chapter Fixture | Snapshot Expectations |
| :--- | :--- | :--- | :--- | :--- |
| `wp-lightnovel` | 2026-11-11 | [wp-lightnovel-index.html](../tests/fixtures/wp-lightnovel-index.html) | [wp-lightnovel-chapter.html](../tests/fixtures/wp-lightnovel-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `madara-theme` | 2026-11-11 | [madara-index.html](../tests/fixtures/madara-index.html) | [madara-chapter.html](../tests/fixtures/madara-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |
| `generic-html` | 2026-11-11 | [generic-index-p1.html](../tests/fixtures/generic-index-p1.html) | [generic-chapter.html](../tests/fixtures/generic-chapter.html) | [snapshots.json](../tests/fixtures/snapshots.json) |

## Potentially Compatible

Estimated compatibility based on WebPullBook's current structural DOM adapters and fallback modes (not yet individually verified):

| Pattern / Layout | Adapter / Mode | Notes |
| :--- | :--- | :--- |
| WordPress novel themes (`.eplister`, `.ts-chl-collapsible`, `.epcontent`) | `wp-lightnovel` | Should work out of the box when standard theme selectors are present. |
| Madara-based sites (`.wp-manga-chapter`, `.reading-content`) | `madara-theme` | Expected to detect chapters, volume groups, and chapter body automatically. |
| Static HTML chapter indexes, blogs & paginated lists (`rel="next"`) | `generic-html` | Uses link-cluster scoring and prose density extraction (plus custom CSS selectors). |
| JavaScript / SPA pages (React, Vue, Next.js) | Tab rendering (`renderWithTab`) | Extracts hydrated DOM via background browser tab when static HTML is empty. |
| Open browser tabs | Merge Tabs | Compiles open HTTP/HTTPS tabs into a single ebook using article heuristics. |

## Not Compatible

| Pattern / Limitation | Reason |
| :--- | :--- |
| Proprietary DRM platforms | Content is encrypted and inaccessible as standard DOM text. |
| `<canvas>` or scrambled-image chapters | Text is rendered purely as pixels without HTML text nodes. |
| Locked paywalls without session access | Browser session cannot access chapters behind paywalls. |
