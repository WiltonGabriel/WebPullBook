import { EpubExporter } from './epub-exporter.js';
import { HtmlExporter } from './html-exporter.js';
import { MarkdownExporter } from './markdown-exporter.js';
import { TxtExporter } from './txt-exporter.js';

/**
 * Registry providing polymorphic export across EPUB, HTML, Markdown, and Plain Text.
 */
export class ExporterRegistry {
  constructor(exporters = []) {
    this.exporters = [...exporters];
  }

  get(id = 'epub') {
    return this.exporters.find((e) => e.id === id) || this.exporters[0];
  }

  list() {
    return this.exporters.map((e) => ({ id: e.id, name: e.name, extension: e.extension }));
  }
}

export const exporterRegistry = new ExporterRegistry([
  new EpubExporter(),
  new HtmlExporter(),
  new MarkdownExporter(),
  new TxtExporter()
]);
