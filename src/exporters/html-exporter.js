import { BaseExporter } from './base-exporter.js';
import { escapeXml } from '../core/sanitizer.js';
import { fetchImageBytes } from '../core/image-processor.js';
import { getBookLocaleLabels, normalizeBcp47Language } from '../core/epub-templates.js';

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Self-contained single-file HTML reader export with adaptive light/dark styling and TOC.
 */
export class HtmlExporter extends BaseExporter {
  constructor() {
    super({
      id: 'html',
      name: 'HTML Único (Offline)',
      extension: 'html',
      mimeType: 'text/html;charset=utf-8'
    });
  }

  async exportBook({ metadata, bookTitle, parsedChapters, options = {}, signal, onLog = () => {} }) {
    let coverDataUri = '';
    for (const cUrl of [metadata.coverUrl, metadata.coverThumbUrl].filter(Boolean)) {
      try {
        const { bytes, mime } = await fetchImageBytes(cUrl, signal, {
          refererUrl: metadata.startingUrl || ''
        });
        coverDataUri = `data:${mime};base64,${bytesToBase64(bytes)}`;
        break;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }

    const inlineChapterImages = !options.skipImages;
    const chapterImgCache = new Map();
    const sections = [];

    for (let idx = 0; idx < parsedChapters.length; idx++) {
      const p = parsedChapters[idx];
      const title = p.chapterTitle;
      const sub = p.subtitle && p.subtitle !== title
        ? `<p class="chapter-subtitle">${escapeXml(p.subtitle)}</p>`
        : '';

      const renderNodes = (p.nodes || []).map((n) => (n?.cloneNode ? n.cloneNode(true) : n));
      if (inlineChapterImages) {
        const imgEls = [];
        for (const root of renderNodes) {
          if (!root || root.nodeType !== 1) continue;
          if (root.tagName?.toLowerCase() === 'img') imgEls.push(root);
          if (root.querySelectorAll) {
            imgEls.push(...root.querySelectorAll('img'));
          }
        }
        for (const imgEl of imgEls) {
          const src = (imgEl.getAttribute('src') || '').trim();
          if (!/^https?:\/\//i.test(src)) continue;
          let cached = chapterImgCache.get(src);
          if (!cached) {
            try {
              const { bytes, mime } = await fetchImageBytes(src, signal, {
                refererUrl: p.chapter?.url || metadata.startingUrl || '',
                imageFallbacks: p.imageFallbacks
              });
              cached = { dataUri: `data:${mime};base64,${bytesToBase64(bytes)}` };
            } catch (err) {
              if (err?.name === 'AbortError') throw err;
              cached = { failed: true };
              onLog(`[IMG] Aviso: falha ao embutir imagem no HTML (${src}): ${err.message}`, 'warn');
            }
            chapterImgCache.set(src, cached);
          }
          if (cached.dataUri) {
            imgEl.setAttribute('src', cached.dataUri);
          }
        }
      }

      const bodyHtml = this.serializeNodesToInnerHtml(renderNodes, {
        chapterScopePrefix: `ch-${idx + 1}-`
      });
      sections.push(`<article id="ch-${idx + 1}" class="chapter">
  <h2 class="chapter-title">${escapeXml(title)}</h2>
  ${sub}
  <div class="chapter-content">${bodyHtml}</div>
</article>`);
    }

    const tocLinks = parsedChapters
      .map((p, idx) => `<li><a href="#ch-${idx + 1}">${escapeXml(p.chapter.displayTitle || p.chapterTitle)}</a></li>`)
      .join('\n      ');

    const labels = getBookLocaleLabels(metadata.language, options.uiLang);
    const coverBlock = coverDataUri
      ? `<div class="cover-wrap"><img src="${escapeXml(coverDataUri)}" alt="${escapeXml(labels.cover)}"/></div>`
      : '';

    const safeLang = normalizeBcp47Language(metadata.language, 'pt');
    const safeStylesheet = String(options.stylesheet || '').replace(/<\/style/gi, '<\\/style');
    let endBlock = '';
    if (options.addEndPage !== false) {
      const endHeading = String(options.endPageTitle || '').trim() || labels.endOfBook;
      const endMsg = String(options.endPageMessage ?? '').trim() || labels.thankYou;
      const msgHtml = endMsg
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `<p>${escapeXml(l)}</p>`)
        .join('');
      const metaParts = [];
      if (options.endShowSummary !== false) {
        const capWord = labels.chapterWord(parsedChapters.length);
        metaParts.push(`<p><strong>${escapeXml(bookTitle)}</strong> — ${escapeXml(metadata.author || '<unknown>')} (${parsedChapters.length} ${capWord})</p>`);
      }
      if (options.endShowSource !== false && metadata.startingUrl && /^https?:\/\//i.test(metadata.startingUrl)) {
        metaParts.push(`<p>${labels.source}: <a href="${escapeXml(metadata.startingUrl)}">${escapeXml(metadata.startingUrl)}</a></p>`);
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      const genHtml = options.endShowGenerator !== false
        ? `<p class="end-colophon">${labels.generatedWith} • ${dateStr}</p>`
        : '';
      endBlock = `\n  <footer class="end-page">\n    <hr class="end-divider" />\n    <h2>${escapeXml(endHeading)}</h2>\n    <div class="end-message">${msgHtml}</div>\n    ${metaParts.length ? `<div class="end-meta">${metaParts.join('')}</div>` : ''}\n    ${genHtml}\n  </footer>`;
    }

    const tocHeading = String(options.tocTitle || '').trim() || labels.toc;
    const html = `<!DOCTYPE html>
<html lang="${escapeXml(safeLang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeXml(bookTitle)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { max-width: 74ch; margin: 2rem auto; padding: 0 1.25rem; font-size: 1.05rem; }
    .cover-wrap img { max-height: 460px; margin: 0 auto 1.5rem; display: block; border-radius: 8px; }
    .toc-box { border: 1px solid #8884; padding: 1rem 1.25rem; border-radius: 10px; margin: 1.5rem 0 2.5rem; }
    .toc-box ol { max-height: 360px; overflow-y: auto; }
    .chapter-sep { margin: 3rem 0; border: none; border-top: 2px solid #8884; }
    ${safeStylesheet}
  </style>
</head>
<body>
  <header>
    ${coverBlock}
    <h1>${escapeXml(bookTitle)}</h1>
    <p class="wpb-center"><strong>${labels.author}:</strong> ${escapeXml(metadata.author || '<unknown>')}</p>
    ${metadata.synopsis ? `<div class="info-box"><p>${escapeXml(metadata.synopsis).replace(/\n+/g, '</p><p>')}</p></div>` : ''}
  </header>
  <nav class="toc-box">
    <h2>${escapeXml(tocHeading)} (${parsedChapters.length} ${labels.chapterWord(parsedChapters.length)})</h2>
    <ol>
      ${tocLinks}
    </ol>
  </nav>
  <main>
    ${sections.join('\n<hr class="chapter-sep"/>\n')}
  </main>${endBlock}
</body>
</html>`;

    return new Blob([html], { type: this.mimeType });
  }
}
