# Security Policy

**English** | [Português](https://github.com/WiltonGabriel/WebPullBook/blob/main/docs/pt/SECURITY.pt.md)

## Supported Versions

Only the latest released version of **WebPullBook** on the `main` branch receives active fixes and security updates.

| Version | Supported |
| :--- | :--- |
| Latest `1.x` release (`1.7.0-beta`) | Yes |
| Older `1.x` releases | No (update to the latest release) |

## Security Model & Protections

**WebPullBook** is a Manifest V3 browser extension that runs locally inside the user's browser with no external backend servers:

- **Untrusted HTML & XHTML Sanitization:** All extracted chapter HTML is treated as untrusted, sanitized via [`HtmlSanitizer`](https://github.com/WiltonGabriel/WebPullBook/blob/main/src/core/sanitizer.js), and serialized into strict XML/XHTML via [`serializeChapterXhtml`](https://github.com/WiltonGabriel/WebPullBook/blob/main/src/core/xhtml-serializer.js) before packaging EPUB or offline HTML files (`<script>`, `<iframe>`, `<object>`, `<embed>`, event attributes `on*`, invalid XML 1.0 control characters, and unsafe URIs are stripped).
- **Strict Protocol, Image & Archive Validation:** Extracted chapter links, banner actions, cover previews, and SPA background tabs are validated via positive HTTP/HTTPS allowlists (`assertSafeHttpUrl`, `resolveSafeHttpUrl`, `sanitizeCoverPreviewUrl`, and raster-only `data:image/*` allowlists that reject SVGs/HTML payloads). Generated archives validate ZIP entry paths against traversal segments and enforce ZIP32 size/count bounds, while imported settings bundles and per-domain rule JSON pass schema/key-pollution sanitization (`sanitizeImportedOptions`, `sanitizeDomainRules`).
- **Manifest V3 CSP:** Extension UI pages (`src/workspace/workspace.html`) enforce Manifest V3 Content Security Policy with zero inline `<script>` tags or `on*` event handlers (enforced on every CI run by `scripts/check.mjs`).
- **SPA & Anti-Bot Guardrails:** Background tab rendering (`TabRenderPool`) uses a per-domain circuit breaker and pauses automatically on Cloudflare/CAPTCHA challenges or HTTP 429 rate limits. WebPullBook never circumvents DRM, locked paywalls, or anti-bot challenges.
- **No Telemetry or External Servers:** No analytics, crash reporting, or remote code loading exists anywhere in the codebase. Preferences, Library items, domain rules, and chapter cache remain on the user's device (`chrome.storage.local`, `IndexedDB` `WebPullBookCache`, and optional user-selected folder via `showDirectoryPicker`). Network requests are sent directly from the user's browser only to the websites chosen by the user.
- **Privacy Policy:** Full details are available in the [Privacy Policy](https://wiltongabriel.github.io/WebPullBook/privacy.html).

## Scope Notes

- **In Scope:** XSS in the extension workspace or official website, HTML/XHTML sanitization bypasses in exported EPUB/HTML outputs, unsafe URL/protocol handling (`javascript:`, `data:text/html`), unsafe `chrome.tabs`/`chrome.scripting` execution, or Manifest V3 CSP violations.
- **Expected Behavior (Out of Scope):** Because WebPullBook is a client-side Web-to-EPUB extractor, fetching HTTP/HTTPS pages or images explicitly requested by the user within their browser session is intentional core functionality.

## Reporting a Vulnerability

If you discover a security vulnerability in **WebPullBook**:

1. **Do not open a public issue** with exploit details or proof-of-concept payloads.
2. Report it privately using GitHub **Private Vulnerability Reporting** on this repository (**Security → Advisories → Report a vulnerability**).
3. Include clear steps to reproduce, the affected HTML snippet or module (`src/...` or `website/...`), and the browser/version tested.

We will acknowledge reports as soon as possible and coordinate a fix before public disclosure.
