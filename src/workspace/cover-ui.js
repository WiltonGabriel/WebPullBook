import { fetchDocumentWithOptions, normalizeSpaces, toHighResCoverUrl } from '../core/parser-engine.js';
import { parserRegistry } from '../parsers/index.js';
import { $, state, t } from './state.js';
import { appendLog, showBanner } from './logger.js';
import { readMetadataFromUi, updateCoverPreview } from './options-storage.js';

let currentCoverSeq = 0;

export async function handleUploadCoverFile(file) {
  if (!file || !/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type || '')) {
    showBanner(t('msgCoverUploadInvalid'), 'error');
    return;
  }
  const seq = ++currentCoverSeq;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
  if (seq !== currentCoverSeq) return;
  $('meta-cover-url').value = dataUrl;
  readMetadataFromUi();
  updateCoverPreview();
  appendLog(`[IMG] Capa local carregada (${file.type}, ${(file.size / 1024).toFixed(1)} KB)`, 'debug');
  showBanner(t('msgCoverUploaded'), 'success');
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 5) {
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
  return lines.slice(0, maxLines);
}

function drawRoundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWebPullBookEmblem(ctx, cx, cy) {
  ctx.save();

  // Outer subtle ring
  ctx.beginPath();
  ctx.arc(cx, cy, 134, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.36)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Inner circle
  ctx.beginPath();
  ctx.arc(cx, cy, 98, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 132, 199, 0.24)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.75)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Book right cover body
  const bx = cx - 48;
  const by = cy - 64;
  const bw = 112;
  const bh = 128;
  drawRoundedRectPath(ctx, bx + 18, by, bw - 18, bh, 16);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3.2;
  ctx.stroke();

  // Book left spine band
  drawRoundedRectPath(ctx, bx, by, 26, bh, 10);
  ctx.fillStyle = '#0284c7';
  ctx.fill();

  // Spine crease highlight
  ctx.fillStyle = 'rgba(96, 165, 250, 0.55)';
  ctx.fillRect(bx + 23, by + 2, 4, bh - 4);

  // Download arrow inside book cover
  const ax = cx + 10;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(ax, cy - 36);
  ctx.lineTo(ax, cy + 12);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ax - 22, cy - 6);
  ctx.lineTo(ax, cy + 16);
  ctx.lineTo(ax + 22, cy - 6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ax - 28, cy + 36);
  ctx.lineTo(ax + 28, cy + 36);
  ctx.stroke();

  ctx.restore();
}

/**
 * Generates the default WebPullBook cover image (data:image/jpeg;base64,...) featuring
 * the official book-and-arrow logo emblem, book title, and author.
 * Used both automatically when a series has no detected cover and manually via "Generate Cover".
 */
export function generateDefaultCoverDataUrl({ title = '', author = '' } = {}) {
  if (typeof document === 'undefined') return '';
  const cleanTitle = normalizeSpaces(title) || 'WebPullBook';
  const rawAuthor = normalizeSpaces(author);
  const cleanAuthor =
    rawAuthor && rawAuthor !== '<unknown>' ? rawAuthor : 'WebPullBook';

  const w = 800;
  const h = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return '';

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, '#0f172a');
  bgGrad.addColorStop(0.5, '#1e1b4b');
  bgGrad.addColorStop(1, '#0369a1');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Accent gradient for frame and divider
  const accentGrad = ctx.createLinearGradient(48, 0, w - 48, 0);
  accentGrad.addColorStop(0, '#38bdf8');
  accentGrad.addColorStop(1, '#818cf8');

  // Outer rounded frame
  ctx.save();
  drawRoundedRectPath(ctx, 48, 48, w - 96, h - 96, 20);
  ctx.strokeStyle = accentGrad;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();

  // Official WebPullBook emblem
  drawWebPullBookEmblem(ctx, w / 2, 340);

  // Centered Book Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = cleanTitle.length > 55 ? 44 : cleanTitle.length > 32 ? 50 : 56;
  const lineHeight = Math.round(fontSize * 1.26);
  ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`;
  const titleLines = wrapCanvasText(ctx, cleanTitle, w - 180, 4);

  let y = 590;
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillStyle = i === titleLines.length - 1 && titleLines.length > 1 ? '#38bdf8' : '#f8fafc';
    ctx.fillText(titleLines[i], w / 2, y);
    y += lineHeight;
  }

  // Horizontal accent divider
  const dividerY = Math.min(920, y + 22);
  ctx.fillStyle = accentGrad;
  drawRoundedRectPath(ctx, w / 2 - 115, dividerY, 230, 4, 2);
  ctx.fill();

  // Author
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '500 30px system-ui, -apple-system, sans-serif';
  ctx.fillText(cleanAuthor.slice(0, 46), w / 2, h - 175);

  // Footer signature
  ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
  ctx.font = '600 19px system-ui, -apple-system, sans-serif';
  ctx.fillText('WEBPULLBOOK', w / 2, h - 108);

  return typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/jpeg', 0.92) : '';
}

export function handleGenerateCover() {
  currentCoverSeq++;
  readMetadataFromUi();
  const title = state.metadata.title || $('meta-title').value.trim() || 'WebPullBook';
  const author =
    (state.metadata.author && state.metadata.author !== '<unknown>' ? state.metadata.author : '') ||
    $('meta-author').value.trim() ||
    'WebPullBook';

  const dataUrl = generateDefaultCoverDataUrl({ title, author });
  if (!dataUrl) return;
  $('meta-cover-url').value = dataUrl;
  readMetadataFromUi();
  updateCoverPreview();
  showBanner(t('msgCoverGenerated', { title }), 'success');
}

function isHttpUrl(raw) {
  return /^https?:\/\//i.test(String(raw || '').trim());
}

function applyReloadedCover(originalUrl, thumbUrl) {
  const upgraded = toHighResCoverUrl(originalUrl) || originalUrl;
  $('meta-cover-url').value = upgraded;
  readMetadataFromUi();
  state.metadata.coverUrl = upgraded;
  state.metadata.coverThumbUrl = thumbUrl || upgraded;
  updateCoverPreview();
  appendLog(`[IMG] Capa original recarregada em alta resolução: ${upgraded}`, 'debug');
  showBanner(t('msgCoverReloaded'), 'success');
}

/**
 * Restores the series' original cover (saved at load time) after Generate/Clear/Upload,
 * or re-fetches it from the source page when no original was stored.
 */
export async function handleReloadCover() {
  const btn = $('btn-reload-cover');
  const seq = ++currentCoverSeq;
  const current = $('meta-cover-url').value.trim();
  const savedOriginal = state.metadata.originalCoverUrl || state.metadata.originalCoverThumbUrl || '';
  const upgradedOriginal = isHttpUrl(savedOriginal) ? (toHighResCoverUrl(savedOriginal) || savedOriginal) : '';

  if (isHttpUrl(savedOriginal) && savedOriginal !== current && upgradedOriginal !== current) {
    applyReloadedCover(savedOriginal, state.metadata.originalCoverThumbUrl);
    return;
  }

  const sourceUrl = state.metadata.startingUrl || $('starting-url').value.trim();
  if (!isHttpUrl(sourceUrl)) {
    showBanner(t('msgCoverReloadNotFound'), 'info');
    return;
  }

  btn.disabled = true;
  btn.textContent = t('btnReloadingCover');
  try {
    const doc = await fetchDocumentWithOptions(sourceUrl, {
      ...state.options,
      ...(state.seriesRequiresTab ? { renderWithTab: true } : {}),
      onLog: appendLog
    });
    if (seq !== currentCoverSeq) return;
    const parser = parserRegistry.detect(doc, sourceUrl, state.options.parserId || 'auto');
    const meta = {
      ...parser.extractCommonMetadata(doc, sourceUrl),
      ...parser.extractSiteMetadata(doc, sourceUrl)
    };
    const found = meta.coverUrl || meta.coverThumbUrl || '';
    if (isHttpUrl(found)) {
      state.metadata.originalCoverUrl = found;
      state.metadata.originalCoverThumbUrl = meta.coverThumbUrl || found;
      applyReloadedCover(found, meta.coverThumbUrl);
    } else {
      showBanner(t('msgCoverReloadNotFound'), 'info');
    }
  } catch (err) {
    if (seq !== currentCoverSeq) return;
    showBanner(err.message, 'error');
  } finally {
    if (seq === currentCoverSeq) {
      btn.disabled = false;
      btn.textContent = t('btnReloadCover');
    }
  }
}
