# Security Policy

## Supported Versions

Only the latest released version of **WebPullBook** on the `main` branch receives active fixes and security updates.

| Version | Supported |
| :--- | :--- |
| `1.x` | ✅ Yes |

## Security Model

WebPullBook runs locally inside the user's browser with no external backend servers:

- Untrusted web page HTML is sanitized via `HtmlSanitizer` ([`src/core/sanitizer.js`](../src/core/sanitizer.js)) into strict XHTML before packaging EPUBs or offline HTML files (`<script>`, `<iframe>`, `<object>`, and inline `on*` handlers are stripped).
- No remote analytics, telemetry, or external code loading is used anywhere in the extension.
- Local preferences and Library entries remain inside `chrome.storage.local` and `IndexedDB` (`WebPullBookCache`), while network requests are made directly from the user's browser only to the origin websites the user chooses to extract.
- Full privacy details are documented at `https://wiltongabriel.github.io/WebPullBook/privacy.html`.

## Reporting a Vulnerability

If you discover a security vulnerability (for example, HTML/XHTML sanitization bypass, XSS in the extension workspace, or unsafe CSP behavior):

1. **Do not open a public issue** with exploit details.
2. Report it privately using GitHub's **Security Advisories** (**Security -> Report a vulnerability**) on this repository.
3. Include steps to reproduce, affected HTML snippet or extension component, and the browser version tested.

We will acknowledge your report as soon as possible and coordinate a fix before public disclosure.
