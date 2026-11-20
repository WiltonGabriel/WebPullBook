import { sanitizeFilename } from '../core/parser-engine.js';
import { cacheStore } from '../core/cache-store.js';
import { getParserById } from '../parsers/index.js';
import { genericHtmlParser } from '../parsers/generic-html.js';
import {
  $,
  formatBytes,
  formatTimeRemaining,
  getCacheKey,
  getCurrentSeriesKey,
  state,
  switchTab,
  t
} from './state.js';
import { showBanner } from './logger.js';
import { syncMetadataToUi } from './options-storage.js';
import {
  getVolumeGroups,
  populateRangeSelects,
  renderAllChapterViews,
  renderChaptersTable
} from './chapters-ui.js';
import {
  createSourceBadge,
  getItemOriginInfo,
  refreshLibrarySiteFilter,
  renderCollectionView,
  setLastKnownSessions,
  updateLibraryBadgeCount
} from './library-view.js';

export async function renderCacheSessions() {
  const grid = $('cache-sessions-grid');
  const pill = $('cache-stats-pill');
  if (!grid || !pill) return;

  const { sessions, totalChapters, totalBytes } = await cacheStore.listSessionsWithStats();
  setLastKnownSessions(sessions);
  pill.textContent = t('cacheStatsPill', { count: totalChapters, size: formatBytes(totalBytes) });
  updateLibraryBadgeCount(sessions.length);
  refreshLibrarySiteFilter(sessions);

  const buildSessionCard = (sess, origin) => {
    const card = document.createElement('article');
    card.className = 'lib-card';
    card.dataset.origin = origin.domain;

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

    const sourceBadge = createSourceBadge(origin);

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
    body.append(h3, sourceBadge, pMeta, pExp, actions);
    card.appendChild(body);
    return card;
  };

  renderCollectionView(
    grid,
    sessions,
    (sess) => getItemOriginInfo('', sess.metadata?.startingUrl || sess.seriesKey),
    buildSessionCard,
    t('cacheSessionsEmpty')
  );
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
