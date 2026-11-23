import {
  AdaptiveRateLimiter,
  TabRenderPool,
  clearSpaDomainCircuit,
  downloadAndParseChapter,
  extractVolumeNumber
} from '../core/parser-engine.js';
import {
  cacheStore,
  hydrateCachedChapter,
  serializeNodesForCache
} from '../core/cache-store.js';
import { exporterRegistry } from '../exporters/index.js';
import { clearNavigationHeaderRules } from '../core/dnr-rules.js';
import { resolveParserForChapterUrl } from '../parsers/index.js';
import { $, getCacheKey, getCurrentSeriesKey, state, t } from './state.js';
import { appendLog, hideBanner, renderExportReport, showBanner } from './logger.js';
import { readMetadataFromUi, readOptionsFromUi, saveOptions } from './options-storage.js';
import { getChapterFromCaches, persistSessionSnapshot, renderChaptersTable } from './chapters-ui.js';
import {
  downloadBlobToChrome,
  ensureCustomDirWritable,
  formatOutputFilename,
  handlePickSaveFolder,
  handleUseDownloadsFolder,
  saveBookOutput
} from './download-storage.js';

export { downloadBlobToChrome, formatOutputFilename, handlePickSaveFolder, handleUseDownloadsFolder };

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

async function enforceSafeThrottle(rateLimiter, networkFetchCount, signal) {
  readOptionsFromUi();
  const plan = rateLimiter.computeNextWait({
    safeMode: Boolean(state.options.safeMode),
    baseDelayMs: state.options.delayMs || 0,
    minParserDelayMs: state.activeParser?.minDelayMs || 0,
    safeRpm: state.options.safeRpm || 22,
    safeBatchSize: state.options.safeBatchSize ?? 25,
    networkFetchCount
  });
  if (!plan.waitMs || plan.waitMs <= 0) return;

  if (plan.label) {
    $('progress-detail').textContent = plan.label;
    if (plan.reason === 'batch-rest' || plan.reason === 'rpm-window' || plan.reason === 'retry-after') {
      appendLog(`[SAFE] ${plan.label}`, 'debug');
    }
  }
  await rateLimiter.waitCooperatively(plan.waitMs, {
    isSafeModeActive: () => Boolean(state.options.safeMode),
    signal
  });
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
  const rateLimiter = new AdaptiveRateLimiter();
  const allPackagedChapters = [];
  const chapterErrors = [];
  const imageWarnings = [];
  const exporter = exporterRegistry.get(state.options.outputFormat);
  const extUpper = exporter.extension.toUpperCase();
  const seriesKey = getCurrentSeriesKey();

  const nextPrevMap = new Map();
  for (let idx = 0; idx < selected.length; idx++) {
    const ch = selected[idx];
    ch.warnings = [];
    if (ch.status === 'error') {
      ch.logId = '';
    }
    const adjacent = [];
    if (idx > 0 && selected[idx - 1]?.url) adjacent.push(selected[idx - 1].url);
    if (idx < selected.length - 1 && selected[idx + 1]?.url) adjacent.push(selected[idx + 1].url);
    nextPrevMap.set(ch, adjacent);
  }

  const tabPool = new TabRenderPool();

  try {
    const initialBatchWidth = rateLimiter.getEffectiveBatchWidth({
      safeMode: Boolean(state.options.safeMode),
      requiresTab: Boolean(state.seriesRequiresTab || state.options.renderWithTab),
      configuredConcurrency: state.options.concurrency
    });

    appendLog(
      `[CFG] Exportação ${exporter.name} (${extUpper}) | epub3=${Boolean(state.options.createEpub3)}, popupNotes=${state.options.popupFootnotes !== false}, compressImgs=${Boolean(state.options.compressImages)}, skipImgs=${Boolean(state.options.skipImages)}, spa=${Boolean(state.seriesRequiresTab || state.options.renderWithTab)}, safeMode=${Boolean(state.options.safeMode)}, concorrência=${initialBatchWidth}x, destino=${activeDirHandle ? activeDirHandle.name : 'Downloads'}`,
      'debug'
    );
    appendLog(
      `Iniciando exportação (${exporter.name}): ${jobs.length} arquivo(s) ${extUpper}, ${totalChaptersAll} capítulos no total${state.options.safeMode ? ' [Modo Seguro adaptativo]' : initialBatchWidth > 1 ? ` [${initialBatchWidth}x paralelo]` : ''}.`
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

      const fetchStartedAt = Date.now();
      try {
        const chapterParser = resolveParserForChapterUrl(
          ch.url,
          state.activeParser,
          state.options.parserId,
          state.metadata.startingUrl
        );
        const chapterFetchOptions = {
          ...state.options,
          ...(state.seriesRequiresTab ? { renderWithTab: true } : {}),
          pageDomCache: state.pageDomCache,
          tabPool,
          nextPrevUrls: nextPrevMap.get(ch) || [],
          onLog: appendLog
        };
        const parsed = await downloadAndParseChapter(ch, chapterParser, chapterFetchOptions, signal);
        networkFetchCount++;
        rateLimiter.recordSuccess(Date.now() - fetchStartedAt);

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
          rateLimiter.recordThrottle({ retryAfterSec: err.retryAfterSec });
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
              : { kind: 'ratelimit', status: err.status || 429, url: ch.url }
          };
        }
        if (err.status === 404 && state.options.skip404) {
          ch.status = 'skipped';
          ch.errorMsg = 'HTTP 404';
          ch.logId = appendLog(`404 pulado: ${ch.url}`, 'warn');
          return { kind: 'skipped', ch, fromNetwork: true };
        }
        if (!err.status || err.status >= 500) {
          rateLimiter.recordThrottle();
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

        const waveWidth = rateLimiter.getEffectiveBatchWidth({
          safeMode: Boolean(state.options.safeMode),
          requiresTab: Boolean(state.seriesRequiresTab || state.options.renderWithTab),
          configuredConcurrency: state.options.concurrency
        });
        const waveStart = c;
        const wave = job.chapters.slice(c, c + waveWidth);
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
            rateLimiter.timestamps.length = 0;
            state.paused = true;
            $('btn-pause').textContent = t('btnResume');
            showBanner(
              res.pauseTrigger.kind === 'antibot'
                ? t('msgAntiBotPaused', { url: res.pauseTrigger.url })
                : t('msgRateLimitPaused', { status: res.pauseTrigger.status }),
              'error',
              res.pauseTrigger.url
                ? { label: t('btnOpenVerifyPage'), url: res.pauseTrigger.url }
                : null
            );
            await state.onCacheChanged?.();
            await waitWhilePaused(signal);
            clearSpaDomainCircuit(res.pauseTrigger.url);
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
          await enforceSafeThrottle(rateLimiter, networkFetchCount, signal);
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
    await tabPool.close();
    await clearNavigationHeaderRules();
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
