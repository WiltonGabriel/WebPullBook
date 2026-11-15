# Reader Profiles Guide

**🇺🇸 English** | [🇧🇷 Português](READER_PRESETS.pt.md)

**WebPullBook** includes quick **Reader Profiles** (available both in the main **Work** tab and at the top of **Advanced Options**). Each profile is a one-click shortcut that configures multiple technical settings at once—everything a profile changes can also be inspected and adjusted individually under **Advanced Options**.

Whenever you manually edit any of those fields (for example, changing image resolution or toggling EPUB 3), the profile selector automatically switches to **Custom**.

---

## Profile Comparison

| Profile | EPUB Standard | Pop-up Footnotes | Cover JPEG | Image Optimization | Max Resolution | Text Alignment | Recommended For |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Modern Default** (`modern`) | EPUB 3 | Yes | Yes | Original (uncompressed) | Original | Justified | Phones, tablets, Apple Books, Thorium, Calibre Viewer |
| **Kindle (Send to Kindle)** (`kindle`) | EPUB 2 | No | Yes | Compressed JPEG | 1200px | Justified | *Send to Kindle* email/web/app (maximum conversion safety) |
| **Kindle (Modern / Calibre)** (`kindle-modern`) | EPUB 3 | Yes | Yes | Compressed JPEG | 1200px | Justified | Calibre KFX/AZW3 conversion via USB, Kindle Colorsoft, modern apps |
| **Kobo & E-Readers** (`kobo`) | EPUB 3 | Yes | Yes | Compressed JPEG | 1080px | Justified | Kobo (including Clara/Libra Colour), Tolino, PocketBook |
| **Text Only** (`textonly`) | EPUB 3 | Yes | Yes | Images skipped | — | Kept as configured | Ultra-lightweight text-only books and massive serials |
| **⚠️ Legacy Default** (`legacy`) | EPUB 2 | No | Yes | Compressed JPEG | 1080px | Justified | Older Sony Reader, early Nook, CoolReader, legacy firmwares |
| **Custom** (`custom`) | User-defined | User-defined | User-defined | User-defined | User-defined | User-defined | Activated automatically when any Advanced Option differs from a preset |

---

## Which Profile Should I Choose?

1. **Sending directly to Amazon (*Send to Kindle* by email, web, or app)?**
   Use **Kindle (Send to Kindle)**. Amazon's cloud converter can reject certain EPUB 3 XML/HTML5 tags over email; classic **EPUB 2** avoids conversion rejections while optimizing images to 1200px for 300 PPI Paperwhite and Colorsoft displays.
2. **Transferring to Kindle via Calibre (USB → KFX/AZW3)?**
   Use **Kindle (Modern / Calibre)** so Calibre receives a full **EPUB 3** source with semantic navigation and **EPUB 3 Pop-up Footnotes**.
3. **Reading on Kobo, Tolino, or PocketBook?**
   Use **Kobo & E-Readers** — full EPUB 3 support with 1080px image optimization to keep page turns snappy and preserve full color on color E-Ink screens.
4. **Reading on mobile apps or desktop?**
   Use **Modern Default** to keep full original image quality and EPUB 3 features.
5. **Using a very old e-reader that fails to open modern EPUBs?**
   Use **⚠️ Legacy Default** (classic EPUB 2.0.1 with `toc.ncx`, no SVG cover wrapper, and 1080px JPEG images to stay within low device RAM limits).
