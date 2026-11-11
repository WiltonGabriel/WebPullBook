import { BaseExporter } from './base-exporter.js';

export class TxtExporter extends BaseExporter {
  constructor() {
    super({
      id: 'txt',
      name: 'Texto Puro (.txt)',
      extension: 'txt',
      mimeType: 'text/plain;charset=utf-8'
    });
  }

  async exportBook({ metadata, bookTitle, parsedChapters }) {
    const parts = [
      bookTitle,
      `Autor: ${metadata.author || '<unknown>'}`,
      metadata.startingUrl ? `Fonte: ${metadata.startingUrl}` : '',
      metadata.synopsis ? `\nSinopse:\n${metadata.synopsis}` : '',
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
