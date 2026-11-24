import { buildOutputPath } from '../core/parser-engine.js';
import { state, t } from './state.js';
import { appendLog, showBanner } from './logger.js';
import { saveOptions } from './options-storage.js';
import {
  checkCustomDirStatus,
  clearSavedDirectoryHandle,
  loadSavedDirectoryHandle,
  persistDirectoryHandle,
  updatePathPreview,
  updateSaveLocationUi
} from './directory-handle.js';

export function formatOutputFilename({ baseFilename, title, author, volumeLabel, suffix, extension = 'epub' }) {
  return buildOutputPath({
    baseFilename,
    title,
    author: author || t('authorUnknownPlaceholder'),
    volumeLabel,
    suffix,
    extension,
    language: state.metadata.language,
    options: state.options
  });
}

async function resolveUniqueFileNameInDir(dirHandle, filename) {
  const dotIdx = filename.lastIndexOf('.');
  const stem = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? filename : `${stem} (${attempt})${ext}`;
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        return candidate;
      }
      return filename;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

export async function writeBlobToDirectoryHandle(rootHandle, relativePath, blob) {
  const parts = String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((seg) => seg === '.' || seg === '..' || /[/\\\x00]/.test(seg))) {
    throw new Error(`Invalid relative output path: ${relativePath}`);
  }
  const rawName = parts.pop() || 'webpullbook-ebook.epub';
  let dir = rootHandle;
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const uniqueName = await resolveUniqueFileNameInDir(dir, rawName);
  const fileHandle = await dir.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    await writable.abort?.().catch(() => {});
    throw err;
  }
  return parts.length > 0 ? `${parts.join('/')}/${uniqueName}` : uniqueName;
}

export async function ensureCustomDirWritable() {
  if (state.options.saveTargetMode !== 'custom-dir') {
    return null;
  }
  if (!state.customDirHandle) {
    state.customDirHandle = await loadSavedDirectoryHandle();
  }
  if (!state.customDirHandle) {
    await checkCustomDirStatus();
    updateSaveLocationUi();
    return null;
  }
  try {
    let perm = await checkCustomDirStatus();
    if (perm !== 'granted' && typeof state.customDirHandle.requestPermission === 'function') {
      perm = await state.customDirHandle.requestPermission({ mode: 'readwrite' });
      state.customDirPermission = perm;
    }
    updateSaveLocationUi();
    if (perm === 'granted') {
      return state.customDirHandle;
    }
  } catch (err) {
    appendLog(`Permissão de pasta local falhou: ${err.message}`, 'warn');
  }
  const folderLabel = state.customDirHandle?.name || state.options.customDirName || 'WebPullBook';
  appendLog(t('msgCustomFolderFallback', { name: folderLabel }), 'warn');
  showBanner(t('msgCustomFolderFallback', { name: folderLabel }), 'info');
  return null;
}

export async function saveBookOutput(blob, relativePath, activeDirHandle = null) {
  if (activeDirHandle) {
    try {
      const writtenPath = await writeBlobToDirectoryHandle(activeDirHandle, relativePath, blob);
      return `${activeDirHandle.name}/${writtenPath}`;
    } catch (err) {
      appendLog(`Falha ao gravar na pasta personalizada (${err.message}); usando Downloads.`, 'warn');
    }
  }
  await downloadBlobToChrome(blob, relativePath);
  return `Downloads/${relativePath}`;
}

export async function handlePickSaveFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    showBanner(t('saveTargetUnsupported'), 'error');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: 'webpullbook-output',
      mode: 'readwrite'
    });
    state.customDirHandle = handle;
    state.customDirPermission = 'granted';
    state.options.saveTargetMode = 'custom-dir';
    state.options.customDirName = handle.name;
    await persistDirectoryHandle(handle);
    await saveOptions();
    updateSaveLocationUi();
    updatePathPreview();
    showBanner(t('msgCustomFolderSaved', { name: handle.name }), 'success');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showBanner(err.message, 'error');
    }
  }
}

export async function handleUseDownloadsFolder() {
  state.options.saveTargetMode = 'downloads';
  state.options.customDirName = '';
  await clearSavedDirectoryHandle();
  await saveOptions();
  updateSaveLocationUi();
  updatePathPreview();
  showBanner(t('msgCustomFolderCleared'), 'info');
}

export async function downloadBlobToChrome(blob, filename) {
  const url = URL.createObjectURL(blob);
  const saveAs = !state.options.noSaveAs;
  let revokeTimer = null;
  let revoked = false;
  const revokeNow = () => {
    if (revoked) return;
    revoked = true;
    if (revokeTimer) clearTimeout(revokeTimer);
    URL.revokeObjectURL(url);
  };

  if (chrome?.downloads?.download) {
    let downloadId = null;
    try {
      downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs,
        conflictAction: 'uniquify'
      });
    } catch (err) {
      revokeNow();
      throw err;
    }

    await new Promise((resolve) => {
      let done = false;
      const safetyCeilingMs = saveAs ? 10 * 60 * 1000 : 120 * 1000;
      const awaitLimitMs = saveAs ? 10 * 60 * 1000 : 10000;

      const cleanupListener = () => {
        chrome.downloads.onChanged?.removeListener?.(listener);
      };

      const finish = (completed = false) => {
        if (!done) {
          done = true;
          clearTimeout(awaitTimer);
          resolve();
        }
        if (completed) {
          cleanupListener();
          clearTimeout(safetyTimer);
          revokeTimer = setTimeout(revokeNow, 1000);
          revokeTimer.unref?.();
        }
      };

      const listener = (delta) => {
        if (
          delta.id === downloadId &&
          delta.state &&
          (delta.state.current === 'complete' || delta.state.current === 'interrupted')
        ) {
          finish(true);
        }
      };

      chrome.downloads.onChanged?.addListener?.(listener);

      // Safety ceiling avoids dangling listeners/object URLs if the browser misses onChanged
      const safetyTimer = setTimeout(() => {
        cleanupListener();
        revokeNow();
        finish(false);
      }, safetyCeilingMs);
      safetyTimer.unref?.();

      const awaitTimer = setTimeout(() => {
        finish(false);
      }, awaitLimitMs);
      awaitTimer.unref?.();

      if (chrome.downloads.search) {
        chrome.downloads
          .search({ id: downloadId })
          .then((items) => {
            if (items?.[0]?.state === 'complete' || items?.[0]?.state === 'interrupted') {
              finish(true);
            }
          })
          .catch(() => {});
      }
    });
    return;
  }

  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop() || 'webpullbook-ebook.epub';
    a.rel = 'noopener';
    a.style.display = 'none';
    const mount = document.body || document.documentElement;
    mount?.appendChild(a);
    a.click();
    a.remove();
  } finally {
    revokeTimer = setTimeout(revokeNow, 30000);
    revokeTimer.unref?.();
  }
}
