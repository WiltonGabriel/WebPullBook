import { BaseExporter } from './base-exporter.js';
import { buildEpubBlob } from '../core/epub-builder.js';

export class EpubExporter extends BaseExporter {
  constructor() {
    super({
      id: 'epub',
      name: 'EPUB (eBook)',
      extension: 'epub',
      mimeType: 'application/epub+zip'
    });
  }

  async exportBook(context) {
    return buildEpubBlob(context);
  }
}
