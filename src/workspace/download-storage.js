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

async function writeBlobToDirectoryHandle(rootHandle, relativePath, blob) {
  const parts = String(relativePath || '').split('/').filter(Boolean);
  const rawName = parts.pop() || 'webpullbook-ebook.epub';
  let dir = rootHandle;
  for (const seg of parts) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const uniqueName = await resolveUniqueFileNameInDir(dir, rawName);
  const fileHandle = await dir.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
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
  let usedAnchorFallback = false;
  try {
    if (chrome?.downloads?.download) {
      const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: !state.options.noSaveAs,
        conflictAction: 'uniquify'
      });
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(listener);
          resolve();
        };
        const listener = (delta) => {
          if (
            delta.id === downloadId &&
            delta.state &&
            (delta.state.current === 'complete' || delta.state.current === 'interrupted')
          ) {
            finish();
          }
        };
        chrome.downloads.onChanged.addListener(listener);
        const timer = setTimeout(finish, 3000);
        if (chrome.downloads.search) {
          chrome.downloads.search({ id: downloadId }).then((items) => {
            if (items?.[0]?.state === 'complete' || items?.[0]?.state === 'interrupted') {
              finish();
            }
          }).catch(() => {});
        }
      });
    } else {
      usedAnchorFallback = true;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() || 'webpullbook-ebook.epub';
      a.rel = 'noopener';
      a.style.display = 'none';
      const mount = document.body || document.documentElement;
      mount?.appendChild(a);
      a.click();
      a.remove();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), usedAnchorFallback ? 30000 : 5000);
  }
}
