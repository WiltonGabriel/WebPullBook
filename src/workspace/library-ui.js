import { normalizeUrl, sanitizeFilename, sleep } from '../core/parser-engine.js';
import { cacheStore } from '../core/cache-store.js';
import { getParserById, loadSeriesWithParser } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import {
  $,
  formatBytes,
  formatTimeRemaining,
  getCacheKey,
  getCurrentSeriesKey,
  normalizeRuleDomain,
  state,
  switchTab,
  t
} from './state.js';
import { appendLog, showBanner } from './logger.js';
import { readMetadataFromUi, saveLibrary, syncMetadataToUi } from './options-storage.js';
import {
  getVolumeGroups,
  populateRangeSelects,
  renderAllChapterViews,
  renderChaptersTable
} from './chapters-ui.js';
import { handleLoadSeries } from './series-loader.js';
import { handlePackEpub, waitWhilePaused } from './export-runner.js';

function updateLibraryBadgeCount(sessionsCount = 0) {
  const total = state.library.length + sessionsCount;
  const badge = $('library-badge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = String(total);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

export async function renderCacheSessions() {
  const grid = $('cache-sessions-grid');
  const pill = $('cache-stats-pill');
  if (!grid || !pill) return;

  const { sessions, totalChapters, totalBytes } = await cacheStore.listSessionsWithStats();
  pill.textContent = t('cacheStatsPill', { count: totalChapters, size: formatBytes(totalBytes) });
  updateLibraryBadgeCount(sessions.length);

  if (sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted sm';
    empty.textContent = t('cacheSessionsEmpty');
    grid.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const sess of sessions) {
    const card = document.createElement('article');
    card.className = 'lib-card';

    if (sess.metadata?.coverUrl) {
      const img = document.createElement('img');
      img.className = 'lib-cover';
      img.src = sess.metadata.coverUrl;
      img.alt = '';
      card.appendChild(img);
    } else {
      const noCov = document.createElement('div');
      noCov.className = 'lib-cover';
      noCov.textContent = t('noCover');
      card.appendChild(noCov);
    }

    const body = document.createElement('div');
    body.className = 'lib-body';

    const h3 = document.createElement('h3');
    h3.className = 'lib-title';
    h3.textContent = sess.metadata?.title || sess.seriesKey;
    h3.title = sess.metadata?.title || sess.seriesKey;

    const pMeta = document.createElement('p');
    pMeta.className = 'lib-meta';
    pMeta.textContent = t('cacheProgressInfo', {
      cached: sess.cachedCount,
      total: sess.chapters?.length || 0,
      size: formatBytes(sess.bytes)
    });

    const pExp = document.createElement('p');
    pExp.className = 'lib-meta';
    pExp.textContent = t('cacheExpiresInfo', { time: formatTimeRemaining(sess.expiresAt) });

    const actions = document.createElement('div');
    actions.className = 'lib-actions';

    const btnResume = document.createElement('button');
    btnResume.type = 'button';
    btnResume.className = 'btn primary sm';
    btnResume.textContent = t('btnResumeDownload');
    btnResume.addEventListener('click', () => restoreCachedSession(sess, false));

    const btnPackCached = document.createElement('button');
    btnPackCached.type = 'button';
    btnPackCached.className = 'btn secondary sm';
    btnPackCached.textContent = t('btnPackCachedOnly');
    btnPackCached.addEventListener('click', () => restoreCachedSession(sess, true));

    const btnPurge = document.createElement('button');
    btnPurge.type = 'button';
    btnPurge.className = 'btn ghost sm';
    btnPurge.textContent = t('btnPurgeSeriesCache');
    btnPurge.addEventListener('click', async () => {
      await cacheStore.deleteSeriesCache(sess.seriesKey);
      for (const ch of sess.chapters || []) {
        state.chapterCache.delete(getCacheKey(ch.url));
      }
      if (getCurrentSeriesKey() === sess.seriesKey) {
        for (const ch of state.chapters) {
          ch.status = 'pending';
        }
        renderChaptersTable();
      }
      await renderCacheSessions();
    });

    actions.append(btnResume, btnPackCached, btnPurge);
    body.append(h3, pMeta, pExp, actions);
    card.appendChild(body);
    fragment.appendChild(card);
  }

  grid.replaceChildren(fragment);
}

export async function restoreCachedSession(sess, onlyCached = false) {
  switchTab('main');
  state.activeParser = getParserById(sess.parserId) || genericHtmlParser;
  state.seriesRequiresTab = Boolean(sess.metadata?.requiresTabRender);
  state.metadata = {
    ...sess.metadata,
    filename: sess.metadata?.filename || sanitizeFilename(sess.metadata?.title || 'WebPullBook', true)
  };

  const keys = (sess.chapters || []).map((c) => getCacheKey(c.url));
  const diskMap = await cacheStore.hasChapters(keys);

  let cachedHitCount = 0;
  state.chapters = (sess.chapters || []).map((ch) => {
    const key = getCacheKey(ch.url);
    const diskRec = diskMap.get(key);
    if (diskRec) {
      state.chapterCache.set(key, {
        chapterTitle: diskRec.chapterTitle,
        subtitle: diskRec.subtitle,
        contentXml: diskRec.contentXml
      });
      cachedHitCount++;
    }
    const isOk = Boolean(diskRec || state.chapterCache.has(key));
    return {
      ...ch,
      included: onlyCached ? isOk : ch.included !== false,
      status: isOk ? 'ok' : ch.status === 'error' ? 'error' : 'pending'
    };
  });

  state.volumeFilter = null;
  state.lastClickedIdx = -1;
  const vols = getVolumeGroups().length;
  const modeRadio = document.querySelector(`input[name="pack-mode"][value="${vols > 1 ? 'by-volume' : 'single'}"]`);
  if (modeRadio) modeRadio.checked = true;

  syncMetadataToUi();
  populateRangeSelects();
  renderAllChapterViews();
  showBanner(t('msgSessionRestored', { title: state.metadata.title, cached: cachedHitCount }), 'success');
}

export function renderLibrary() {
  const grid = $('library-grid');
  if (!grid) return;

  if (state.library.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted sm';
    empty.textContent = t('libraryEmpty');
    grid.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.library) {
    const card = document.createElement('article');
    card.className = 'lib-card';

    if (item.coverUrl) {
      const img = document.createElement('img');
      img.className = 'lib-cover';
      img.src = item.coverUrl;
      img.alt = '';
      card.appendChild(img);
    } else {
      const noCov = document.createElement('div');
      noCov.className = 'lib-cover';
      noCov.textContent = t('noCover');
      card.appendChild(noCov);
    }

    const body = document.createElement('div');
    body.className = 'lib-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'lib-title-row';

    const h3 = document.createElement('h3');
    h3.className = 'lib-title';
    h3.textContent = item.title || item.startingUrl;
    h3.title = item.title || item.startingUrl;
    titleRow.appendChild(h3);

    if (typeof item.newChaptersCount === 'number' && item.lastCheckedAt) {
      const statusPill = document.createElement('span');
      statusPill.className = `pill lib-status-pill ${item.newChaptersCount > 0 ? 'ok' : 'muted'}`;
      statusPill.textContent =
        item.newChaptersCount > 0
          ? t('libStatusNewCount', { count: item.newChaptersCount })
          : t('libStatusUpToDate');
      titleRow.appendChild(statusPill);
    }

    const pMeta = document.createElement('p');
    pMeta.className = 'lib-meta';
    pMeta.textContent = `${item.author || '<unknown>'} • ${t('libChaptersInfo', { total: item.totalChapters || 0 })}`;

    const pLast = document.createElement('p');
    pLast.className = 'lib-meta';
    pLast.textContent = item.lastDownloadedTitle
      ? t('libLastReadInfo', { title: item.lastDownloadedTitle })
      : t('libNoLastRead');

    const actions = document.createElement('div');
    actions.className = 'lib-actions';

    const btnCheckNew = document.createElement('button');
    btnCheckNew.type = 'button';
    btnCheckNew.className = 'btn primary sm';
    btnCheckNew.textContent = t('btnLibCheckNew');
    btnCheckNew.addEventListener('click', () => handleCheckLibrarySeries(item, true));

    const btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'btn secondary sm';
    btnOpen.textContent = t('btnLibOpen');
    btnOpen.addEventListener('click', () => handleCheckLibrarySeries(item, false));

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn ghost sm';
    btnRemove.textContent = t('btnLibRemove');
    btnRemove.addEventListener('click', async () => {
      await saveLibrary({ removeId: item.id }, renderLibrary);
      await renderCacheSessions();
      showBanner(t('msgRemovedFromLibrary'), 'info');
    });

    actions.append(btnCheckNew, btnOpen, btnRemove);
    body.append(titleRow, pMeta, pLast, actions);
    card.appendChild(body);
    fragment.appendChild(card);
  }

  grid.replaceChildren(fragment);
}

export async function saveCurrentSeriesToLibrary() {
  readMetadataFromUi();
  const url = normalizeUrl(state.metadata.startingUrl || $('starting-url').value.trim());
  if (!url && state.chapters.length === 0) {
    showBanner(t('msgSelectAtLeastOne'), 'error');
    return;
  }

  const id = getCurrentSeriesKey();
  const existing = state.library.find((item) => item.id === id);
  const downloadedChapters = state.chapters.filter(
    (c) => c.status === 'ok' || state.chapterCache.has(getCacheKey(c.url))
  );
  const lastCh =
    downloadedChapters[downloadedChapters.length - 1] ||
    state.chapters[state.chapters.length - 1] ||
    null;

  const entry = {
    id,
    startingUrl: url,
    title: state.metadata.title || 'WebPullBook',
    author: state.metadata.author || '<unknown>',
    coverUrl: state.metadata.coverUrl || '',
    language: state.metadata.language || 'pt',
    parserId: state.activeParser?.id || 'auto',
    totalChapters: state.chapters.length,
    knownUrls: state.chapters.map((c) => normalizeUrl(c.url)),
    lastDownloadedUrl: lastCh ? normalizeUrl(lastCh.url) : existing?.lastDownloadedUrl || '',
    lastDownloadedTitle: lastCh ? lastCh.displayTitle : existing?.lastDownloadedTitle || '',
    updatedAt: new Date().toISOString()
  };

  await saveLibrary({ upsertEntry: entry }, renderLibrary);
  await renderCacheSessions();
  appendLog(`Biblioteca atualizada: "${entry.title}" (${entry.totalChapters} capítulos).`);
  showBanner(t('msgSavedToLibrary', { title: entry.title, count: entry.totalChapters }), 'success');
}

export async function updateLibraryAfterExport(packagedChapters) {
  const id = getCurrentSeriesKey();
  if (!id || packagedChapters.length === 0) return;

  let existing = state.library.find((item) => item.id === id);
  if (!existing && chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbLibrary');
    existing = (res?.wpbLibrary || []).find((item) => item.id === id);
  }
  if (!existing) return;

  const lastPackaged = packagedChapters[packagedChapters.length - 1];
  const knownSet = new Set(existing.knownUrls || []);
  for (const ch of state.chapters) {
    knownSet.add(normalizeUrl(ch.url));
  }

  const updatedEntry = {
    ...existing,
    title: state.metadata.title || existing.title,
    author: state.metadata.author || existing.author,
    coverUrl: state.metadata.coverUrl || existing.coverUrl,
    totalChapters: Math.max(state.chapters.length, existing.totalChapters || 0),
    knownUrls: Array.from(knownSet),
    lastDownloadedUrl: normalizeUrl(lastPackaged.url),
    lastDownloadedTitle: lastPackaged.displayTitle,
    updatedAt: new Date().toISOString()
  };
  await saveLibrary({ upsertEntry: updatedEntry }, renderLibrary);
}

export async function handleCheckLibrarySeries(entry, selectOnlyNew = true) {
  switchTab('main');
  if (!entry.startingUrl) return;
  $('starting-url').value = entry.startingUrl;
  await handleLoadSeries(entry.startingUrl);

  if (!selectOnlyNew || state.chapters.length === 0) return;

  const knownSet = new Set((entry.knownUrls || []).map((u) => normalizeUrl(u)));
  const lastIdx = entry.lastDownloadedUrl
    ? state.chapters.findIndex((c) => normalizeUrl(c.url) === normalizeUrl(entry.lastDownloadedUrl))
    : -1;

  let newCount = 0;
  state.chapters.forEach((ch, idx) => {
    const norm = normalizeUrl(ch.url);
    const isNew = !knownSet.has(norm) || (lastIdx >= 0 && idx > lastIdx);
    ch.included = isNew;
    if (isNew) newCount++;
  });

  if (newCount > 0) {
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(t('msgNewChaptersFound', { newCount }), 'success');
  } else {
    state.chapters.forEach((ch) => {
      ch.included = true;
    });
    populateRangeSelects();
    renderAllChapterViews();
    showBanner(t('msgNoNewChapters', { total: state.chapters.length }), 'info');
  }
}

export async function handleCheckAllLibrary() {
  const entries = [...state.library].filter((item) => Boolean(item.startingUrl));
  if (entries.length === 0) {
    showBanner(t('msgCheckAllEmpty'), 'info');
    return;
  }

  const btn = $('btn-check-all-library');
  btn.disabled = true;
  let withNew = 0;
  let totalNew = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      btn.textContent = t('btnCheckingAllLibrary', { done: i + 1, total: entries.length });
      try {
        const domain = normalizeRuleDomain(entry.startingUrl);
        const rule = domain ? state.domainRules[domain] : null;
        const effectiveOpts = rule
          ? {
              ...state.options,
              customListSelector: rule.listSelector || state.options.customListSelector,
              customContentSelector: rule.contentSelector || state.options.customContentSelector,
              customExcludeSelector: rule.excludeSelector || state.options.customExcludeSelector,
              renderWithTab: typeof rule.renderWithTab === 'boolean' ? rule.renderWithTab : false,
              onLog: appendLog
            }
          : { ...state.options, renderWithTab: false, onLog: appendLog };

        const { series } = await loadSeriesWithParser(entry.startingUrl, effectiveOpts);
        const knownSet = new Set((entry.knownUrls || []).map((u) => normalizeUrl(u)));
        const lastIdx = entry.lastDownloadedUrl
          ? series.chapters.findIndex((c) => normalizeUrl(c.url) === normalizeUrl(entry.lastDownloadedUrl))
          : -1;
        let newCount = 0;
        series.chapters.forEach((ch, idx) => {
          const norm = normalizeUrl(ch.url);
          if (!knownSet.has(norm) || (lastIdx >= 0 && idx > lastIdx)) {
            newCount++;
          }
        });
        if (newCount > 0) {
          withNew++;
          totalNew += newCount;
        }
        await saveLibrary(
          {
            upsertEntry: {
              ...entry,
              totalChapters: series.chapters.length || entry.totalChapters,
              newChaptersCount: newCount,
              lastCheckedAt: new Date().toISOString()
            }
          },
          renderLibrary
        );
        appendLog(
          `Biblioteca: "${entry.title}" -> ${newCount > 0 ? `+${newCount} capítulo(s) novo(s)` : 'em dia'}.`
        );
      } catch (err) {
        appendLog(`Aviso ao checar "${entry.title}": ${err.message}`, 'warn');
      }
      await sleep(250);
    }
    showBanner(t('msgCheckAllDone', { withNew, totalNew }), withNew > 0 ? 'success' : 'info');
  } finally {
    btn.disabled = false;
    btn.textContent = t('btnCheckAllLibrary');
  }
}

export async function handleDownloadLibraryUpdates() {
  if (state.running || state.batchRunning) return;
  const entries = [...state.library].filter((item) => Boolean(item.startingUrl));
  if (entries.length === 0) {
    showBanner(t('msgBatchUpdatesEmpty'), 'info');
    return;
  }

  const batchBtn = $('btn-download-library-updates');
  const originalTab = $('tab-library').classList.contains('active') ? 'library' : 'main';
  state.batchRunning = true;
  state.paused = false;
  state.abortController = new AbortController();
  const { signal } = state.abortController;

  $('btn-pause').disabled = false;
  $('btn-cancel').disabled = false;
  $('btn-pause').textContent = t('btnPause');
  batchBtn.disabled = true;

  let booksUpdated = 0;
  let chaptersUpdated = 0;

  try {
    const queue = [];
    for (let i = 0; i < entries.length; i++) {
      await waitWhilePaused(signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const entry = entries[i];
      batchBtn.textContent = t('btnDownloadingUpdates', { done: i + 1, total: entries.length });
      const domain = normalizeRuleDomain(entry.startingUrl);
      const rule = domain ? state.domainRules[domain] : null;
      const effectiveOpts = rule
        ? {
            ...state.options,
            customListSelector: rule.listSelector || state.options.customListSelector,
            customContentSelector: rule.contentSelector || state.options.customContentSelector,
            customExcludeSelector: rule.excludeSelector || state.options.customExcludeSelector,
            renderWithTab: typeof rule.renderWithTab === 'boolean' ? rule.renderWithTab : false,
            onLog: appendLog
          }
        : { ...state.options, onLog: appendLog };

      try {
        const { series } = await loadSeriesWithParser(entry.startingUrl, effectiveOpts, signal);
        const knownSet = new Set((entry.knownUrls || []).map((u) => normalizeUrl(u)));
        const lastIdx = entry.lastDownloadedUrl
          ? series.chapters.findIndex((c) => normalizeUrl(c.url) === normalizeUrl(entry.lastDownloadedUrl))
          : -1;
        const newCount = series.chapters.filter((ch, idx) => {
          const norm = normalizeUrl(ch.url);
          return !knownSet.has(norm) || (lastIdx >= 0 && idx > lastIdx);
        }).length;
        if (newCount > 0) {
          queue.push({ entry, newCount });
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        appendLog(`Aviso ao checar "${entry.title}": ${err.message}`, 'warn');
      }
      await sleep(200, signal);
    }

    if (queue.length === 0) {
      showBanner(t('msgBatchUpdatesEmpty'), 'info');
      return;
    }

    switchTab('main');
    for (let q = 0; q < queue.length; q++) {
      await waitWhilePaused(signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { entry } = queue[q];
      batchBtn.textContent = t('btnDownloadingUpdates', { done: q + 1, total: queue.length });
      await handleCheckLibrarySeries(entry, true);
      const selectedNew = state.chapters.filter((c) => c.included);
      if (selectedNew.length === 0) continue;

      await handlePackEpub({ externalSignal: signal });
      booksUpdated++;
      chaptersUpdated += selectedNew.length;
    }

    showBanner(
      t('msgBatchUpdatesDone', { books: booksUpdated, chapters: chaptersUpdated }),
      booksUpdated > 0 ? 'success' : 'info'
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      showBanner(t('msgPackCancelled'), 'info');
    } else {
      appendLog(`ERRO no download em lote da biblioteca: ${err.message}`, 'error');
      showBanner(`Erro: ${err.message}`, 'error');
    }
  } finally {
    state.batchRunning = false;
    state.paused = false;
    state.abortController = null;
    batchBtn.disabled = false;
    batchBtn.textContent = t('btnDownloadAllUpdates');
    if (!state.running) {
      $('btn-pause').disabled = true;
      $('btn-cancel').disabled = true;
      $('btn-pause').textContent = t('btnPause');
    }
    if (originalTab === 'library') {
      await renderCacheSessions();
    }
  }
}
