import { BaseExporter } from './base-exporter.js';
import { getBookLocaleLabels } from '../core/epub-templates.js';

export class MarkdownExporter extends BaseExporter {
  constructor() {
    super({
      id: 'md',
      name: 'Markdown (.md)',
      extension: 'md',
      mimeType: 'text/markdown;charset=utf-8'
    });
  }

  async exportBook({ metadata, bookTitle, parsedChapters, options = {} }) {
    const labels = getBookLocaleLabels(metadata?.language, options?.uiLang);
    const parts = [
      `# ${bookTitle}`,
      '',
      `- **${labels.author}:** ${metadata.author || '<unknown>'}`,
      `- **${labels.language}:** ${metadata.language || 'pt'}`,
      metadata.startingUrl ? `- **${labels.source}:** ${metadata.startingUrl}` : null,
      ''
    ].filter((line) => line !== null);

    if (metadata.synopsis) {
      parts.push(`## ${labels.synopsis}`, '', metadata.synopsis, '');
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
