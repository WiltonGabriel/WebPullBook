import { $, getOriginDomain, state, t } from './state.js';

let lastKnownSessions = [];

export function setLastKnownSessions(sessions) {
  lastKnownSessions = Array.isArray(sessions) ? sessions : [];
}

export function updateLibraryBadgeCount(sessionsCount = lastKnownSessions.length) {
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

export function getItemOriginInfo(sourceDomain, urlOrKey) {
  const domain = sourceDomain || getOriginDomain(urlOrKey);
  const isLocal = !domain || domain === 'local';
  return {
    domain: isLocal ? 'local' : domain,
    label: isLocal ? t('libraryOriginLocal') : domain
  };
}

export function createSourceBadge(origin) {
  const badge = document.createElement('span');
  badge.className = 'lib-source-badge';
  badge.textContent = `🌐 ${origin.label}`;
  badge.title = origin.label;
  return badge;
}

export function refreshLibrarySiteFilter(sessions = lastKnownSessions) {
  const sel = $('library-site-filter');
  if (!sel) return;

  const counts = new Map();
  const countDomain = (domain) => counts.set(domain, (counts.get(domain) || 0) + 1);
  for (const item of state.library) {
    countDomain(getItemOriginInfo(item.sourceDomain, item.startingUrl || item.id).domain);
  }
  for (const sess of sessions || []) {
    countDomain(getItemOriginInfo('', sess.metadata?.startingUrl || sess.seriesKey).domain);
  }

  const domains = Array.from(counts.keys()).sort((a, b) => {
    if (a === 'local') return 1;
    if (b === 'local') return -1;
    return a.localeCompare(b);
  });

  if (state.librarySiteFilter !== 'all' && !counts.has(state.librarySiteFilter)) {
    state.librarySiteFilter = 'all';
  }

  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = t('libraryFilterAllSites');
  const opts = [allOpt];
  for (const domain of domains) {
    const opt = document.createElement('option');
    opt.value = domain;
    const label = domain === 'local' ? t('libraryOriginLocal') : domain;
    opt.textContent = `${label} (${counts.get(domain)})`;
    opts.push(opt);
  }
  sel.replaceChildren(...opts);
  sel.value = state.librarySiteFilter;
}

export function renderCollectionView(grid, items, getOriginFn, buildCardFn, emptyMsg) {
  const siteFilter = state.librarySiteFilter || 'all';
  const viewMode = state.options.libraryViewMode === 'by-site' ? 'by-site' : 'unified';

  if (items.length === 0) {
    grid.classList.remove('is-grouped');
    const empty = document.createElement('p');
    empty.className = 'muted sm';
    empty.textContent = emptyMsg;
    grid.replaceChildren(empty);
    return;
  }

  const enriched = items.map((item) => ({ item, origin: getOriginFn(item) }));
  const filtered = siteFilter === 'all' ? enriched : enriched.filter((entry) => entry.origin.domain === siteFilter);

  if (filtered.length === 0) {
    grid.classList.remove('is-grouped');
    const empty = document.createElement('p');
    empty.className = 'muted sm';
    empty.textContent = t('libraryFilterEmpty');
    grid.replaceChildren(empty);
    return;
  }

  if (viewMode === 'by-site') {
    grid.classList.add('is-grouped');
    const groups = new Map();
    for (const entry of filtered) {
      if (!groups.has(entry.origin.domain)) {
        groups.set(entry.origin.domain, { origin: entry.origin, entries: [] });
      }
      groups.get(entry.origin.domain).entries.push(entry);
    }

    const sortedDomains = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'local') return 1;
      if (b === 'local') return -1;
      return a.localeCompare(b);
    });

    const frag = document.createDocumentFragment();
    for (const domain of sortedDomains) {
      const grp = groups.get(domain);
      const section = document.createElement('section');
      section.className = 'lib-site-group';
      section.dataset.origin = domain;

      const header = document.createElement('div');
      header.className = 'lib-site-group-header';

      const heading = document.createElement('h3');
      heading.className = 'lib-site-group-title';
      heading.textContent = `🌐 ${grp.origin.label}`;

      const countPill = document.createElement('span');
      countPill.className = 'pill';
      countPill.textContent = t('librarySiteCount', { count: grp.entries.length });

      header.append(heading, countPill);

      const innerGrid = document.createElement('div');
      innerGrid.className = 'library-grid';
      for (const entry of grp.entries) {
        innerGrid.appendChild(buildCardFn(entry.item, entry.origin));
      }

      section.append(header, innerGrid);
      frag.appendChild(section);
    }
    grid.replaceChildren(frag);
    return;
  }

  grid.classList.remove('is-grouped');
  const frag = document.createDocumentFragment();
  for (const entry of filtered) {
    frag.appendChild(buildCardFn(entry.item, entry.origin));
  }
  grid.replaceChildren(frag);
}
