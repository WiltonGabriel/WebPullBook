import { createZipBlob } from './zip.js';
import { extractVolumeNumber, normalizeUrl, toHighResCoverUrl } from './text-utils.js';
import {
  extFromMime,
  fetchImageBytes,
  hashImageBytes,
  isAnimatedImage,
  sniffImageMime,
  tryConvertImage
} from './image-processor.js';
import {
  buildContentOpf,
  buildCoverXhtml,
  buildEpub2TocXhtml,
  buildInfoXhtml,
  buildNavXhtml,
  buildTocNcx,
  groupTocByVolume
} from './epub-templates.js';

export { sniffImageMime };

function randomUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `wpb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  onWarning = () => {},
  signal
}) {
  const buildStartedAt = Date.now();
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

  const parsedQuality = Number(options.imageQuality);
  const customImageQuality = Number.isFinite(parsedQuality)
    ? Math.min(0.98, Math.max(0.4, parsedQuality / 100))
    : null;

  // Cover image
  let coverItem = null;
  let hasCoverPage = false;
  const coverCandidates = [metadata.coverUrl, metadata.coverThumbUrl].filter(Boolean);
  for (const cUrl of coverCandidates) {
    try {
      const { blob, bytes: rawBytes, mime } = await fetchImageBytes(cUrl, signal);
      let bytes = rawBytes;
      let finalMime = mime;
      let converted = false;
      const needsCoverCompat = /^image\/avif$/i.test(mime) || (!epub3 && /^image\/webp$/i.test(mime));
      const isGif = /^image\/gif$/i.test(mime);
      const shouldConvertCover =
        Boolean(options.restrictCoverJpeg) ||
        needsCoverCompat ||
        Boolean(options.grayscaleImages) ||
        (Boolean(options.compressImages) && !isGif);
      if (shouldConvertCover) {
        const conv = await tryConvertImage(
          blob,
          rawBytes,
          mime,
          {
            maxDim: options.compressImages ? (options.compressedResolution || 1200) : 1600,
            forceJpeg: Boolean(options.restrictCoverJpeg) || needsCoverCompat,
            quality: customImageQuality ?? 0.9,
            grayscale: Boolean(options.grayscaleImages)
          },
          { onLog, label: `capa (${cUrl})` }
        );
        bytes = conv.bytes;
        finalMime = conv.mime;
        converted = conv.converted;
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
      onLog(
        `[IMG] Capa OK -> ${href} (${mime}${finalMime !== mime ? ` -> ${finalMime}` : ''}, ${(bytes.length / 1024).toFixed(1)} KB${converted ? ', otimizada' : ''}) <- ${cUrl}`,
        'debug'
      );
      break;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const msg = `Aviso: falha ao carregar capa (${cUrl}): ${err.message}`;
      const logId = onLog(msg, 'warn');
      onWarning({
        kind: 'cover',
        severity: 'light',
        url: cUrl,
        message: err.message,
        logId
      });
    }
  }

  // Information page
  const hasInfoPage = options.addInfoPage !== false;
  const includeTocPage = options.includeTocPage !== false;
  const tocPosition = options.tocPosition === 'end' ? 'end' : 'start';
  const defaultTocLabel = /^en\b/i.test(metadata.language || '') ? 'Table of Contents' : 'Sumário';
  const tocHeading = String(options.tocTitle || '').trim() || defaultTocLabel;
  const infoLabel = String(options.infoPageTitle || '').trim() || (/^en\b/i.test(metadata.language || '') ? 'Information' : 'Informações');

  if (hasInfoPage) {
    entries.push({
      name: 'OEBPS/text/info.xhtml',
      data: buildInfoXhtml({
        metadata,
        bookTitle,
        chapterCount: parsedChapters.length,
        epub3,
        options
      })
    });
  }

  // Map every chapter's normalized source URL to its internal EPUB filename for cross-chapter hyperlink rewriting
  const chapterUrlToFile = new Map();
  for (let i = 0; i < parsedChapters.length; i++) {
    const srcUrl = parsedChapters[i]?.chapter?.url;
    if (!srcUrl || !/^https?:\/\//i.test(srcUrl)) continue;
    const norm = normalizeUrl(srcUrl);
    if (!chapterUrlToFile.has(norm)) {
      chapterUrlToFile.set(norm, `ch_${String(i + 1).padStart(4, '0')}.xhtml`);
    }
  }

  const rewriteInternalChapterLinks = (nodes) => {
    if (chapterUrlToFile.size === 0 || !Array.isArray(nodes)) return;
    for (const root of nodes) {
      if (!root?.querySelectorAll) continue;
      const anchors =
        root.tagName?.toLowerCase() === 'a'
          ? [root, ...Array.from(root.querySelectorAll('a[href]'))]
          : Array.from(root.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const href = (a.getAttribute('href') || '').trim();
        if (!href || href.startsWith('#') || !/^https?:\/\//i.test(href)) continue;
        try {
          const u = new URL(href);
          const hash = u.hash || '';
          u.hash = '';
          const targetFile = chapterUrlToFile.get(normalizeUrl(u.toString()));
          if (targetFile) {
            a.setAttribute('href', `${targetFile}${hash}`);
          }
        } catch {
          // keep original href
        }
      }
    }
  };

  // Inline images + chapter XHTML files
  const imageCache = new Map();
  const imageHashCache = new Map();
  const imageRecords = [];
  const chapterRecords = [];
  let failedImagesCount = 0;

  if (options.skipImages) {
    onLog('[IMG] Imagens desativadas nas opções (skipImages=true)', 'debug');
  }

  for (let i = 0; i < parsedChapters.length; i++) {
    const parsed = parsedChapters[i];

    for (const imgInfo of parsed.images) {
      try {
        let imgRec = imageCache.get(imgInfo.originalUrl);
        if (!imgRec) {
          let fetched = null;
          let usedUrl = imgInfo.originalUrl;
          const imgCandidates = [imgInfo.originalUrl];
          const unproxied = toHighResCoverUrl(imgInfo.originalUrl);
          if (unproxied && unproxied !== imgInfo.originalUrl) {
            imgCandidates.push(unproxied);
          }
          if (imgInfo.fallbackUrl && !imgCandidates.includes(imgInfo.fallbackUrl)) {
            imgCandidates.push(imgInfo.fallbackUrl);
          }
          const imgErrors = [];
          for (const candidateUrl of imgCandidates) {
            try {
              fetched = await fetchImageBytes(candidateUrl, signal);
              usedUrl = candidateUrl;
              break;
            } catch (e) {
              if (e.name === 'AbortError') throw e;
              imgErrors.push(e.message);
            }
          }
          if (!fetched) {
            throw new Error(imgErrors.join(' | ') || 'Failed to fetch image');
          }
          const { blob, bytes: rawBytes, mime } = fetched;
          let bytes = rawBytes;
          let finalMime = mime;
          let converted = false;
          const needsEpub2Convert = /^image\/avif$/i.test(mime) || (!epub3 && /^image\/webp$/i.test(mime));
          const isAnimated = /^image\/gif$/i.test(mime) || isAnimatedImage(rawBytes, mime);
          const shouldConvertImg =
            needsEpub2Convert ||
            Boolean(options.grayscaleImages) ||
            (Boolean(options.compressImages) && !isAnimated);
          if (shouldConvertImg) {
            const forceJpeg = needsEpub2Convert || (options.compressedFormat || 'jpg') === 'jpg';
            const conv = await tryConvertImage(
              blob,
              rawBytes,
              mime,
              {
                maxDim: options.compressImages ? (options.compressedResolution || 1080) : 0,
                forceJpeg,
                quality: options.compressImages ? (customImageQuality ?? 0.85) : 0.92,
                grayscale: Boolean(options.grayscaleImages)
              },
              { onLog, label: `Cap. ${i + 1} (${usedUrl})` }
            );
            bytes = conv.bytes;
            finalMime = conv.mime;
            converted = conv.converted;
          }

          const contentHash = `${finalMime}:${hashImageBytes(bytes)}`;
          const hashHit = imageHashCache.get(contentHash);
          if (hashHit) {
            imgRec = hashHit;
            imageCache.set(imgInfo.originalUrl, imgRec);
            onLog(
              `[IMG] Cap. ${i + 1} deduplicada por conteúdo -> ${imgRec.href} <- ${usedUrl}`,
              'debug'
            );
          } else {
            const idx = imageRecords.length + 1;
            const ext = extFromMime(finalMime);
            const href = `images/img_${String(idx).padStart(4, '0')}.${ext}`;
            imgRec = { id: `img_${idx}`, href, mime: finalMime };
            imageCache.set(imgInfo.originalUrl, imgRec);
            imageHashCache.set(contentHash, imgRec);
            imageRecords.push(imgRec);
            entries.push({ name: `OEBPS/${href}`, data: bytes });
            onLog(
              `[IMG] Cap. ${i + 1} OK -> ${href} (${mime}${finalMime !== mime ? ` -> ${finalMime}` : ''}, ${(bytes.length / 1024).toFixed(1)} KB${converted ? ', otimizada' : ''}) <- ${usedUrl}`,
              'debug'
            );
          }
        } else {
          onLog(`[IMG] Cap. ${i + 1} reutilizada -> ${imgRec.href} <- ${imgInfo.originalUrl}`, 'debug');
        }
        imgInfo.element.setAttribute('src', `../${imgRec.href}`);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        failedImagesCount++;
        const chTitle = parsed.chapter?.displayTitle || parsed.chapterTitle || `Cap. ${i + 1}`;
        const chUrl = parsed.chapter?.url || '';
        const sourceCtx = chUrl ? `página: ${chUrl} | imagem: ${imgInfo.originalUrl}` : imgInfo.originalUrl;
        const msg = `Aviso: falha ao baixar imagem do capítulo "${chTitle}" (${sourceCtx}): ${err.message}`;
        const logId = onLog(msg, 'warn', { chapterIndex: parsed.chapter?.index });
        onWarning({
          kind: 'chapter-image',
          severity: 'light',
          chapterId: parsed.chapter?.id,
          chapterIndex: parsed.chapter?.index ?? i + 1,
          chapterTitle: chTitle,
          chapterUrl: chUrl,
          url: imgInfo.originalUrl,
          message: err.message,
          logId
        });
        imgInfo.element.remove();
        const topIdx = Array.isArray(parsed.nodes) ? parsed.nodes.indexOf(imgInfo.element) : -1;
        if (topIdx !== -1) parsed.nodes.splice(topIdx, 1);
      }
    }

    rewriteInternalChapterLinks(parsed.nodes);

    const chNum = String(i + 1).padStart(4, '0');
    const href = `text/ch_${chNum}.xhtml`;
    const xhtml = parsed.serialize('../styles/stylesheet.css', epub3, {
      popupFootnotes: epub3 && options.popupFootnotes !== false
    });
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
    data: buildTocNcx({ uuid, bookTitle, hasCoverPage, hasInfoPage, infoLabel, tocGroups })
  });
  if (epub3) {
    entries.push({
      name: 'OEBPS/nav.xhtml',
      data: buildNavXhtml({
        bookTitle,
        lang: metadata.language || 'pt',
        tocHeading,
        infoLabel,
        includeTocPage,
        hasCoverPage,
        hasInfoPage,
        tocGroups
      })
    });
  } else if (includeTocPage) {
    entries.push({
      name: 'OEBPS/text/toc.xhtml',
      data: buildEpub2TocXhtml({
        bookTitle,
        tocHeading,
        hasCoverPage,
        hasInfoPage,
        infoLabel,
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
      coverUsesSvg: Boolean(options.useSvgForImages),
      hasInfoPage,
      includeTocPage,
      tocPosition,
      tocHeading,
      chapterRecords,
      imageRecords
    })
  });

  const zipBlob = await createZipBlob(entries);
  const buildMs = Date.now() - buildStartedAt;
  onLog?.(
    `[BUILD] EPUB ${epub3 ? '3' : '2'} empacotado em ${buildMs}ms (${chapterRecords.length} caps, capa=${hasCoverPage ? 'sim' : 'não'}, ${imageRecords.length} imagem(ns)${failedImagesCount > 0 ? `, falhasImg=${failedImagesCount}` : ''}, ${(zipBlob.size / 1024).toFixed(1)} KB)`,
    'debug'
  );
  return zipBlob;
}
