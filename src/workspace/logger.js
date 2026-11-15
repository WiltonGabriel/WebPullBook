import { $, state, switchTab, t } from './state.js';

function detectLogLevel(msg, explicitLevel) {
  if (explicitLevel) return explicitLevel;
  if (/^(?:ERRO|FALHA|BLOQUEIO)/i.test(msg)) return 'error';
  if (/^Aviso:/i.test(msg)) return 'warn';
  return 'info';
}

export function updateLogBadges() {
  const total = state.logs.length;
  const warnCount = state.logs.filter((l) => l.level === 'warn').length;
  const errCount = state.logs.filter((l) => l.level === 'error').length;

  const totalBadge = $('log-badge');
  totalBadge.textContent = String(total);
  totalBadge.classList.toggle('hidden', total === 0);

  const warnBadge = $('log-warn-badge');
  if (warnBadge) {
    warnBadge.textContent = String(warnCount);
    warnBadge.classList.toggle('hidden', warnCount === 0);
  }

  const errBadge = $('log-error-badge');
  if (errBadge) {
    errBadge.textContent = String(errCount);
    errBadge.classList.toggle('hidden', errCount === 0);
  }
}

export function appendTextWithLinks(parentEl, text) {
  const str = String(text ?? '');
  const urlRx = /https?:\/\/[^\s<>"']+/gi;
  let lastIdx = 0;
  let match;

  while ((match = urlRx.exec(str)) !== null) {
    if (match.index > lastIdx) {
      parentEl.appendChild(document.createTextNode(str.slice(lastIdx, match.index)));
    }
    let rawUrl = match[0];
    let suffix = '';
    while (rawUrl.length > 8 && /[),.:;!?]$/.test(rawUrl)) {
      suffix = rawUrl.slice(-1) + suffix;
      rawUrl = rawUrl.slice(0, -1);
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const a = document.createElement('a');
        a.href = parsed.toString();
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'log-link';
        a.textContent = rawUrl;
        parentEl.appendChild(a);
      } else {
        parentEl.appendChild(document.createTextNode(rawUrl));
      }
    } catch {
      parentEl.appendChild(document.createTextNode(rawUrl));
    }
    if (suffix) {
      parentEl.appendChild(document.createTextNode(suffix));
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < str.length) {
    parentEl.appendChild(document.createTextNode(str.slice(lastIdx)));
  }
}

export function createExternalLink(url, label, className = 'report-ext-link') {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = className;
  a.textContent = label;
  return a;
}

export function formatLogsPlainText() {
  return state.logs.map((l) => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n');
}

export function renderLogsOutput() {
  const box = $('log-output');
  if (!box) return;
  if (state.logs.length === 0) {
    box.textContent = t('logsEmpty');
    return;
  }

  const filter = state.logFilter || 'all';
  const filtered = filter === 'all' ? state.logs : state.logs.filter((entry) => entry.level === filter);
  if (filtered.length === 0) {
    box.textContent = t('logEmptyFilter');
    return;
  }

  const frag = document.createDocumentFragment();
  for (const entry of filtered) {
    const line = document.createElement('div');
    line.id = entry.id;
    line.className = `log-line log-${entry.level}`;
    appendTextWithLinks(line, `[${entry.time}] ${entry.msg}`);
    frag.appendChild(line);
  }
  box.replaceChildren(frag);
}

export function setLogFilter(level = 'all') {
  state.logFilter = level || 'all';
  for (const btn of document.querySelectorAll('.log-filter-btn')) {
    btn.classList.toggle('active', btn.dataset.logFilter === state.logFilter);
  }
  renderLogsOutput();
}

export function appendLog(msg, level) {
  const stamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  const id = `log-${++state.logSeq}`;
  const entry = {
    id,
    time: stamp,
    level: detectLogLevel(msg, level),
    msg
  };
  state.logs.push(entry);
  if (state.logs.length > 2500) state.logs.shift();
  renderLogsOutput();
  updateLogBadges();
  return id;
}

export function jumpToLog(logId) {
  switchTab('logs');
  if (state.logFilter !== 'all') {
    setLogFilter('all');
  }
  if (!logId) return;
  const target = document.getElementById(logId);
  if (!target) return;
  for (const el of document.querySelectorAll('.log-line.log-highlight')) {
    el.classList.remove('log-highlight');
  }
  target.classList.add('log-highlight');
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function showBanner(msg, type = 'info') {
  const banner = $('status-banner');
  banner.textContent = msg;
  banner.className = `banner ${type}`;
  banner.classList.remove('hidden');
}

export function hideBanner() {
  $('status-banner').classList.add('hidden');
  const rep = $('export-report');
  if (rep) rep.classList.add('hidden');
}

export function renderExportReport({ okCount, chapterErrors, imageWarnings }) {
  state.lastReport = { okCount, chapterErrors, imageWarnings };
  const box = $('export-report');
  if (!box) return;
  const errCount = chapterErrors.length;
  const warnCount = imageWarnings.length;

  let tone = 'is-ok';
  let summaryText = t('reportAllCleanTitle');
  if (errCount > 0) {
    tone = 'is-error';
    summaryText = t('reportGraveTitle', { errors: errCount, warns: warnCount });
  } else if (warnCount > 0) {
    tone = 'is-warn';
    summaryText = t('reportLightTitle', { ok: okCount, warns: warnCount });
  }

  box.className = `export-report ${tone}`;
  const head = document.createElement('div');
  head.className = 'export-report-head';

  const strong = document.createElement('strong');
  strong.textContent = summaryText;

  const counts = document.createElement('div');
  counts.className = 'export-report-counts';

  const errPill = document.createElement('span');
  errPill.className = `status-pill${errCount > 0 ? ' error' : ''}`;
  errPill.textContent = t('reportErrorsCount', { count: errCount });

  const warnPill = document.createElement('span');
  warnPill.className = `status-pill${warnCount > 0 ? ' warn' : ''}`;
  warnPill.textContent = t('reportWarningsCount', { count: warnCount });

  counts.append(errPill, warnPill);
  head.append(strong, counts);

  const items = [];
  for (const e of chapterErrors) {
    items.push({
      type: 'error',
      tag: t('reportGraveTag', { num: e.chapterIndex }),
      label: e.chapterTitle,
      detail: e.message,
      logId: e.logId,
      chapterUrl: e.chapterUrl || '',
      mediaUrl: ''
    });
  }
  for (const w of imageWarnings) {
    items.push({
      type: 'warn',
      tag: w.kind === 'cover' ? t('reportLightCoverTag') : t('reportLightChapterTag', { num: w.chapterIndex }),
      label: w.chapterTitle || w.url,
      detail: w.message,
      logId: w.logId,
      chapterUrl: w.chapterUrl || '',
      mediaUrl: w.url || ''
    });
  }

  if (items.length === 0) {
    box.replaceChildren(head);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'report-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'report-item';

    const tagSpan = document.createElement('span');
    tagSpan.className = `report-tag ${item.type}`;
    tagSpan.textContent = item.tag;

    const textSpan = document.createElement('span');
    const shortDetail = item.detail.length > 90 ? `${item.detail.slice(0, 87)}...` : item.detail;
    textSpan.textContent = `${item.label} — ${shortDetail}`;

    li.append(tagSpan, textSpan);
    if (item.logId) {
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'report-jump-btn';
      jumpBtn.textContent = t('reportJumpLog');
      jumpBtn.addEventListener('click', () => jumpToLog(item.logId));
      li.appendChild(jumpBtn);
    }
    const chLink = createExternalLink(item.chapterUrl, t('reportOpenChapter'));
    if (chLink) li.appendChild(chLink);
    const mediaLink = createExternalLink(item.mediaUrl, t('reportOpenImage'));
    if (mediaLink) li.appendChild(mediaLink);
    list.appendChild(li);
  }

  box.replaceChildren(head, list);
}
