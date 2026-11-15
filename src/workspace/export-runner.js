import {
  buildOutputPath,
  downloadAndParseChapter,
  extractVolumeNumber,
  sleep
} from '../core/parser-engine.js';
import {
  cacheStore,
  hydrateCachedChapter,
  serializeNodesForCache
} from '../core/cache-store.js';
import { exporterRegistry } from '../exporters/index.js';
import { $, getCacheKey, getCurrentSeriesKey, state, t } from './state.js';
import { appendLog, hideBanner, renderExportReport, showBanner } from './logger.js';
import {
  checkCustomDirStatus,
  clearSavedDirectoryHandle,
  loadSavedDirectoryHandle,
  persistDirectoryHandle,
  readMetadataFromUi,
  readOptionsFromUi,
  saveOptions,
  updatePathPreview,
  updateSaveLocationUi
} from './options-storage.js';
import { getChapterFromCaches, persistSessionSnapshot, renderChaptersTable } from './chapters-ui.js';

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

async function ensureCustomDirWritable() {
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

async function saveBookOutput(blob, relativePath, activeDirHandle = null) {
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
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop();
      a.click();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export async function waitWhilePaused(signal) {
  let announcedPause = false;
  let prevLabel = '';
  while (state.paused) {
    if (!announcedPause) {
      prevLabel = $('progress-label')?.textContent || '';
      if ($('progress-label')) $('progress-label').textContent = t('progressPaused');
      announcedPause = true;
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((r) => setTimeout(r, 250));
  }
  if (announcedPause && $('progress-label')?.textContent === t('progressPaused') && prevLabel) {
    $('progress-label').textContent = prevLabel;
  }
}

async function enforceSafeThrottle(networkTimestamps, networkFetchCount, signal) {
  readOptionsFromUi();
  const effectiveBaseDelay = Math.max(
    state.options.delayMs || 0,
    state.activeParser?.minDelayMs || 0
  );
  if (!state.options.safeMode) {
    if (effectiveBaseDelay > 0) {
      await sleep(effectiveBaseDelay, signal);
    }
    return;
  }

  const batchN = state.options.safeBatchSize ?? 25;
  if (batchN > 0 && networkFetchCount > 0 && networkFetchCount % batchN === 0) {
    $('progress-detail').textContent = `Modo Seguro: pausa curta de respiro (10s)...`;
    await sleep(10000, signal);
  }

  const minDelay = Math.max(effectiveBaseDelay, 1800);
  const jittered = minDelay + Math.round(Math.random() * 1400);
  await sleep(jittered, signal);

  const maxRpm = Math.max(5, state.options.safeRpm || 22);
  const now = Date.now();
  while (networkTimestamps.length > 0 && now - networkTimestamps[0] >= 60000) {
    networkTimestamps.shift();
  }
  if (networkTimestamps.length >= maxRpm) {
    const waitMs = Math.max(500, 60500 - (now - networkTimestamps[0]));
    $('progress-detail').textContent = `Modo Seguro: aguardando janela RPM (${Math.ceil(waitMs / 1000)}s)...`;
    await sleep(waitMs, signal);
  }
}

export async function handlePackEpub(arg = {}) {
  if (state.running) return;
  const externalSignal = arg && typeof arg === 'object' && 'aborted' in (arg.externalSignal || {})
    ? arg.externalSignal
    : null;
  readMetadataFromUi();
  readOptionsFromUi();

  const selected = state.chapters.filter((c) => c.included);
  if (selected.length === 0) {
    showBanner(t('msgSelectAtLeastOne'), 'error');
    return;
  }

  const activeDirHandle = await ensureCustomDirWritable();

  state.running = true;
  if (!externalSignal) {
    state.paused = false;
    state.abortController = new AbortController();
  }
  const signal = externalSignal || state.abortController.signal;

  $('btn-pack-epub').disabled = true;
  $('btn-retry-failed').classList.add('hidden');
  $('btn-pause').disabled = false;
  $('btn-cancel').disabled = false;
  $('progress-box').classList.remove('hidden');
  $('btn-pause').textContent = state.paused ? t('btnResume') : t('btnPause');
  hideBanner();

  await saveOptions();
  await persistSessionSnapshot();

  const mode = document.querySelector('input[name="pack-mode"]:checked')?.value || 'by-volume';
  const jobs = [];

  if (mode === 'by-volume') {
    const volMap = new Map();
    for (const ch of selected) {
      const vol = ch.volume || 'Volume 01';
      if (!volMap.has(vol)) volMap.set(vol, []);
      volMap.get(vol).push(ch);
    }
    const isSeparateBook = Boolean(state.metadata.separateBooksMode);
    for (const [vol, list] of volMap.entries()) {
      jobs.push({
        volumeLabel: vol,
        bookTitle: isSeparateBook ? vol : `${state.metadata.title} — ${vol}`,
        seriesName: isSeparateBook ? '' : state.metadata.title,
        seriesIndex: isSeparateBook ? 1 : extractVolumeNumber(vol),
        chapters: list,
        groupNestedVolumes: false
      });
    }
  } else {
    const maxPer = state.options.maxChaptersPerEpub;
    if (selected.length > maxPer) {
      let part = 1;
      for (let i = 0; i < selected.length; i += maxPer) {
        const slice = selected.slice(i, i + maxPer);
        jobs.push({
          volumeLabel: `Parte ${String(part).padStart(2, '0')}`,
          bookTitle: `${state.metadata.title} — Parte ${part}`,
          seriesName: state.metadata.title,
          seriesIndex: part,
          chapters: slice,
          groupNestedVolumes: true
        });
        part++;
      }
    } else {
      jobs.push({
        volumeLabel: '',
        bookTitle: state.metadata.title,
        seriesName: '',
        seriesIndex: 1,
        chapters: selected,
        groupNestedVolumes: true
      });
    }
  }

  const totalChaptersAll = selected.length;
  let completedGlobal = 0;
  let filesGenerated = 0;
  let totalOkChapters = 0;
  let totalFailedChapters = 0;
  let networkFetchCount = 0;
  let cacheHits = 0;
  const packStartedAt = Date.now();
  const networkTimestamps = [];
  const allPackagedChapters = [];
  const chapterErrors = [];
  const imageWarnings = [];
  const exporter = exporterRegistry.get(state.options.outputFormat);
  const extUpper = exporter.extension.toUpperCase();
  const seriesKey = getCurrentSeriesKey();

  for (const ch of selected) {
    ch.warnings = [];
    if (ch.status === 'error') {
      ch.logId = '';
    }
  }

  try {
    const batchWidth = state.options.safeMode
      ? 1
      : Math.max(1, Math.min(6, Number(state.options.concurrency) || 1));

    appendLog(
      `[CFG] Exportação ${exporter.name} (${extUpper}) | epub3=${Boolean(state.options.createEpub3)}, popupNotes=${state.options.popupFootnotes !== false}, compressImgs=${Boolean(state.options.compressImages)}, skipImgs=${Boolean(state.options.skipImages)}, spa=${Boolean(state.seriesRequiresTab || state.options.renderWithTab)}, safeMode=${Boolean(state.options.safeMode)}, concorrência=${batchWidth}x, destino=${activeDirHandle ? activeDirHandle.name : 'Downloads'}`,
      'debug'
    );
    appendLog(
      `Iniciando exportação (${exporter.name}): ${jobs.length} arquivo(s) ${extUpper}, ${totalChaptersAll} capítulos no total${state.options.safeMode ? ' [Modo Seguro]' : batchWidth > 1 ? ` [${batchWidth}x paralelo]` : ''}.`
    );

    const processSingleChapterFetch = async (ch) => {
      const cacheKey = getCacheKey(ch.url);
      const cachedHydrated = await getChapterFromCaches(ch, cacheKey);
      if (cachedHydrated) {
        ch.status = 'ok';
        ch.errorMsg = '';
        ch.logId = '';
        cacheHits++;
        return { kind: 'ok', ch, hydrated: cachedHydrated, fromNetwork: false };
      }

      ch.status = 'downloading';
      renderChaptersTable();

      try {
        networkTimestamps.push(Date.now());
        const chapterFetchOptions = state.seriesRequiresTab
          ? { ...state.options, renderWithTab: true, onLog: appendLog }
          : { ...state.options, onLog: appendLog };
        const parsed = await downloadAndParseChapter(ch, state.activeParser, chapterFetchOptions, signal);
        networkFetchCount++;

        const cacheRec = {
          chapterTitle: parsed.chapterTitle,
          subtitle: parsed.subtitle,
          contentXml: serializeNodesForCache(parsed.nodes)
        };
        state.chapterCache.set(cacheKey, cacheRec);
        await cacheStore.putChapter({
          key: cacheKey,
          seriesKey,
          chapterUrl: ch.url,
          chapterTitle: cacheRec.chapterTitle,
          subtitle: cacheRec.subtitle,
          nodes: parsed.nodes,
          ttlDays: state.options.cacheTtlDays
        });

        ch.status = 'ok';
        ch.errorMsg = '';
        ch.logId = '';
        return { kind: 'ok', ch, hydrated: hydrateCachedChapter(ch, cacheRec), fromNetwork: true };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if ((err.isRateLimit || err.isAntiBotChallenge) && state.options.autoPauseOnRateLimit !== false) {
          ch.status = 'error';
          ch.errorMsg = err.message;
          ch.logId = appendLog(
            err.isAntiBotChallenge
              ? `VERIFICAÇÃO ANTI-BOT detectada em "${ch.displayTitle}" (${ch.url}) — pausando fila automaticamente!`
              : `BLOQUEIO DE TAXA (${err.status || 503}) detectado em "${ch.displayTitle}" (${ch.url}) — pausando fila automaticamente!`,
            'error'
          );
          return {
            kind: 'pause',
            ch,
            fromNetwork: true,
            pauseTrigger: err.isAntiBotChallenge
              ? { kind: 'antibot', url: ch.url }
              : { kind: 'ratelimit', status: err.status || 429 }
          };
        }
        if (err.status === 404 && state.options.skip404) {
          ch.status = 'skipped';
          ch.errorMsg = 'HTTP 404';
          ch.logId = appendLog(`404 pulado: ${ch.url}`, 'warn');
          return { kind: 'skipped', ch, fromNetwork: true };
        }
        ch.status = 'error';
        ch.errorMsg = err.message;
        totalFailedChapters++;
        ch.logId = appendLog(`FALHA no capítulo "${ch.displayTitle}" (${ch.url}): ${err.message}`, 'error');
        chapterErrors.push({
          chapterIndex: ch.index,
          chapterTitle: ch.displayTitle,
          chapterUrl: ch.url,
          message: err.message,
          logId: ch.logId
        });
        if (state.options.continueOnError === false) throw err;
        return { kind: 'error', ch, fromNetwork: true };
      }
    };

    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const parsedChapters = [];

      let c = 0;
      while (c < job.chapters.length) {
        await waitWhilePaused(signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const waveStart = c;
        const wave = job.chapters.slice(c, c + batchWidth);
        const firstCh = wave[0];
        $('progress-label').textContent = `(${j + 1}/${jobs.length}) ${job.volumeLabel || extUpper}`;
        $('progress-detail').textContent = `${firstCh.displayTitle} (${completedGlobal + 1}/${totalChaptersAll})`;
        const pct = Math.round((completedGlobal / totalChaptersAll) * 100);
        $('progress-bar').value = pct;
        $('progress-pct').textContent = `${pct}%`;

        const waveResults = await Promise.all(wave.map((ch) => processSingleChapterFetch(ch)));
        let waveHadNetwork = false;
        let pausedAtOffset = -1;

        for (let k = 0; k < waveResults.length; k++) {
          const res = waveResults[k];
          if (res.fromNetwork) waveHadNetwork = true;
          if (res.kind === 'pause') {
            pausedAtOffset = k;
            renderChaptersTable();
            await persistSessionSnapshot();
            networkTimestamps.length = 0;
            state.paused = true;
            $('btn-pause').textContent = t('btnResume');
            showBanner(
              res.pauseTrigger.kind === 'antibot'
                ? t('msgAntiBotPaused', { url: res.pauseTrigger.url })
                : t('msgRateLimitPaused', { status: res.pauseTrigger.status }),
              'error'
            );
            await state.onCacheChanged?.();
            await waitWhilePaused(signal);
            hideBanner();
            break;
          }
          if (res.kind === 'ok') {
            parsedChapters.push(res.hydrated);
            allPackagedChapters.push(res.ch);
            totalOkChapters++;
          }
          completedGlobal++;
        }

        renderChaptersTable();
        if (pausedAtOffset >= 0) {
          c = waveStart + pausedAtOffset;
          continue;
        }
        if (waveHadNetwork && networkFetchCount % 5 === 0) {
          await persistSessionSnapshot();
        }
        c += wave.length;
        if (waveHadNetwork && completedGlobal < totalChaptersAll) {
          await enforceSafeThrottle(networkTimestamps, networkFetchCount, signal);
        }
      }

      if (parsedChapters.length === 0) {
        appendLog(`Pulando ${job.bookTitle}: nenhum capítulo disponível.`, 'warn');
        continue;
      }

      $('progress-label').textContent = `${extUpper}: ${job.bookTitle}...`;
      const outBlob = await exporter.exportBook({
        metadata: state.metadata,
        bookTitle: job.bookTitle,
        seriesName: job.seriesName,
        seriesIndex: job.seriesIndex,
        parsedChapters,
        options: state.options,
        groupNestedVolumes: job.groupNestedVolumes,
        onLog: appendLog,
        onWarning: (w) => {
          imageWarnings.push(w);
          if (w.chapterId) {
            const chRef = state.chapters.find((cRef) => cRef.id === w.chapterId);
            if (chRef) {
              chRef.warnings = chRef.warnings || [];
              chRef.warnings.push(w);
            }
          }
        },
        signal
      });

      const outName = formatOutputFilename({
        baseFilename: state.metadata.filename,
        title: state.metadata.title,
        author: state.metadata.author,
        volumeLabel: job.volumeLabel,
        extension: exporter.extension
      });

      const savedPath = await saveBookOutput(outBlob, outName, activeDirHandle);
      filesGenerated++;
      appendLog(`Arquivo salvo: ${savedPath} (${(outBlob.size / 1024).toFixed(1)} KB, ${parsedChapters.length} caps)`);
    }

    if (allPackagedChapters.length > 0) {
      await state.onLibraryUpdateAfterExport?.(allPackagedChapters);
    }
    await persistSessionSnapshot();
    await state.onCacheChanged?.();

    const elapsedSec = ((Date.now() - packStartedAt) / 1000).toFixed(1);
    appendLog(
      `[DONE] Finalizado em ${elapsedSec}s: ${filesGenerated} arquivo(s), ${totalOkChapters} OK (${cacheHits} do cache, ${networkFetchCount} baixados), ${totalFailedChapters} falhas, ${imageWarnings.length} avisos de mídia.`,
      totalFailedChapters > 0 ? 'warn' : 'info'
    );

    $('progress-bar').value = 100;
    $('progress-pct').textContent = '100%';
    $('progress-label').textContent = t('progressDone');
    $('progress-detail').textContent = `${filesGenerated} ${extUpper}`;

    if (filesGenerated > 0 && totalFailedChapters === 0) {
      showBanner(
        t('msgPackComplete', {
          files: filesGenerated,
          ext: extUpper,
          ok: totalOkChapters
        }),
        imageWarnings.length > 0 ? 'info' : 'success'
      );
    } else if (filesGenerated > 0 && totalFailedChapters > 0) {
      showBanner(
        t('msgPackPartialWarning', {
          files: filesGenerated,
          ext: extUpper,
          failed: totalFailedChapters
        }),
        'info'
      );
    } else {
      showBanner(t('msgPackAllFailed', { failed: totalFailedChapters }), 'error');
    }
    renderExportReport({
      okCount: totalOkChapters,
      chapterErrors,
      imageWarnings
    });
  } catch (err) {
    await persistSessionSnapshot();
    await state.onCacheChanged?.();
    if (err.name === 'AbortError') {
      appendLog('Empacotamento cancelado pelo usuário.', 'warn');
      showBanner(t('msgPackCancelled'), 'info');
    } else {
      appendLog(`ERRO durante empacotamento: ${err.message}`, 'error');
      showBanner(`Erro: ${err.message}`, 'error');
    }
  } finally {
    state.running = false;
    $('btn-pack-epub').disabled = false;
    if (!state.batchRunning) {
      state.paused = false;
      state.abortController = null;
      $('btn-pause').disabled = true;
      $('btn-cancel').disabled = true;
      $('btn-pause').textContent = t('btnPause');
    }
    renderChaptersTable();
  }
}
