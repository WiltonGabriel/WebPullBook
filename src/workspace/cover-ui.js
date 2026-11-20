import { normalizeSpaces } from '../core/parser-engine.js';
import { $, state, t } from './state.js';
import { appendLog, showBanner } from './logger.js';
import { readMetadataFromUi, updateCoverPreview } from './options-storage.js';

export async function handleUploadCoverFile(file) {
  if (!file || !/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type || '')) {
    showBanner(t('msgCoverUploadInvalid'), 'error');
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
  $('meta-cover-url').value = dataUrl;
  readMetadataFromUi();
  updateCoverPreview();
  appendLog(`[IMG] Capa local carregada (${file.type}, ${(file.size / 1024).toFixed(1)} KB)`, 'debug');
  showBanner(t('msgCoverUploaded'), 'success');
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = normalizeSpaces(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 7);
}

export function handleGenerateCover() {
  readMetadataFromUi();
  const title = state.metadata.title || $('meta-title').value.trim() || 'WebPullBook';
  const author =
    (state.metadata.author && state.metadata.author !== '<unknown>' ? state.metadata.author : '') ||
    $('meta-author').value.trim() ||
    'WebPullBook Edition';

  const w = 800;
  const h = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#162032');
  grad.addColorStop(1, '#263447');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 56, h);
  ctx.fillStyle = 'rgba(96, 165, 250, 0.45)';
  ctx.fillRect(56, 0, 8, h);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(102, 72, w - 150, h - 144);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 58px Georgia, serif';
  ctx.textBaseline = 'top';
  const titleLines = wrapCanvasText(ctx, title, w - 230);
  let y = 210;
  for (const line of titleLines) {
    ctx.fillText(line, 148, y);
    y += 76;
  }

  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(148, Math.min(820, y + 32), 140, 6);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '34px system-ui, -apple-system, sans-serif';
  ctx.fillText(author.slice(0, 48), 148, h - 220);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.fillText('WEBPULLBOOK', 148, h - 135);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  $('meta-cover-url').value = dataUrl;
  readMetadataFromUi();
  updateCoverPreview();
  showBanner(t('msgCoverGenerated', { title }), 'success');
}
