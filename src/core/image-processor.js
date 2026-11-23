/**
 * Image pipeline for EPUB packaging: magic-byte MIME sniffing, resilient fetching
 * (credentialed + anonymous retry + DNR Referer fallback), and safe canvas optimization.
 */
import { applyImageRefererRule, clearImageRefererRules } from './dnr-rules.js';

export function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: GIF87a / GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // AVIF: ....ftyp(avif|avis|mif1)
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
      return 'image/avif';
    }
  }
  // BMP: BM
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  // Detect mislabeled HTML error pages returned as HTTP 200
  let head = '';
  const limit = Math.min(bytes.length, 96);
  for (let i = 0; i < limit; i++) {
    head += String.fromCharCode(bytes[i]);
  }
  const trimmed = head.trimStart().toLowerCase();
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(trimmed)) {
    return 'text/html';
  }
  if (/^<svg\b/i.test(trimmed)) {
    return 'image/svg+xml';
  }
  return null;
}

export function decodeDataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/is);
  if (!match) throw new Error('Invalid data URL for image');
  const declaredMime = (match[1] || 'image/png').trim().toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  let bytes;
  if (isBase64) {
    const bin = atob(payload);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  const sniffed = sniffImageMime(bytes);
  const mime = sniffed && sniffed !== 'text/html' ? sniffed : declaredMime;
  return { blob: new Blob([bytes], { type: mime }), bytes, mime };
}

export async function fetchImageBytes(url, signal, { refererUrl = '' } = {}) {
  if (/^data:/i.test(String(url || ''))) {
    return decodeDataUrlToBlob(url);
  }
  let resp = null;
  let firstErr = null;
  try {
    resp = await fetch(url, { credentials: 'include', signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    firstErr = err;
  }

  // Some CDNs / S3 buckets reject credentialed requests or Referer headers with 400/401/403/404/406 or CORS errors
  if (!resp || !resp.ok) {
    try {
      const anonResp = await fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal
      });
      if (anonResp.ok || !resp) {
        resp = anonResp;
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (!resp && firstErr) throw firstErr;
      if (!resp) throw err;
    }
  }

  // Some hotlink-protected CDNs reject fetches lacking a same-site/source Referer header
  if ((!resp || !resp.ok) && refererUrl && /^https?:\/\//i.test(refererUrl)) {
    const installed = await applyImageRefererRule(url, refererUrl);
    if (installed) {
      try {
        const refResp = await fetch(url, { credentials: 'include', signal });
        if (refResp.ok || !resp) {
          resp = refResp;
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (!resp && firstErr) throw firstErr;
        if (!resp) throw err;
      } finally {
        await clearImageRefererRules();
      }
    }
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} while fetching image ${url}`);
  }
  const rawBlob = await resp.blob();
  const bytes = new Uint8Array(await rawBlob.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`Empty image payload while fetching ${url}`);
  }
  const declaredMime = (rawBlob.type || '').split(';')[0].trim().toLowerCase();
  if (
    declaredMime &&
    (/^text\//i.test(declaredMime) || /^application\/(?:json|xml|xhtml\+xml)/i.test(declaredMime))
  ) {
    throw new Error(`Invalid image MIME (${declaredMime}) while fetching ${url}`);
  }
  const sniffed = sniffImageMime(bytes);
  if (sniffed === 'text/html') {
    throw new Error(`Invalid image payload (HTML) while fetching ${url}`);
  }
  const mime =
    sniffed ||
    (declaredMime && /^image\//i.test(declaredMime) ? declaredMime : 'image/jpeg');
  const blob = rawBlob.type === mime ? rawBlob : new Blob([bytes], { type: mime });
  return { blob, bytes, mime };
}

export async function convertImageViaCanvas(
  blob,
  { maxDim = 1080, forceJpeg = false, quality = 0.88, grayscale = false }
) {
  const bitmap = await createImageBitmap(blob);
  try {
    let { width, height } = bitmap;
    if (maxDim > 0 && (width > maxDim || height > maxDim)) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (forceJpeg) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    if (grayscale) {
      ctx.filter = 'grayscale(100%)';
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const outMime = forceJpeg ? 'image/jpeg' : (blob.type === 'image/png' ? 'image/png' : 'image/jpeg');
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, quality));
    if (!outBlob) {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' };
    }
    return { bytes: new Uint8Array(await outBlob.arrayBuffer()), mime: outMime };
  } finally {
    bitmap.close();
  }
}

export async function tryConvertImage(blob, rawBytes, rawMime, convertOpts, { onLog, label }) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    onLog?.(`[IMG] Canvas indisponível para ${label}; mantendo original (${rawMime})`, 'debug');
    return { bytes: rawBytes, mime: rawMime, converted: false };
  }
  try {
    const conv = await convertImageViaCanvas(blob, convertOpts);
    return { bytes: conv.bytes, mime: conv.mime, converted: true };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    onLog?.(
      `[IMG] Conversão via canvas falhou em ${label} (${err?.message || err}); mantendo imagem original (${rawMime}, ${(rawBytes.length / 1024).toFixed(1)} KB)`,
      'warn'
    );
    return { bytes: rawBytes, mime: rawMime, converted: false };
  }
}

export function extFromMime(mime) {
  if (/png/i.test(mime)) return 'png';
  if (/gif/i.test(mime)) return 'gif';
  if (/webp/i.test(mime)) return 'webp';
  if (/avif/i.test(mime)) return 'avif';
  if (/bmp/i.test(mime)) return 'bmp';
  return 'jpg';
}

/**
 * Compute a fast deterministic content fingerprint (byte length + 32-bit rolling hash)
 * so identical images served under different URLs are embedded only once in the EPUB.
 */
export function hashImageBytes(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  let hash = 0;
  for (let i = 0; i < arr.length; i++) {
    hash = ((hash << 5) - hash + arr[i]) | 0;
  }
  const lenHex = (arr.length >>> 0).toString(16).padStart(8, '0');
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${lenHex}-${hashHex}`;
}

/**
 * Inspect binary chunks to detect animated GIF, APNG (acTL), or animated WebP (ANIM/ANMF)
 * so compression never flattens animated illustrations.
 */
export function isAnimatedImage(bytes, mime = '') {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  const lower = String(mime || '').toLowerCase();
  if (arr.length < 16) return false;
  if (lower !== 'image/gif' && lower !== 'image/png' && lower !== 'image/webp') {
    return false;
  }

  const scanLimit = Math.min(arr.length, 65536) - 4;
  if (lower === 'image/gif') {
    let gceCount = 0;
    for (let i = 6; i <= scanLimit; i++) {
      if (arr[i] === 0x21 && arr[i + 1] === 0xf9 && arr[i + 2] === 0x04) {
        gceCount++;
        if (gceCount >= 2) return true;
      }
    }
    return false;
  }
  if (lower === 'image/png') {
    // APNG animation control chunk: "acTL" (0x61 0x63 0x54 0x4C)
    for (let i = 8; i <= scanLimit; i++) {
      if (arr[i] === 0x61 && arr[i + 1] === 0x63 && arr[i + 2] === 0x54 && arr[i + 3] === 0x4c) {
        return true;
      }
    }
    return false;
  }
  if (lower === 'image/webp') {
    // Animated WebP chunks: "ANIM" or "ANMF"
    for (let i = 12; i <= scanLimit; i++) {
      if (
        arr[i] === 0x41 &&
        arr[i + 1] === 0x4e &&
        ((arr[i + 2] === 0x49 && arr[i + 3] === 0x4d) || (arr[i + 2] === 0x4d && arr[i + 3] === 0x46))
      ) {
        return true;
      }
    }
  }
  return false;
}
