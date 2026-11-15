# Reader Profiles Guide

**🇺🇸 English** | [🇧🇷 Português](READER_PRESETS.pt.md)

**WebPullBook** includes quick **Reader Profiles** (available both in the main **Work** tab and at the top of **Advanced Options**). Each profile is a one-click shortcut that configures multiple technical settings at once—everything a profile changes can also be inspected and adjusted individually under **Advanced Options**.

Profiles are **fixed presets** and cannot be edited. Whenever you change **any** option under **Advanced Options** (even one a profile does not control, such as the request delay), the selector automatically switches to **Custom** and stays there until you pick a profile again. Picking a profile fills in all of its options at once.

Each profile sets the same group of Advanced Options in one go: EPUB standard, pop-up footnotes, cover JPEG, image optimization and resolution, image format/quality, skip images, font, text alignment, line height and paragraph indent. Picking a profile (from the **Work** tab or from **Advanced Options**) updates all of those fields on screen immediately. The selector lists profiles in this order: Modern Default, Kobo & E-Readers, Kindle (Modern), Kindle (Legacy), Text Only, Custom, Legacy Default.

---

## Profile Comparison

| Profile | EPUB Standard | Pop-up Footnotes | Cover JPEG | Image Optimization | Max Resolution | Text Alignment | Recommended For |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Modern Default** (`modern`) | EPUB 3 | Yes | Yes | Original (uncompressed) | Original | Justified | Phones, tablets, Apple Books, Thorium, Calibre Viewer |
| **Kobo & E-Readers** (`kobo`) | EPUB 3 | Yes | Yes | Compressed JPEG | 1080px | Justified | Kobo (including Clara/Libra Colour), Tolino, PocketBook |
| **Kindle (Modern)** (`kindle-modern`) | EPUB 3 | Yes | Yes | Compressed JPEG | 1200px | Justified | Calibre KFX/AZW3 conversion via USB, Kindle Colorsoft, modern apps |
| **Kindle (Legacy)** (`kindle`) | EPUB 2 | No | Yes | Compressed JPEG | 1200px | Justified | *Send to Kindle* email/web/app (maximum conversion safety) |
| **Text Only** (`textonly`) | EPUB 3 | Yes | Yes | Images skipped | — | Justified | Ultra-lightweight text-only books and massive serials |
| **Custom** (`custom`) | User-defined | User-defined | User-defined | User-defined | User-defined | User-defined | Activated automatically when any Advanced Option is edited |
| **⚠️ Legacy Default** (`legacy`) | EPUB 2 | No | Yes | Compressed JPEG | 1080px | Justified | Older Sony Reader, early Nook, CoolReader, legacy firmwares |

---

## Which Profile Should I Choose?

1. **Sending directly to Amazon (*Send to Kindle* by email, web, or app)?**
   Use **Kindle (Legacy)**. Amazon's cloud converter can reject certain EPUB 3 XML/HTML5 tags over email; classic **EPUB 2** avoids conversion rejections while optimizing images to 1200px for 300 PPI Paperwhite and Colorsoft displays.
2. **Transferring to Kindle via Calibre (USB → KFX/AZW3)?**
   Use **Kindle (Modern)** so Calibre receives a full **EPUB 3** source with semantic navigation and **EPUB 3 Pop-up Footnotes**.
3. **Reading on Kobo, Tolino, or PocketBook?**
   Use **Kobo & E-Readers** — full EPUB 3 support with 1080px image optimization to keep page turns snappy and preserve full color on color E-Ink screens.
4. **Reading on mobile apps or desktop?**
   Use **Modern Default** to keep full original image quality and EPUB 3 features.
5. **Using a very old e-reader that fails to open modern EPUBs?**
   Use **⚠️ Legacy Default** (classic EPUB 2.0.1 with `toc.ncx`, no SVG cover wrapper, and 1080px JPEG images to stay within low device RAM limits).
