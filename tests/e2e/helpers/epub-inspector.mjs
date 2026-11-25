import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readZipArchive } from '../../helpers/zip-reader.js';
import { runEpubCheck } from '../../helpers/epubcheck.js';
import { sniffImageMime } from '../../../src/core/image-processor.js';

const FORBIDDEN_XHTML_TAGS = ['script', 'style', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'textarea'];
const WATERMARK_LEAK_RX =
  /stolen from royal road|unauthorizedly aggregated|read this novel on royal road|__cf_email__|data-cfemail/i;

/**
 * Deeply validates a generated EPUB file: W3C EPUBCheck, ZIP container ordering,
 * OPF/NAV/NCX metadata, XHTML XML integrity, forbidden tags, images, and readability.
 */
export async function inspectEpubFile(
  epubPath,
  { expectedVersion = null, minChapters = 1, requireCover = true, requireImages = false } = {}
) {
  const issues = [];
  const warnings = [];
  const bytes = fs.readFileSync(epubPath);
  const epubCheck = runEpubCheck(epubPath);
  if (epubCheck.available && !epubCheck.ok) {
    issues.push(`EPUBCheck failed:\n${epubCheck.output}`);
  } else if (!epubCheck.available && process.env.REQUIRE_EPUBCHECK === '1') {
    issues.push('EPUBCheck required by REQUIRE_EPUBCHECK=1 but not available');
  }

  const archive = await readZipArchive(bytes);
  const fileNames = Array.from(archive.files.keys());

  if (fileNames[0] !== 'mimetype') {
    issues.push(`First ZIP entry must be "mimetype", found "${fileNames[0]}"`);
  }
  const mimetypeText = archive.files.get('mimetype')?.text() || '';
  if (mimetypeText !== 'application/epub+zip') {
    issues.push(`Invalid mimetype content: "${mimetypeText}"`);
  }

  const opfEntry = archive.files.get('OEBPS/content.opf');
  if (!opfEntry) {
    issues.push('Missing OEBPS/content.opf');
    return { ok: false, epubCheck, issues, warnings, summary: null };
  }
  const opfDom = new JSDOM(opfEntry.text(), { contentType: 'application/xml' });
  const pkgEl = opfDom.window.document.documentElement;
  const pkgVersion = pkgEl.getAttribute('version') || '';
  if (expectedVersion === 3 && pkgVersion !== '3.0') {
    issues.push(`Expected EPUB 3.0 package version, found "${pkgVersion}"`);
  }
  if (expectedVersion === 2 && pkgVersion !== '2.0') {
    issues.push(`Expected EPUB 2.0 package version, found "${pkgVersion}"`);
  }

  const hasNav = archive.files.has('OEBPS/nav.xhtml');
  const hasNcx = archive.files.has('OEBPS/toc.ncx');
  if (pkgVersion === '3.0' && !hasNav) issues.push('EPUB 3.0 missing OEBPS/nav.xhtml');
  if (pkgVersion === '2.0' && hasNav) issues.push('EPUB 2.0 must not include OEBPS/nav.xhtml');
  if (!hasNcx) issues.push('Missing OEBPS/toc.ncx');

  const getTagText = (localName) => {
    const els = opfDom.window.document.getElementsByTagNameNS('*', localName);
    return els[0]?.textContent?.trim() || '';
  };
  const title = getTagText('title');
  const creator = getTagText('creator');
  const language = getTagText('language');
  if (!title) issues.push('Missing dc:title in OPF');
  if (!language) issues.push('Missing dc:language in OPF');

  const imageEntries = fileNames.filter((n) => n.startsWith('OEBPS/images/'));
  const coverFiles = imageEntries.filter((n) => /\/cover\.[^/]+$/i.test(n));
  if (requireCover && coverFiles.length === 0) {
    issues.push('Missing cover image under OEBPS/images/cover.*');
  }
  for (const imgName of imageEntries) {
    const imgBytes = archive.files.get(imgName).data;
    const sniffed = sniffImageMime(imgBytes);
    if (!sniffed) {
      issues.push(`Invalid or non-raster image magic bytes for ${imgName} (${imgBytes.length} bytes)`);
    }
  }

  const chapterFiles = fileNames.filter((n) => /^OEBPS\/text\/ch_\d+\.xhtml$/i.test(n)).sort();
  if (chapterFiles.length < minChapters) {
    issues.push(`Expected at least ${minChapters} chapter XHTML file(s), found ${chapterFiles.length}`);
  }

  let totalImagesReferenced = 0;
  const chapterReports = [];

  for (const chPath of chapterFiles) {
    const xmlStr = archive.files.get(chPath).text();
    let xhtmlDoc;
    try {
      const dom = new JSDOM(xmlStr, { contentType: 'application/xhtml+xml' });
      xhtmlDoc = dom.window.document;
    } catch (err) {
      issues.push(`Invalid XHTML XML in ${chPath}: ${err.message}`);
      continue;
    }

    const body = xhtmlDoc.getElementsByTagNameNS('*', 'body')[0];
    if (!body) {
      issues.push(`Missing <body> in ${chPath}`);
      continue;
    }

    for (const tag of FORBIDDEN_XHTML_TAGS) {
      const found = body.getElementsByTagNameNS('*', tag);
      if (found.length > 0) {
        issues.push(`Forbidden <${tag}> tag leaked into ${chPath} (${found.length})`);
      }
    }

    for (const el of Array.from(body.getElementsByTagName('*'))) {
      for (const attr of Array.from(el.attributes || [])) {
        if (/^on/i.test(attr.name)) {
          issues.push(`Inline event handler ${attr.name} leaked into ${chPath}`);
        }
      }
      if ((el.getAttribute('class') || '').split(/\s+/).includes('sr-only')) {
        warnings.push(`sr-only class present in ${chPath}`);
      }
    }

    const bodyText = (body.textContent || '').replace(/\s+/g, ' ').trim();
    const pEls = Array.from(body.getElementsByTagNameNS('*', 'p'));
    const hTitle =
      body.getElementsByTagNameNS('*', 'h1')[0]?.textContent?.trim() ||
      body.getElementsByTagNameNS('*', 'h2')[0]?.textContent?.trim() ||
      '';
    const imgs = Array.from(body.getElementsByTagNameNS('*', 'img'));

    if (WATERMARK_LEAK_RX.test(xmlStr)) {
      issues.push(`Watermark/obfuscation pattern leaked in ${chPath}`);
    }
    if (bodyText.length < 40 && imgs.length === 0) {
      issues.push(`Chapter ${chPath} appears empty or severely truncated (${bodyText.length} chars)`);
    }
    if (pEls.length === 1 && bodyText.length > 1800) {
      warnings.push(`Chapter ${chPath} has 1 giant <p> of ${bodyText.length} chars (check paragraph splitting)`);
    }

    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      totalImagesReferenced++;
      if (!src.startsWith('../images/')) {
        issues.push(`Non-local or unbundled img src "${src}" in ${chPath}`);
        continue;
      }
      const zipImgPath = `OEBPS/${src.replace(/^\.\.\//, '')}`;
      if (!archive.files.has(zipImgPath)) {
        issues.push(`Missing referenced image ${zipImgPath} in ZIP (from ${chPath})`);
      }
    }

    chapterReports.push({
      file: chPath,
      heading: hTitle,
      chars: bodyText.length,
      paragraphs: pEls.length,
      imgCount: imgs.length
    });
  }

  if (requireImages && totalImagesReferenced === 0) {
    warnings.push('Expected at least 1 embedded chapter image, found 0');
  }

  return {
    ok: issues.length === 0,
    epubCheck,
    issues,
    warnings,
    summary: {
      sizeBytes: bytes.length,
      pkgVersion,
      title,
      creator,
      language,
      hasInfoPage: archive.files.has('OEBPS/text/info.xhtml'),
      hasNav,
      hasNcx,
      coverFiles,
      chapterImageFiles: imageEntries.filter((n) => !/\/cover\.[^/]+$/i.test(n)),
      chapters: chapterReports
    }
  };
}
