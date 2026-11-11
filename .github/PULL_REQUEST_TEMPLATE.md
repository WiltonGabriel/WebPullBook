## Summary

Describe the changes introduced by this pull request and link any related issue.

Fixes #(issue)

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New parser adapter (`src/parsers/`)
- [ ] New exporter or format improvement (`src/exporters/`)
- [ ] UI / i18n / Library / Accessibility improvement (`src/workspace/`)
- [ ] Documentation update (`README`, `docs/`, `CONTRIBUTING.md`)

## Checklist

- [ ] Tested unpacked extension in Chrome/Chromium (`chrome://extensions/`).
- [ ] Verified no inline `<script>` or inline `on*` event handlers were added in HTML (MV3 CSP compliance).
- [ ] Verified generated `.epub` / exported output structure (XHTML/OPF/NCX/NAV) and tested readability (e.g., Calibre or EPUB reader).
- [ ] Confirmed no unrelated third-party domains or brand names are hardcoded inside `src/`.
- [ ] Updated `README.md` / `README.en.md` / `docs/COMPATIBILITY*.md` if user-facing behavior or compatibility changed.
