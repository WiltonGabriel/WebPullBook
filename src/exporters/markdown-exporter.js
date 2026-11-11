import { BaseExporter } from './base-exporter.js';

export class MarkdownExporter extends BaseExporter {
  constructor() {
    super({
      id: 'md',
      name: 'Markdown (.md)',
      extension: 'md',
      mimeType: 'text/markdown;charset=utf-8'
    });
  }

  async exportBook({ metadata, bookTitle, parsedChapters }) {
    const parts = [
      `# ${bookTitle}`,
      '',
      `- **Autor:** ${metadata.author || '<unknown>'}`,
      `- **Idioma:** ${metadata.language || 'pt'}`,
      metadata.startingUrl ? `- **Fonte:** ${metadata.startingUrl}` : '',
      ''
    ].filter((line) => line !== null);

    if (metadata.synopsis) {
      parts.push('## Sinopse', '', metadata.synopsis, '');
    }

    for (const parsed of parsedChapters) {
      parts.push('---', '', `## ${parsed.chapterTitle}`);
      if (parsed.subtitle && parsed.subtitle !== parsed.chapterTitle) {
        parts.push(`*${parsed.subtitle}*`);
      }
      parts.push('', this.nodesToMarkdown(parsed.nodes), '');
    }

    return new Blob([parts.join('\n')], { type: this.mimeType });
  }
}
