/**
 * Pure XML/XHTML template builders for EPUB 2 & EPUB 3 package documents
 * (cover.xhtml, info.xhtml, toc.xhtml, nav.xhtml, toc.ncx, content.opf).
 */
import { escapeXml } from './sanitizer.js';

export function normalizeBcp47Language(raw, fallback = 'pt') {
  const normalized = String(raw || '')
    .trim()
    .replace(/_/g, '-');
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(normalized)) {
    return normalized;
  }
  return fallback;
}

export function getBookLocaleLabels(lang, uiLang = '') {
  const rawLang = String(lang || '').trim();
  const norm = rawLang ? normalizeBcp47Language(rawLang, '') : '';
  let isEn;
  if (/^en(?:-|$)/i.test(norm)) {
    isEn = true;
  } else if (/^pt(?:-|$)/i.test(norm)) {
    isEn = false;
  } else if (!norm) {
    isEn = /^en(?:-|$)/i.test(String(uiLang || '').trim());
  } else {
    isEn = !/^pt(?:-|$)/i.test(String(uiLang || '').trim());
  }
  return isEn
    ? {
        isEn: true,
        cover: 'Cover',
        coverOf: (t) => `Cover — ${t}`,
        author: 'Author',
        language: 'Language',
        chaptersInFile: 'Chapters in this file',
        genres: 'Genres',
        source: 'Source',
        synopsis: 'Synopsis',
        info: 'Information',
        toc: 'Table of Contents',
        start: 'Start',
        endOfBook: 'End of Book',
        thankYou: 'Thank you for reading!',
        chapterWord: (n) => (n === 1 ? 'chapter' : 'chapters'),
        generatedWith: 'Generated with WebPullBook'
      }
    : {
        isEn: false,
        cover: 'Capa',
        coverOf: (t) => `Capa — ${t}`,
        author: 'Autor',
        language: 'Idioma',
        chaptersInFile: 'Capítulos neste arquivo',
        genres: 'Gêneros',
        source: 'Fonte',
        synopsis: 'Sinopse',
        info: 'Informações',
        toc: 'Sumário',
        start: 'Início',
        endOfBook: 'Fim do Livro',
        thankYou: 'Obrigado por ler!',
        chapterWord: (n) => (n === 1 ? 'capítulo' : 'capítulos'),
        generatedWith: 'Gerado com WebPullBook'
      };
}

export function buildCoverXhtml({ title, coverHref, useSvg = false, epub3 = true, lang = '', uiLang = '' }) {
  const labels = getBookLocaleLabels(lang, uiLang);
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

  const bodyContent = useSvg
    ? `<div class="svg_outer"><div class="svg_inner"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="100%" preserveAspectRatio="xMidYMid meet" version="1.1" viewBox="0 0 1000 1400" width="100%"><image width="1000" height="1400" xlink:href="${escapeXml(coverHref)}"/></svg></div></div>`
    : `<div class="svg_outer"><div class="svg_inner"><img src="${escapeXml(coverHref)}" alt="${escapeXml(labels.coverOf(title))}" /></div></div>`;

  const metaTag = epub3
    ? '<meta charset="utf-8" />'
    : '<meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />';

  return `<?xml version="1.0" encoding="utf-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${epub3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ''}>
<head>
  ${metaTag}
  <title>${escapeXml(labels.coverOf(title))}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

export function buildInfoXhtml({ metadata, bookTitle, chapterCount, epub3, options = {} }) {
  const labels = getBookLocaleLabels(metadata?.language, options?.uiLang);
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

  const showTitle = options.infoShowTitle !== false;
  const showAuthor = options.infoShowAuthor !== false;
  const showGenres = options.infoShowGenres !== false;
  const showSource = options.infoShowSource !== false;
  const showSynopsis = options.infoShowSynopsis !== false;
  const customHeading = String(options.infoPageTitle || '').trim();
  const displayHeading = customHeading || bookTitle;

  const synParas = showSynopsis
    ? (metadata.synopsis || '')
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${escapeXml(p)}</p>`)
        .join('\n    ')
    : '';

  const metaLines = [];
  if (showAuthor) {
    metaLines.push(`<p><strong>${labels.author}:</strong> ${escapeXml(metadata.author || '<unknown>')}</p>`);
    metaLines.push(`<p><strong>${labels.language}:</strong> ${escapeXml(metadata.language || 'pt')}</p>`);
    metaLines.push(`<p><strong>${labels.chaptersInFile}:</strong> ${chapterCount}</p>`);
  }
  if (showGenres && metadata.genres?.length) {
    metaLines.push(`<p><strong>${labels.genres}:</strong> ${escapeXml(metadata.genres.join(', '))}</p>`);
  }
  if (showSource && metadata.startingUrl) {
    const rawSource = String(metadata.startingUrl).trim();
    if (/^https?:\/\//i.test(rawSource)) {
      metaLines.push(
        `<p><strong>${labels.source}:</strong> <a href="${escapeXml(rawSource)}">${escapeXml(rawSource)}</a></p>`
      );
    } else {
      metaLines.push(`<p><strong>${labels.source}:</strong> ${escapeXml(rawSource)}</p>`);
    }
  }

  const metaBox = metaLines.length > 0
    ? `  <div class="info-box info-meta">\n    ${metaLines.join('\n    ')}\n  </div>\n`
    : '';
  const headingBlock = showTitle ? `  <h1>${escapeXml(displayHeading)}</h1>\n` : '';
  const synopsisBlock = synParas
    ? `  <h2>${labels.synopsis}</h2>\n  <div class="synopsis">\n    ${synParas}\n  </div>\n`
    : '';
  const fallbackBlock =
    !headingBlock && !metaBox && !synopsisBlock ? `  <p>${escapeXml(displayHeading)}</p>\n` : '';

  const metaTag = epub3
    ? '<meta charset="utf-8" />'
    : '<meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />';

  return `<?xml version="1.0" encoding="utf-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${epub3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ''}>
<head>
  ${metaTag}
  <title>${escapeXml(customHeading || `${labels.info} — ${bookTitle}`)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
${headingBlock}${metaBox}${synopsisBlock}${fallbackBlock}</body>
</html>`;
}

export function buildEndXhtml({ metadata, bookTitle, chapterCount, epub3, options = {} }) {
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

  const labels = getBookLocaleLabels(metadata?.language, options?.uiLang);
  const defaultHeading = labels.endOfBook;
  const defaultMessage = labels.thankYou;

  const heading = String(options.endPageTitle || '').trim() || defaultHeading;
  const rawMessage = String(options.endPageMessage ?? '').trim();
  const messageText = rawMessage || defaultMessage;
  const showSummary = options.endShowSummary !== false;
  const showSource = options.endShowSource !== false;
  const showGenerator = options.endShowGenerator !== false;

  const messageParas = messageText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `      <p>${escapeXml(line)}</p>`)
    .join('\n');

  const metaLines = [];
  if (showSummary) {
    const capWord = labels.chapterWord(chapterCount);
    metaLines.push(`      <p><strong>${escapeXml(bookTitle)}</strong></p>`);
    metaLines.push(
      `      <p>${labels.author}: ${escapeXml(metadata?.author || '<unknown>')} • ${chapterCount} ${capWord}</p>`
    );
  }
  if (showSource && metadata?.startingUrl && /^https?:\/\//i.test(metadata.startingUrl)) {
    metaLines.push(
      `      <p>${labels.source}: <a href="${escapeXml(metadata.startingUrl)}">${escapeXml(metadata.startingUrl)}</a></p>`
    );
  }

  const metaBlock =
    metaLines.length > 0 ? `    <div class="end-meta">\n${metaLines.join('\n')}\n    </div>\n` : '';
  const dateStr = new Date().toISOString().slice(0, 10);
  const colophonBlock = showGenerator
    ? `    <p class="end-colophon">${labels.generatedWith} • ${dateStr}</p>\n`
    : '';

  const metaTag = epub3
    ? '<meta charset="utf-8" />'
    : '<meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />';

  return `<?xml version="1.0" encoding="utf-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${epub3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ''}>
<head>
  ${metaTag}
  <title>${escapeXml(heading)} — ${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
  <div class="end-page">
    <hr class="end-divider" />
    <h1>${escapeXml(heading)}</h1>
    <div class="end-message">
${messageParas}
    </div>
${metaBlock}${colophonBlock}    <hr class="end-divider" />
  </div>
</body>
</html>`;
}

export function buildEpub2TocXhtml({
  bookTitle,
  tocHeading,
  coverLabel = 'Capa',
  hasCoverPage,
  hasInfoPage,
  infoLabel,
  hasEndPage = false,
  endLabel = 'Fim do Livro',
  tocGroups
}) {
  const items = [];
  if (hasCoverPage) {
    items.push(`    <li><a href="cover.xhtml">${escapeXml(coverLabel)}</a></li>`);
  }
  if (hasInfoPage) {
    items.push(`    <li><a href="info.xhtml">${escapeXml(infoLabel)}</a></li>`);
  }

  const relHref = (href) => String(href || '').replace(/^text\//, '');
  if (tocGroups.length > 1 || (tocGroups.length === 1 && tocGroups[0].volume)) {
    for (const grp of tocGroups) {
      if (!grp.items?.length) continue;
      const firstHref = relHref(grp.items[0].href);
      items.push(`    <li><a href="${escapeXml(firstHref)}">${escapeXml(grp.volume)}</a>\n      <ol>`);
      for (const rec of grp.items) {
        items.push(`        <li><a href="${escapeXml(relHref(rec.href))}">${escapeXml(rec.navTitle)}</a></li>`);
      }
      items.push('      </ol>\n    </li>');
    }
  } else {
    for (const grp of tocGroups) {
      for (const rec of grp.items) {
        items.push(`    <li><a href="${escapeXml(relHref(rec.href))}">${escapeXml(rec.navTitle)}</a></li>`);
      }
    }
  }
  if (hasEndPage) {
    items.push(`    <li><a href="end.xhtml">${escapeXml(endLabel)}</a></li>`);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
  <title>${escapeXml(tocHeading)} — ${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
  <h1>${escapeXml(tocHeading)}</h1>
  <ol>
${items.join('\n')}
  </ol>
</body>
</html>`;
}

export function groupTocByVolume(chapterRecords, groupNestedVolumes) {
  if (!groupNestedVolumes) {
    return [{ volume: null, items: chapterRecords }];
  }
  const groups = [];
  let current = null;
  for (const rec of chapterRecords) {
    const vol = rec.chapter.volume || 'Volume 01';
    if (!current || current.volume !== vol) {
      current = { volume: vol, items: [] };
      groups.push(current);
    }
    current.items.push(rec);
  }
  return groups;
}

export function buildNavXhtml({
  bookTitle,
  lang,
  tocHeading = 'Sumário',
  coverLabel = 'Capa',
  startLabel = 'Início',
  infoLabel = 'Informações',
  hasEndPage = false,
  endLabel = 'Fim do Livro',
  includeTocPage = true,
  hasCoverPage,
  hasInfoPage,
  tocGroups
}) {
  const items = [];
  if (hasCoverPage) {
    items.push(`      <li><a href="text/cover.xhtml">${escapeXml(coverLabel)}</a></li>`);
  }
  if (hasInfoPage) {
    items.push(`      <li><a href="text/info.xhtml">${escapeXml(infoLabel)}</a></li>`);
  }

  if (tocGroups.length > 1 || (tocGroups.length === 1 && tocGroups[0].volume)) {
    for (const grp of tocGroups) {
      if (!grp.items?.length) continue;
      const firstHref = grp.items[0].href;
      items.push(`      <li><a href="${escapeXml(firstHref)}">${escapeXml(grp.volume)}</a>\n        <ol>`);
      for (const rec of grp.items) {
        items.push(`          <li><a href="${escapeXml(rec.href)}">${escapeXml(rec.navTitle)}</a></li>`);
      }
      items.push('        </ol>\n      </li>');
    }
  } else {
    for (const grp of tocGroups) {
      for (const rec of grp.items) {
        items.push(`      <li><a href="${escapeXml(rec.href)}">${escapeXml(rec.navTitle)}</a></li>`);
      }
    }
  }
  if (hasEndPage) {
    items.push(`      <li><a href="text/end.xhtml">${escapeXml(endLabel)}</a></li>`);
  }

  const safeLang = normalizeBcp47Language(lang, 'pt');
  const landmarkItems = [];
  if (hasCoverPage) {
    landmarkItems.push(`      <li><a epub:type="cover" href="text/cover.xhtml">${escapeXml(coverLabel)}</a></li>`);
  }
  if (includeTocPage) {
    landmarkItems.push(`      <li><a epub:type="toc" href="nav.xhtml">${escapeXml(tocHeading)}</a></li>`);
  }
  if (tocGroups[0]?.items?.[0]) {
    landmarkItems.push(`      <li><a epub:type="bodymatter" href="${escapeXml(tocGroups[0].items[0].href)}">${escapeXml(startLabel)}</a></li>`);
  }
  const landmarksBlock = landmarkItems.length > 0
    ? `\n  <nav epub:type="landmarks" id="landmarks" hidden="hidden">\n    <ol>\n${landmarkItems.join('\n')}\n    </ol>\n  </nav>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(safeLang)}" lang="${escapeXml(safeLang)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(tocHeading)} — ${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles/stylesheet.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(tocHeading)}</h1>
    <ol>
${items.join('\n')}
    </ol>
  </nav>${landmarksBlock}
</body>
</html>`;
}

export function buildTocNcx({
  uuid,
  bookTitle,
  coverLabel = 'Capa',
  hasCoverPage,
  hasInfoPage,
  infoLabel = 'Informações',
  hasEndPage = false,
  endLabel = 'Fim do Livro',
  tocGroups
}) {
  let playOrder = 1;
  const navPoints = [];
  let maxDepth = 1;

  if (hasCoverPage) {
    navPoints.push(`    <navPoint id="nav-cover" playOrder="${playOrder++}">
      <navLabel><text>${escapeXml(coverLabel)}</text></navLabel>
      <content src="text/cover.xhtml"/>
    </navPoint>`);
  }
  if (hasInfoPage) {
    navPoints.push(`    <navPoint id="nav-info" playOrder="${playOrder++}">
      <navLabel><text>${escapeXml(infoLabel)}</text></navLabel>
      <content src="text/info.xhtml"/>
    </navPoint>`);
  }

  const useGroups = tocGroups.length > 1 || (tocGroups.length === 1 && tocGroups[0].volume);
  if (useGroups) {
    maxDepth = 2;
    let volIdx = 1;
    for (const grp of tocGroups) {
      if (!grp.items?.length) continue;
      const firstHref = grp.items[0].href;
      // Parent volume navPoint shares playOrder with its first chapter because both target firstHref
      const vp = playOrder;
      const children = grp.items
        .map((rec) => {
          const p = playOrder++;
          return `      <navPoint id="${escapeXml(rec.id)}" playOrder="${p}">
        <navLabel><text>${escapeXml(rec.navTitle)}</text></navLabel>
        <content src="${escapeXml(rec.href)}"/>
      </navPoint>`;
        })
        .join('\n');
      navPoints.push(`    <navPoint id="nav-vol-${volIdx++}" playOrder="${vp}">
      <navLabel><text>${escapeXml(grp.volume)}</text></navLabel>
      <content src="${escapeXml(firstHref)}"/>
${children}
    </navPoint>`);
    }
  } else {
    for (const grp of tocGroups) {
      for (const rec of grp.items) {
        navPoints.push(`    <navPoint id="${escapeXml(rec.id)}" playOrder="${playOrder++}">
      <navLabel><text>${escapeXml(rec.navTitle)}</text></navLabel>
      <content src="${escapeXml(rec.href)}"/>
    </navPoint>`);
      }
    }
  }
  if (hasEndPage) {
    navPoints.push(`    <navPoint id="nav-end" playOrder="${playOrder++}">
      <navLabel><text>${escapeXml(endLabel)}</text></navLabel>
      <content src="text/end.xhtml"/>
    </navPoint>`);
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${escapeXml(uuid)}"/>
    <meta name="dtb:depth" content="${maxDepth}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
${navPoints.join('\n')}
  </navMap>
</ncx>`;
}

export function buildContentOpf({
  uuid,
  bookTitle,
  seriesName,
  seriesIndex,
  author,
  language,
  genres = [],
  synopsis,
  sourceUrl,
  epub3,
  coverItem,
  hasCoverPage,
  coverUsesSvg = false,
  hasInfoPage,
  hasEndPage = false,
  includeTocPage = true,
  coverLabel = 'Capa',
  tocHeading = 'Sumário',
  chapterRecords,
  imageRecords
}) {
  const version = epub3 ? '3.0' : '2.0';
  const modifiedIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const manifestItems = [
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '    <item id="css" href="styles/stylesheet.css" media-type="text/css"/>'
  ];
  if (epub3) {
    manifestItems.push('    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  } else if (includeTocPage) {
    manifestItems.push('    <item id="toc-page" href="text/toc.xhtml" media-type="application/xhtml+xml"/>');
  }
  if (coverItem) {
    const props = epub3 ? ' properties="cover-image"' : '';
    manifestItems.push(`    <item id="cover-image" href="${escapeXml(coverItem.href)}" media-type="${escapeXml(coverItem.mime)}"${props}/>`);
  }
  if (hasCoverPage) {
    const coverPageProps = epub3 && coverUsesSvg ? ' properties="svg"' : '';
    manifestItems.push(`    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"${coverPageProps}/>`);
  }
  if (hasInfoPage) {
    manifestItems.push('    <item id="info-page" href="text/info.xhtml" media-type="application/xhtml+xml"/>');
  }
  for (const img of imageRecords) {
    manifestItems.push(`    <item id="${escapeXml(img.id)}" href="${escapeXml(img.href)}" media-type="${escapeXml(img.mime)}"/>`);
  }
  for (const ch of chapterRecords) {
    manifestItems.push(`    <item id="${escapeXml(ch.id)}" href="${escapeXml(ch.href)}" media-type="application/xhtml+xml"/>`);
  }
  if (hasEndPage) {
    manifestItems.push('    <item id="end-page" href="text/end.xhtml" media-type="application/xhtml+xml"/>');
  }

  const tocSpineId = epub3 ? 'nav' : 'toc-page';
  const spineItems = [];
  if (hasCoverPage) spineItems.push('    <itemref idref="cover-page"/>');
  if (hasInfoPage) spineItems.push('    <itemref idref="info-page"/>');
  if (includeTocPage) {
    spineItems.push(`    <itemref idref="${tocSpineId}"/>`);
  }
  for (const ch of chapterRecords) {
    spineItems.push(`    <itemref idref="${escapeXml(ch.id)}"/>`);
  }
  if (hasEndPage) {
    spineItems.push('    <itemref idref="end-page"/>');
  }

  const safeLang = normalizeBcp47Language(language, 'pt');
  const parsedSeriesIdx = Number(seriesIndex);
  const safeSeriesIndex = Number.isFinite(parsedSeriesIdx) && parsedSeriesIdx > 0 ? String(parsedSeriesIdx) : '1';
  const epub3SeriesMeta = epub3 && seriesName
    ? `\n    <meta property="belongs-to-collection" id="series-col">${escapeXml(seriesName)}</meta>\n    <meta refines="#series-col" property="collection-type">series</meta>\n    <meta refines="#series-col" property="group-position">${escapeXml(safeSeriesIndex)}</meta>`
    : '';

  const coverMeta = coverItem ? '\n    <meta name="cover" content="cover-image"/>' : '';
  const modifiedMeta = epub3 ? `\n    <meta property="dcterms:modified">${modifiedIso}</meta>` : '';
  const descTag = synopsis ? `\n    <dc:description>${escapeXml(synopsis)}</dc:description>` : '';
  const subjectTags = (genres || [])
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => `\n    <dc:subject>${escapeXml(g)}</dc:subject>`)
    .join('');
  const creatorTag = epub3
    ? `<dc:creator id="creator">${escapeXml(author)}</dc:creator>\n    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>`
    : `<dc:creator>${escapeXml(author)}</dc:creator>`;

  const sourceTag = sourceUrl ? `\n    <dc:source>${escapeXml(sourceUrl)}</dc:source>` : '';
  const packageLangAttr = epub3 ? ` xml:lang="${escapeXml(safeLang)}"` : '';

  const guideRefs = [];
  if (hasCoverPage) {
    guideRefs.push(`    <reference type="cover" title="${escapeXml(coverLabel)}" href="text/cover.xhtml"/>`);
  }
  if (includeTocPage) {
    const tocHref = epub3 ? 'nav.xhtml' : 'text/toc.xhtml';
    guideRefs.push(`    <reference type="toc" title="${escapeXml(tocHeading)}" href="${tocHref}"/>`);
  }
  const guide = guideRefs.length > 0 ? `\n  <guide>\n${guideRefs.join('\n')}\n  </guide>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="BookId"${packageLangAttr}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:uuid:${escapeXml(uuid)}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    ${creatorTag}
    <dc:language>${escapeXml(safeLang)}</dc:language>${sourceTag}${subjectTags}${descTag}${coverMeta}${modifiedMeta}${epub3SeriesMeta}
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>${guide}
</package>`;
}
