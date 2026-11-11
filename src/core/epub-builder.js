import { createZipBlob } from './zip.js';
import { escapeXml } from './sanitizer.js';
import { extractVolumeNumber, toHighResCoverUrl } from './parser-engine.js';

function randomUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `wpb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fetchImageBytes(url, signal) {
  const resp = await fetch(url, { credentials: 'include', signal });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} while fetching image ${url}`);
  }
  const blob = await resp.blob();
  return { blob, mime: blob.type || 'image/jpeg' };
}

async function convertImageViaCanvas(blob, { maxDim = 1080, forceJpeg = false, quality = 0.88 }) {
  const bitmap = await createImageBitmap(blob);
  try {
    let { width, height } = bitmap;
    if (maxDim > 0 && (width > maxDim || height > maxDim)) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (forceJpeg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const outMime = forceJpeg ? 'image/jpeg' : (blob.type === 'image/png' ? 'image/png' : 'image/jpeg');
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, quality));
    if (!outBlob) {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' };
    }
    return { bytes: new Uint8Array(await outBlob.arrayBuffer()), mime: outMime };
  } finally {
    bitmap.close();
  }
}

function extFromMime(mime) {
  if (/png/i.test(mime)) return 'png';
  if (/gif/i.test(mime)) return 'gif';
  if (/webp/i.test(mime)) return 'webp';
  return 'jpg';
}

function buildCoverXhtml({ title, coverHref, useSvg, epub3 }) {
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

  const bodyContent = useSvg
    ? `<div class="svg_outer"><div class="svg_inner"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="100%" preserveAspectRatio="xMidYMid meet" version="1.1" viewBox="0 0 1000 1400" width="100%"><image width="1000" height="1400" xlink:href="${escapeXml(coverHref)}"/></svg></div></div>`
    : `<div class="svg_outer"><div class="svg_inner"><img src="${escapeXml(coverHref)}" alt="Cover of ${escapeXml(title)}" /></div></div>`;

  return `<?xml version="1.0" encoding="utf-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${epub3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ''}>
<head>
  <meta charset="utf-8" />
  <title>Capa — ${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

function buildInfoXhtml({ metadata, bookTitle, chapterCount, epub3 }) {
  const doctype = epub3
    ? '<!DOCTYPE html>'
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';

  const synParas = (metadata.synopsis || '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join('\n    ');

  const genresLine = metadata.genres?.length
    ? `<p><strong>Gêneros:</strong> ${escapeXml(metadata.genres.join(', '))}</p>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${epub3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ''}>
<head>
  <meta charset="utf-8" />
  <title>Informações — ${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
  <h1>${escapeXml(bookTitle)}</h1>
  <div class="info-box info-meta">
    <p><strong>Autor:</strong> ${escapeXml(metadata.author || '<unknown>')}</p>
    <p><strong>Idioma:</strong> ${escapeXml(metadata.language || 'pt')}</p>
    <p><strong>Capítulos neste arquivo:</strong> ${chapterCount}</p>
    ${genresLine}
    <p><strong>Fonte:</strong> <a href="${escapeXml(metadata.startingUrl)}">${escapeXml(metadata.startingUrl)}</a></p>
  </div>
  ${synParas ? `<h3>Sinopse</h3>\n  <div class="synopsis">\n    ${synParas}\n  </div>` : ''}
</body>
</html>`;
}

function groupTocByVolume(chapterRecords, groupNestedVolumes) {
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

function buildNavXhtml({ bookTitle, lang, hasCoverPage, hasInfoPage, tocGroups }) {
  const items = [];
  if (hasCoverPage) {
    items.push('      <li><a href="text/cover.xhtml">Capa</a></li>');
  }
  if (hasInfoPage) {
    items.push('      <li><a href="text/info.xhtml">Informações</a></li>');
  }

  if (tocGroups.length > 1 || (tocGroups.length === 1 && tocGroups[0].volume)) {
    for (const grp of tocGroups) {
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

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8" />
  <title>Sumário — ${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="styles/stylesheet.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Sumário</h1>
    <ol>
${items.join('\n')}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <ol>
${hasCoverPage ? '      <li><a epub:type="cover" href="text/cover.xhtml">Capa</a></li>\n' : ''}${tocGroups[0]?.items?.[0] ? `      <li><a epub:type="bodymatter" href="${escapeXml(tocGroups[0].items[0].href)}">Início</a></li>\n` : ''}    </ol>
  </nav>
</body>
</html>`;
}

function buildTocNcx({ uuid, bookTitle, hasCoverPage, hasInfoPage, tocGroups }) {
  let playOrder = 1;
  const navPoints = [];
  let maxDepth = 1;

  if (hasCoverPage) {
    navPoints.push(`    <navPoint id="nav-cover" playOrder="${playOrder++}">
      <navLabel><text>Capa</text></navLabel>
      <content src="text/cover.xhtml"/>
    </navPoint>`);
  }
  if (hasInfoPage) {
    navPoints.push(`    <navPoint id="nav-info" playOrder="${playOrder++}">
      <navLabel><text>Informações</text></navLabel>
      <content src="text/info.xhtml"/>
    </navPoint>`);
  }

  const useGroups = tocGroups.length > 1 || (tocGroups.length === 1 && tocGroups[0].volume);
  if (useGroups) {
    maxDepth = 2;
    let volIdx = 1;
    for (const grp of tocGroups) {
      const firstHref = grp.items[0].href;
      const children = grp.items
        .map((rec) => {
          const p = playOrder++;
          return `      <navPoint id="${escapeXml(rec.id)}" playOrder="${p}">
        <navLabel><text>${escapeXml(rec.navTitle)}</text></navLabel>
        <content src="${escapeXml(rec.href)}"/>
      </navPoint>`;
        })
        .join('\n');
      const vp = playOrder++;
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

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx/ncx-2005-1.dtd">
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

function buildContentOpf({
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
  hasInfoPage,
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
  }
  if (coverItem) {
    const props = epub3 ? ' properties="cover-image"' : '';
    manifestItems.push(`    <item id="cover-image" href="${escapeXml(coverItem.href)}" media-type="${escapeXml(coverItem.mime)}"${props}/>`);
  }
  if (hasCoverPage) {
    manifestItems.push('    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>');
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

  const spineItems = [];
  if (hasCoverPage) spineItems.push('    <itemref idref="cover-page"/>');
  if (hasInfoPage) spineItems.push('    <itemref idref="info-page"/>');
  for (const ch of chapterRecords) {
    spineItems.push(`    <itemref idref="${escapeXml(ch.id)}"/>`);
  }

  const epub3SeriesMeta = epub3 && seriesName
    ? `\n    <meta property="belongs-to-collection" id="series-col">${escapeXml(seriesName)}</meta>\n    <meta refines="#series-col" property="collection-type">series</meta>\n    <meta refines="#series-col" property="group-position">${escapeXml(String(seriesIndex ?? 1))}</meta>`
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

  const guide = hasCoverPage
    ? `\n  <guide>\n    <reference type="cover" title="Capa" href="text/cover.xhtml"/>\n  </guide>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="BookId" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookId">urn:uuid:${escapeXml(uuid)}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    ${creatorTag}
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:source>${escapeXml(sourceUrl)}</dc:source>${subjectTags}${descTag}${coverMeta}${modifiedMeta}${epub3SeriesMeta}
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>${guide}
</package>`;
}

/**
 * Assemble an EPUB Blob from parsed chapters and book metadata.
 */
export async function buildEpubBlob({
  metadata,
  bookTitle,
  seriesName = '',
  seriesIndex = 1,
  parsedChapters,
  options,
  groupNestedVolumes = false,
  onLog = () => {},
  signal
}) {
  const epub3 = options.createEpub3 !== false;
  const uuid = randomUuid();
  const entries = [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    },
    {
      name: 'OEBPS/styles/stylesheet.css',
      data: options.stylesheet || ''
    }
  ];

  // Cover image
  let coverItem = null;
  let hasCoverPage = false;
  const coverCandidates = [metadata.coverUrl, metadata.coverThumbUrl].filter(Boolean);
  for (const cUrl of coverCandidates) {
    try {
      const { blob, mime } = await fetchImageBytes(cUrl, signal);
      let bytes;
      let finalMime = mime;
      if (options.restrictCoverJpeg || options.compressImages) {
        const conv = await convertImageViaCanvas(blob, {
          maxDim: options.compressImages ? (options.compressedResolution || 1200) : 1600,
          forceJpeg: Boolean(options.restrictCoverJpeg),
          quality: 0.9
        });
        bytes = conv.bytes;
        finalMime = conv.mime;
      } else {
        bytes = new Uint8Array(await blob.arrayBuffer());
      }
      const ext = extFromMime(finalMime);
      const href = `images/cover.${ext}`;
      coverItem = { href, mime: finalMime };
      entries.push({ name: `OEBPS/${href}`, data: bytes });
      hasCoverPage = true;
      entries.push({
        name: 'OEBPS/text/cover.xhtml',
        data: buildCoverXhtml({
          title: bookTitle,
          coverHref: `../${href}`,
          useSvg: Boolean(options.useSvgForImages),
          epub3
        })
      });
      break;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      onLog(`Aviso: falha ao carregar capa (${cUrl}): ${err.message}`);
    }
  }

  // Information page
  const hasInfoPage = options.addInfoPage !== false;
  if (hasInfoPage) {
    entries.push({
      name: 'OEBPS/text/info.xhtml',
      data: buildInfoXhtml({
        metadata,
        bookTitle,
        chapterCount: parsedChapters.length,
        epub3
      })
    });
  }

  // Inline images + chapter XHTML files
  const imageCache = new Map();
  const imageRecords = [];
  const chapterRecords = [];

  for (let i = 0; i < parsedChapters.length; i++) {
    const parsed = parsedChapters[i];

    for (const imgInfo of parsed.images) {
      try {
        let imgRec = imageCache.get(imgInfo.originalUrl);
        if (!imgRec) {
          let fetched = null;
          const imgCandidates = [imgInfo.originalUrl];
          const unproxied = toHighResCoverUrl(imgInfo.originalUrl);
          if (unproxied && unproxied !== imgInfo.originalUrl) {
            imgCandidates.push(unproxied);
          }
          let lastImgErr = null;
          for (const candidateUrl of imgCandidates) {
            try {
              fetched = await fetchImageBytes(candidateUrl, signal);
              break;
            } catch (e) {
              if (e.name === 'AbortError') throw e;
              lastImgErr = e;
            }
          }
          if (!fetched) throw lastImgErr || new Error('Failed to fetch image');
          const { blob, mime } = fetched;
          let bytes;
          let finalMime = mime;
          if (options.compressImages) {
            const forceJpeg = (options.compressedFormat || 'jpg') === 'jpg';
            const conv = await convertImageViaCanvas(blob, {
              maxDim: options.compressedResolution || 1080,
              forceJpeg,
              quality: 0.85
            });
            bytes = conv.bytes;
            finalMime = conv.mime;
          } else {
            bytes = new Uint8Array(await blob.arrayBuffer());
          }
          const idx = imageRecords.length + 1;
          const ext = extFromMime(finalMime);
          const href = `images/img_${String(idx).padStart(4, '0')}.${ext}`;
          imgRec = { id: `img_${idx}`, href, mime: finalMime };
          imageCache.set(imgInfo.originalUrl, imgRec);
          imageRecords.push(imgRec);
          entries.push({ name: `OEBPS/${href}`, data: bytes });
        }
        imgInfo.element.setAttribute('src', `../${imgRec.href}`);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        onLog(`Aviso: falha ao baixar imagem do capítulo (${imgInfo.originalUrl}): ${err.message}`);
        imgInfo.element.remove();
      }
    }

    const chNum = String(i + 1).padStart(4, '0');
    const href = `text/ch_${chNum}.xhtml`;
    const xhtml = parsed.serialize('../styles/stylesheet.css', epub3);
    entries.push({ name: `OEBPS/${href}`, data: xhtml });

    const navTitle = parsed.chapter.displayTitle || parsed.chapterTitle;
    chapterRecords.push({
      id: `ch_${chNum}`,
      href,
      navTitle,
      chapter: parsed.chapter
    });
  }

  // Navigation & package manifest
  const tocGroups = groupTocByVolume(chapterRecords, groupNestedVolumes);
  entries.push({
    name: 'OEBPS/toc.ncx',
    data: buildTocNcx({ uuid, bookTitle, hasCoverPage, hasInfoPage, tocGroups })
  });
  if (epub3) {
    entries.push({
      name: 'OEBPS/nav.xhtml',
      data: buildNavXhtml({
        bookTitle,
        lang: metadata.language || 'pt',
        hasCoverPage,
        hasInfoPage,
        tocGroups
      })
    });
  }
  entries.push({
    name: 'OEBPS/content.opf',
    data: buildContentOpf({
      uuid,
      bookTitle,
      seriesName,
      seriesIndex: seriesIndex ?? extractVolumeNumber(seriesName),
      author: metadata.author || '<unknown>',
      language: metadata.language || 'pt',
      genres: metadata.genres || [],
      synopsis: metadata.synopsis || '',
      sourceUrl: metadata.startingUrl || '',
      epub3,
      coverItem,
      hasCoverPage,
      hasInfoPage,
      chapterRecords,
      imageRecords
    })
  });

  return await createZipBlob(entries);
}
