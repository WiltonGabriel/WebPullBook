import { BaseExporter } from './base-exporter.js';
import { getBookLocaleLabels } from '../core/epub-templates.js';

export class TxtExporter extends BaseExporter {
  constructor() {
    super({
      id: 'txt',
      name: 'Texto Puro (.txt)',
      extension: 'txt',
      mimeType: 'text/plain;charset=utf-8'
    });
  }

  async exportBook({ metadata, bookTitle, parsedChapters, options = {} }) {
    const labels = getBookLocaleLabels(metadata?.language, options?.uiLang);
    const parts = [
      bookTitle,
      `${labels.author}: ${metadata.author || '<unknown>'}`,
      metadata.startingUrl ? `${labels.source}: ${metadata.startingUrl}` : '',
      metadata.synopsis ? `\n${labels.synopsis}:\n${metadata.synopsis}` : '',
      ''
    ].filter(Boolean);

    for (const parsed of parsedChapters) {
      parts.push('============================================================');
      parts.push(parsed.chapterTitle);
      if (parsed.subtitle && parsed.subtitle !== parsed.chapterTitle) {
        parts.push(parsed.subtitle);
      }
      parts.push('------------------------------------------------------------');
      parts.push(this.nodesToPlainText(parsed.nodes));
      parts.push('');
    }

    return new Blob([parts.join('\n\n')], { type: this.mimeType });
  }
}
