import { BaseExporter } from './base-exporter.js';
import { escapeXml } from '../core/sanitizer.js';

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

  async exportBook({ metadata, bookTitle, parsedChapters, options, signal }) {
    let coverDataUri = '';
    for (const cUrl of [metadata.coverUrl, metadata.coverThumbUrl].filter(Boolean)) {
      try {
        const resp = await fetch(cUrl, { credentials: 'include', signal });
        if (resp.ok) {
          const blob = await resp.blob();
          coverDataUri = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
          });
          if (coverDataUri) break;
        }
      } catch {
        // Fallback silently if cover cannot be embedded
      }
    }

    const tocLinks = parsedChapters
      .map((p, idx) => `<li><a href="#ch-${idx + 1}">${escapeXml(p.chapter.displayTitle || p.chapterTitle)}</a></li>`)
      .join('\n      ');

    const sections = parsedChapters
      .map((p, idx) => {
        const title = p.chapterTitle;
        const sub = p.subtitle && p.subtitle !== title
          ? `<p class="chapter-subtitle">${escapeXml(p.subtitle)}</p>`
          : '';
        const bodyHtml = this.serializeNodesToInnerHtml(p.nodes);
        return `<article id="ch-${idx + 1}" class="chapter">
  <h2 class="chapter-title">${escapeXml(title)}</h2>
  ${sub}
  <div class="chapter-content">${bodyHtml}</div>
</article>`;
      })
      .join('\n<hr class="chapter-sep"/>\n');

    const coverBlock = coverDataUri
      ? `<div class="cover-wrap"><img src="${escapeXml(coverDataUri)}" alt="Cover"/></div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="${escapeXml(metadata.language || 'pt')}">
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
    ${options.stylesheet || ''}
  </style>
</head>
<body>
  <header>
    ${coverBlock}
    <h1>${escapeXml(bookTitle)}</h1>
    <p class="wpb-center"><strong>Autor:</strong> ${escapeXml(metadata.author || '<unknown>')}</p>
    ${metadata.synopsis ? `<div class="info-box"><p>${escapeXml(metadata.synopsis).replace(/\n+/g, '</p><p>')}</p></div>` : ''}
  </header>
  <nav class="toc-box">
    <h2>Sumário (${parsedChapters.length} capítulos)</h2>
    <ol>
      ${tocLinks}
    </ol>
  </nav>
  <main>
    ${sections}
  </main>
</body>
</html>`;

    return new Blob([html], { type: this.mimeType });
  }
}
