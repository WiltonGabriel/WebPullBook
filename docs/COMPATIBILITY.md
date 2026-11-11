# Compatibility

List of websites and structural patterns tested with **WebPullBook**.
Contributions are welcome—feel free to open a pull request adding sites you have tested.

## Verified Compatible

| Site / Source | Adapter | Notes |
| :--- | :--- | :--- |
| Central Novel | `wp-lightnovel` | End-to-end verified: multi-volume detection, cover, synopsis, genres, and full chapter fidelity. |

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
