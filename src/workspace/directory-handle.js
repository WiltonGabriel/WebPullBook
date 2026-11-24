import { buildOutputPath } from '../core/parser-engine.js';
import { exporterRegistry } from '../exporters/index.js';
import { $, state, t } from './state.js';

const HANDLE_DB_NAME = 'WebPullBookHandles';
const HANDLE_STORE_NAME = 'handles';
const OUTPUT_DIR_KEY = 'outputDir';

function openHandleDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          db.createObjectStore(HANDLE_STORE_NAME);
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadSavedDirectoryHandle() {
  const db = await openHandleDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let result = null;
    const finish = (val = null) => {
      try {
        db.close();
      } catch {
        // ignore close errors
      }
      resolve(val);
    };
    try {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
      const req = tx.objectStore(HANDLE_STORE_NAME).get(OUTPUT_DIR_KEY);
      req.onsuccess = () => {
        result = req.result || null;
      };
      tx.oncomplete = () => finish(result);
      tx.onerror = () => finish(null);
      tx.onabort = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

export async function persistDirectoryHandle(handle) {
  const db = await openHandleDb();
  if (!db) return;
  await new Promise((resolve) => {
    const finish = () => {
      try {
        db.close();
      } catch {
        // ignore close errors
      }
      resolve();
    };
    try {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
      tx.objectStore(HANDLE_STORE_NAME).put(handle, OUTPUT_DIR_KEY);
      tx.oncomplete = finish;
      tx.onerror = finish;
      tx.onabort = finish;
    } catch {
      finish();
    }
  });
}

export async function clearSavedDirectoryHandle() {
  state.customDirHandle = null;
  state.customDirPermission = 'none';
  const db = await openHandleDb();
  if (!db) return;
  await new Promise((resolve) => {
    const finish = () => {
      try {
        db.close();
      } catch {
        // ignore close errors
      }
      resolve();
    };
    try {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
      tx.objectStore(HANDLE_STORE_NAME).delete(OUTPUT_DIR_KEY);
      tx.oncomplete = finish;
      tx.onerror = finish;
      tx.onabort = finish;
    } catch {
      finish();
    }
  });
}

export async function checkCustomDirStatus() {
  if (!state.customDirHandle) {
    state.customDirPermission = 'none';
    return 'none';
  }
  try {
    if (typeof state.customDirHandle.queryPermission === 'function') {
      state.customDirPermission = await state.customDirHandle.queryPermission({ mode: 'readwrite' });
    } else {
      state.customDirPermission = 'granted';
    }
  } catch {
    state.customDirPermission = 'denied';
  }
  return state.customDirPermission;
}

export function updateSaveLocationUi() {
  const pill = $('save-folder-status');
  const clearBtn = $('btn-use-downloads-folder');
  const pickBtn = $('btn-pick-save-folder');
  if (pickBtn) {
    const canPickFolder = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
    pickBtn.classList.toggle('hidden', !canPickFolder);
  }
  if (!pill || !clearBtn) return;

  const isCustom = state.options.saveTargetMode === 'custom-dir';
  const folderName = state.customDirHandle?.name || state.options.customDirName || 'WebPullBook';

  pill.classList.remove('is-warning');
  if (!isCustom) {
    pill.textContent = t('saveTargetDownloads');
    clearBtn.classList.add('hidden');
    return;
  }

  clearBtn.classList.remove('hidden');
  if (!state.customDirHandle) {
    pill.textContent = t('saveTargetCustomMissing', { name: folderName });
    pill.classList.add('is-warning');
  } else if (state.customDirPermission === 'granted') {
    pill.textContent = t('saveTargetCustomReady', { name: folderName });
  } else {
    pill.textContent = t('saveTargetCustomPrompt', { name: folderName });
  }
}

export function updatePathPreview() {
  const previewEl = $('path-preview-text');
  if (!previewEl) return;

  const layout = $('opt-folder-layout')?.value || state.options.folderLayout || 'root-title';
  const customWrap = $('custom-folder-template-wrap');
  if (customWrap) {
    customWrap.classList.toggle('hidden', layout !== 'custom');
  }

  const fmtId = $('output-format')?.value || state.options.outputFormat || 'epub';
  const exporter = exporterRegistry.get(fmtId);
  const title = $('meta-title')?.value.trim() || state.metadata.title || t('previewSampleTitle');
  const author = $('meta-author')?.value.trim() || state.metadata.author || t('previewSampleAuthor');
  const baseFilename = $('meta-filename')?.value.trim() || state.metadata.filename || title;
  const language = $('meta-language')?.value.trim() || state.metadata.language || 'pt';

  const relPath = buildOutputPath({
    baseFilename,
    title,
    author,
    extension: exporter.extension,
    language,
    options: {
      ...state.options,
      rootFolderName: $('opt-root-folder')?.value ?? state.options.rootFolderName,
      folderLayout: layout,
      customFolderTemplate: $('opt-folder-template')?.value ?? state.options.customFolderTemplate,
      customFilename: $('opt-custom-filename')?.value.trim() || '%Filename%',
      removeIllegal: $('opt-remove-illegal')?.checked !== false
    }
  });

  const basePrefix =
    state.options.saveTargetMode === 'custom-dir' && (state.customDirHandle?.name || state.options.customDirName)
      ? state.customDirHandle?.name || state.options.customDirName
      : 'Downloads';
  previewEl.textContent = `${basePrefix}/${relPath}`;
}
