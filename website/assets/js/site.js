/**
 * WebPullBook Official Website — Minimalist Vanilla JS controller
 * Handles language dropdown selection, 5-theme selector (Auto / Light / Dark / Sepia / Midnight),
 * mobile navigation disclosure, interactive screenshot tabs, automatic GitHub Release version detection,
 * and live synchronization from docs/COMPATIBILITY.md and docs/READER_PRESETS*.md.
 */
(function () {
  const THEME_STORAGE_KEY = 'wpb-site-theme';
  const VALID_THEMES = ['system', 'light', 'dark', 'sepia', 'midnight'];
  const RELEASE_CACHE_KEY = 'wpb-latest-release-v2';
  const DOCS_CACHE_KEY = 'wpb-repo-docs-sync-v1';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const RELEASES_API_URL = 'https://api.github.com/repos/WiltonGabriel/WebPullBook/releases?per_page=1';
  const RAW_BASE_URL = 'https://raw.githubusercontent.com/WiltonGabriel/WebPullBook/main';
  const root = document.documentElement;

  const PT_TRANSLATIONS = {
    'End-to-end tested (static SSR, zero SPA tabs): multi-volume detection, cover, synopsis, genres, and chapter fidelity.':
      'Testado de ponta a ponta (SSR estático, zero abas SPA): detecção de múltiplos volumes, capa, sinopse, gêneros e fidelidade de capítulos.',
    'End-to-end tested (20 chapters): volume & chapter metadata, full synopsis, tags, cover, inline images, and hidden `<style>` watermark filtering.':
      'Testado de ponta a ponta (20 capítulos): metadados de volumes e capítulos, sinopse completa, tags, capa, imagens internas e filtragem de marcas d\'água ocultas em `<style>`.',
    'End-to-end tested (20 chapters): paginated chapter API & multi-volume detection, full synopsis, genres, status, original cover, inline images, `.sr-only` heading cleanup, and footnote anchors.':
      'Testado de ponta a ponta (20 capítulos): API paginada de capítulos e múltiplos volumes, sinopse completa, gêneros, status, capa original, imagens internas, limpeza de `.sr-only` e âncoras de notas de rodapé.',
    'End-to-end tested (index & direct chapter URL): AJAX full TOC, open-tab reuse, chronological ordering, metadata, inline images, and author note cleanup.':
      'Testado de ponta a ponta (índice e URL direta de capítulo): sumário completo via AJAX, reaproveitamento de aba aberta, ordenação cronológica, metadados, imagens internas e limpeza de notas de autor.',
    'Madara-based platforms (`.wp-manga-chapter`, `.reading-content`)':
      'Plataformas baseadas em Madara (`.wp-manga-chapter`, `.reading-content`)',
    'Other WordPress novel theme clones (`.eplister`, `.ts-chl-collapsible`, `.epcontent`)':
      'Outros clones de temas WordPress de novels (`.eplister`, `.ts-chl-collapsible`, `.epcontent`)',
    'Fixture-tested only': 'Testado via fixture',
    'Structural match': 'Compatibilidade estrutural',
    'Implemented with volume grouping and chapter extraction; pending official live-site testing checklist.':
      'Implementado com agrupamento por volumes e extração de capítulos; aguardando checklist oficial de teste em site ao vivo.',
    'Shares the same WordPress novel DOM layout as Central Novel; awaiting individual live reports.':
      'Compartilha a mesma estrutura DOM de temas WordPress do Central Novel; aguardando relatos individuais em uso real.',
    'Static HTML chapter indexes, blogs & paginated lists (`rel="next"`)':
      'Índices HTML estáticos, blogs e listas paginadas (`rel="next"`)',
    'Uses link-cluster scoring, prose density extraction, heuristic selector assistant, and 🎯 visual picker.':
      'Usa pontuação de clusters de links, extração por densidade de prosa, assistente heurístico de seletores e seletor visual 🎯 Apontar.',
    'Sequential chapters without a TOC page':
      'Capítulos sequenciais sem página de sumário',
    '`generic-html` ("Next Chapter" crawl)':
      '`generic-html` (rastreamento "Próximo Capítulo")',
    'Automatically crawls sequential *"Next Chapter"* links when landing on a prose chapter.':
      'Rastreia automaticamente links sequenciais de *"Próximo Capítulo"* / *"Next Chapter"* ao iniciar em um capítulo.',
    'JavaScript / SPA pages (React, Vue, Next.js)':
      'Páginas JavaScript / SPA (React, Vue, Next.js)',
    'Tab rendering (`renderWithTab`)':
      'Renderização via aba (`renderWithTab`)',
    'Extracts hydrated DOM via open or background browser tab when static HTML is an empty shell.':
      'Extrai o DOM hidratado via aba aberta ou aba auxiliar em segundo plano quando o HTML estático é uma casca vazia.',
    'Open browser tabs': 'Abas abertas do navegador',
    'Merge Tabs': 'Juntar Abas (*Merge Tabs*)',
    'Compiles open HTTP/HTTPS tabs into a single anthology or standalone books.':
      'Compila abas HTTP/HTTPS abertas em uma única coletânea ou em livros separados.',
    'Proprietary DRM platforms': 'Plataformas com DRM proprietário',
    'Content is encrypted and inaccessible as standard DOM text.':
      'O conteúdo é criptografado e inacessível como texto DOM padrão.',
    '`<canvas>` or scrambled-image chapters':
      'Capítulos em `<canvas>` ou imagens embaralhadas',
    'Text is rendered purely as pixels without HTML text nodes.':
      'O texto é renderizado apenas como pixels de imagem sem nós de texto HTML.',
    'Locked paywalls without session access':
      'Paywalls fechados sem acesso na sessão',
    'Browser session cannot access chapters behind paywalls.':
      'A sessão do navegador não tem acesso a capítulos bloqueados por paywall.',
    'Hard non-bypassable anti-bot / CAPTCHA gates':
      'Barreiras anti-bot / CAPTCHA estritas',
    'Automated requests are blocked until the user manually solves verification in a normal tab.':
      'Requisições automatizadas ficam bloqueadas até que o usuário conclua a verificação manualmente em uma aba normal.'
  };

  function getSavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
      return VALID_THEMES.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  function applyTheme(theme) {
    const valid = VALID_THEMES.includes(theme) ? theme : 'system';
    if (valid !== 'system') {
      root.dataset.theme = valid;
    } else {
      delete root.dataset.theme;
    }
    const select = document.getElementById('theme-select');
    if (select && select.value !== valid) {
      select.value = valid;
    }
  }

  function formatVersionLabel(tagName, isPrerelease) {
    const clean = String(tagName || '').trim().replace(/^v/i, '');
    if (!clean) return '';
    if (isPrerelease && !/-(?:beta|alpha|rc)/i.test(clean)) {
      return `v${clean}-beta`;
    }
    return `v${clean}`;
  }

  function applyReleaseMetadata(info) {
    if (!info || !info.versionLabel) return;
    for (const el of document.querySelectorAll('[data-wpb-version]')) {
      const prefix = el.getAttribute('data-wpb-version-prefix') || '';
      el.textContent = `${prefix}${info.versionLabel}`;
    }
  }

  async function resolveLatestRelease() {
    try {
      const cachedRaw = sessionStorage.getItem(RELEASE_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Date.now() - (cached.timestamp || 0) < CACHE_TTL_MS) {
          applyReleaseMetadata(cached);
          return;
        }
      }
    } catch {
      // ignore sessionStorage read errors
    }

    try {
      const resp = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!resp.ok) return;
      const list = await resp.json();
      const latest = Array.isArray(list) ? list[0] : null;
      if (!latest || !latest.tag_name) return;

      const info = {
        tagName: latest.tag_name,
        versionLabel: formatVersionLabel(latest.tag_name, Boolean(latest.prerelease)),
        timestamp: Date.now()
      };

      applyReleaseMetadata(info);
      try {
        sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(info));
      } catch {
        // ignore storage quota errors
      }
    } catch {
      // keep static fallback version when offline
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInlineMarkdown(md) {
    let out = escapeHtml(String(md || '').trim());
    out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/\s—\s/g, ' &mdash; ').replace(/^—$/, '&mdash;');
    return out;
  }

  function translateCell(text, isPt) {
    const clean = String(text || '').trim();
    if (!isPt) return clean;
    return PT_TRANSLATIONS[clean] || clean;
  }

  function formatLeadColumn(text) {
    const clean = String(text || '').trim();
    const parenIdx = clean.indexOf(' (');
    if (parenIdx > 0 && clean.endsWith(')')) {
      const titlePart = clean.slice(0, parenIdx);
      const parenPart = clean.slice(parenIdx + 1);
      return `<strong>${renderInlineMarkdown(titlePart)}</strong> ${renderInlineMarkdown(parenPart)}`;
    }
    return `<strong>${renderInlineMarkdown(clean)}</strong>`;
  }

  function parseMarkdownSections(markdown) {
    const sections = new Map();
    let currentHeading = '';
    for (const rawLine of String(markdown || '').split('\n')) {
      const line = rawLine.trim();
      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        currentHeading = h2Match[1].trim();
        sections.set(currentHeading, []);
        continue;
      }
      if (!currentHeading) continue;
      if (line.startsWith('|') && line.endsWith('|')) {
        sections.get(currentHeading).push(line);
      }
    }

    const parsedTables = new Map();
    for (const [heading, lines] of sections.entries()) {
      if (lines.length < 3) continue;
      const rows = [];
      for (let i = 2; i < lines.length; i++) {
        const cells = lines[i]
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        if (cells.length >= 2) rows.push(cells);
      }
      parsedTables.set(heading, rows);
    }
    return parsedTables;
  }

  function findRowsByPrefix(tablesMap, prefix) {
    for (const [heading, rows] of tablesMap.entries()) {
      if (heading.toLowerCase().startsWith(prefix.toLowerCase())) {
        return rows;
      }
    }
    return [];
  }

  function applyCompatibilityDom(compatMd, isPt) {
    const tables = parseMarkdownSections(compatMd);
    const tier1 = findRowsByPrefix(tables, 'Verified & Tested');
    const tier2 = findRowsByPrefix(tables, 'Added / Not Officially Tested');
    const tier3 = findRowsByPrefix(tables, 'Potentially Compatible');
    const tier4 = findRowsByPrefix(tables, 'Not Compatible');

    const t1El = document.querySelector('tbody[data-sync-table="compat-tier-1"]');
    if (t1El && tier1.length > 0) {
      t1El.innerHTML = tier1
        .map(
          ([site, adapter, lastVerified, _fixture, notes]) =>
            `<tr><td>${formatLeadColumn(translateCell(site, isPt))}</td><td>${renderInlineMarkdown(adapter)}</td><td>${escapeHtml(lastVerified)}</td><td>${renderInlineMarkdown(translateCell(notes, isPt))}</td></tr>`
        )
        .join('');
    }

    const t2El = document.querySelector('tbody[data-sync-table="compat-tier-2"]');
    if (t2El && tier2.length > 0) {
      t2El.innerHTML = tier2
        .map(
          ([site, adapter, status, _fixture, notes]) =>
            `<tr><td>${formatLeadColumn(translateCell(site, isPt))}</td><td>${renderInlineMarkdown(adapter)}</td><td><span class="badge warn">${renderInlineMarkdown(translateCell(status, isPt))}</span></td><td>${renderInlineMarkdown(translateCell(notes, isPt))}</td></tr>`
        )
        .join('');
    }

    const t3El = document.querySelector('tbody[data-sync-table="compat-tier-3"]');
    if (t3El && tier3.length > 0) {
      t3El.innerHTML = tier3
        .map(
          ([pattern, mode, notes]) =>
            `<tr><td>${formatLeadColumn(translateCell(pattern, isPt))}</td><td>${renderInlineMarkdown(translateCell(mode, isPt))}</td><td>${renderInlineMarkdown(translateCell(notes, isPt))}</td></tr>`
        )
        .join('');
    }

    const t4El = document.querySelector('tbody[data-sync-table="compat-tier-4"]');
    if (t4El && tier4.length > 0) {
      t4El.innerHTML = tier4
        .map(
          ([limitation, reason]) =>
            `<tr><td>${formatLeadColumn(translateCell(limitation, isPt))}</td><td>${renderInlineMarkdown(translateCell(reason, isPt))}</td></tr>`
        )
        .join('');
    }

    const summaryEls = document.querySelectorAll('[data-sync-compat-summary]');
    if (summaryEls.length > 0 && tier1.length > 0 && tier4.length > 0) {
      const verList = tier1.map(([site]) => escapeHtml(translateCell(site, isPt))).join(', ');
      const limList = tier4
        .map(([limitation]) => renderInlineMarkdown(translateCell(limitation, isPt)))
        .join(', ');
      const html = isPt
        ? `O WebPullBook extrai texto em DOM HTML padrão acessível na sessão do navegador (${verList} verificados de ponta a ponta, além de suporte heurístico genérico e modo SPA). Limitações mapeadas em <a href="compatibility.html">docs/COMPATIBILITY.md</a>: ${limList}.`
        : `WebPullBook extracts standard DOM HTML text accessible in your browser session (${verList} verified end-to-end, plus generic heuristic and SPA tab modes). Known limitations tracked in <a href="compatibility.html">docs/COMPATIBILITY.md</a>: ${limList}.`;
      for (const el of summaryEls) {
        el.innerHTML = html;
      }
    }
  }

  function applyReaderPresetsDom(presetsMd) {
    const target = document.querySelector('tbody[data-sync-table="reader-presets"]');
    if (!target) return;
    const tables = parseMarkdownSections(presetsMd);
    let rows = [];
    for (const r of tables.values()) {
      if (r.length > 0) {
        rows = r;
        break;
      }
    }
    if (rows.length === 0) return;
    target.innerHTML = rows
      .map((cells) => {
        const [profile, epubStd, footnotes, coverJpeg, imgOpt, maxRes, _align, recommended] =
          cells.length >= 8 ? cells : [...cells, ''];
        return `<tr><td>${renderInlineMarkdown(profile)}</td><td>${renderInlineMarkdown(epubStd)}</td><td>${renderInlineMarkdown(footnotes)}</td><td>${renderInlineMarkdown(coverJpeg)}</td><td>${renderInlineMarkdown(imgOpt)}</td><td>${renderInlineMarkdown(maxRes)}</td><td>${renderInlineMarkdown(recommended)}</td></tr>`;
      })
      .join('');
  }

  async function syncDocsFromRepo() {
    const needsCompat =
      document.querySelector('[data-sync-table^="compat-"]') !== null ||
      document.querySelector('[data-sync-compat-summary]') !== null;
    const needsPresets = document.querySelector('tbody[data-sync-table="reader-presets"]') !== null;
    if (!needsCompat && !needsPresets) return;

    const isPt = (root.lang || '').toLowerCase().startsWith('pt');
    let cached = null;
    try {
      const raw = sessionStorage.getItem(DOCS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Date.now() - (parsed.timestamp || 0) < CACHE_TTL_MS) {
          cached = parsed;
        }
      }
    } catch {
      // ignore storage errors
    }

    try {
      if (needsCompat) {
        let compatMd = cached?.compatMd;
        if (!compatMd) {
          const resp = await fetch(`${RAW_BASE_URL}/docs/COMPATIBILITY.md`);
          if (resp.ok) compatMd = await resp.text();
        }
        if (compatMd) {
          applyCompatibilityDom(compatMd, isPt);
          cached = { ...(cached || {}), compatMd, timestamp: Date.now() };
        }
      }

      if (needsPresets) {
        const key = isPt ? 'presetsPtMd' : 'presetsEnMd';
        const docFile = isPt ? 'READER_PRESETS.pt.md' : 'READER_PRESETS.md';
        let presetsMd = cached?.[key];
        if (!presetsMd) {
          const resp = await fetch(`${RAW_BASE_URL}/docs/${docFile}`);
          if (resp.ok) presetsMd = await resp.text();
        }
        if (presetsMd) {
          applyReaderPresetsDom(presetsMd);
          cached = { ...(cached || {}), [key]: presetsMd, timestamp: Date.now() };
        }
      }

      if (cached) {
        try {
          sessionStorage.setItem(DOCS_CACHE_KEY, JSON.stringify(cached));
        } catch {
          // ignore quota errors
        }
      }
    } catch {
      // keep pre-synced static HTML when offline
    }
  }

  applyTheme(getSavedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getSavedTheme());
    resolveLatestRelease();
    syncDocsFromRepo();

    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
      const currentVal = (root.lang || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
      const SAFE_LANG_ROUTES = new Map([
        ['index.html', { en: 'index.html', 'pt-BR': 'pt/index.html', enFromPt: '../index.html' }],
        ['features.html', { en: 'features.html', 'pt-BR': 'pt/features.html', enFromPt: '../features.html' }],
        ['installation.html', { en: 'installation.html', 'pt-BR': 'pt/installation.html', enFromPt: '../installation.html' }],
        ['compatibility.html', { en: 'compatibility.html', 'pt-BR': 'pt/compatibility.html', enFromPt: '../compatibility.html' }],
        ['faq.html', { en: 'faq.html', 'pt-BR': 'pt/faq.html', enFromPt: '../faq.html' }],
        ['privacy.html', { en: 'privacy.html', 'pt-BR': 'pt/privacy.html', enFromPt: '../privacy.html' }],
        ['contributing.html', { en: 'contributing.html', 'pt-BR': 'pt/contributing.html', enFromPt: '../contributing.html' }]
      ]);
      langSelect.value = currentVal;
      langSelect.addEventListener('change', () => {
        const nextLang = langSelect.value;
        if (nextLang === currentVal || (nextLang !== 'en' && nextLang !== 'pt-BR')) return;
        const segments = window.location.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1] || '';
        const pageKey = SAFE_LANG_ROUTES.has(last) ? last : 'index.html';
        const routes = SAFE_LANG_ROUTES.get(pageKey);
        const dest = currentVal === 'pt-BR' ? routes.enFromPt : routes['pt-BR'];
        if (dest) window.location.assign(dest);
      });
      window.addEventListener('pageshow', () => {
        langSelect.value = currentVal;
      });
    }

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = getSavedTheme();
      themeSelect.addEventListener('change', () => {
        const next = VALID_THEMES.includes(themeSelect.value) ? themeSelect.value : 'system';
        try {
          if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
          else localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // ignore storage restrictions
        }
        applyTheme(next);
      });
    }

    const navToggle = document.getElementById('nav-toggle');
    const navList = document.getElementById('site-menu');
    if (navToggle && navList) {
      navToggle.addEventListener('click', () => {
        const expanded = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', String(!expanded));
        navList.classList.toggle('is-open', !expanded);
      });
    }

    const tablist = document.querySelector('.showcase-tabs[role="tablist"]');
    if (tablist) {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      const panels = Array.from(document.querySelectorAll('.showcase-panel[role="tabpanel"]'));

      const activateTab = (targetTab, focus = false) => {
        const targetId = targetTab.getAttribute('aria-controls');
        for (const tab of tabs) {
          const selected = tab === targetTab;
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;
        }
        for (const panel of panels) {
          panel.hidden = panel.id !== targetId;
        }
        if (focus) targetTab.focus();
      };

      for (const tab of tabs) {
        tab.addEventListener('click', () => activateTab(tab, false));
      }

      tablist.addEventListener('keydown', (e) => {
        const idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;
        let nextIdx = -1;
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = tabs.length - 1;
        if (nextIdx !== -1) {
          e.preventDefault();
          activateTab(tabs[nextIdx], true);
        }
      });
    }
  });
})();
