/**
 * WebPullBook Official Website — Minimalist Vanilla JS controller
 * Handles language dropdown selection, 5-theme selector (Auto / Light / Dark / Sepia / Midnight),
 * mobile navigation disclosure, interactive screenshot tabs, and automatic GitHub Release version detection.
 */
(function () {
  const THEME_STORAGE_KEY = 'wpb-site-theme';
  const VALID_THEMES = ['system', 'light', 'dark', 'sepia', 'midnight'];
  const RELEASE_CACHE_KEY = 'wpb-latest-release-v3';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const RELEASES_API_URL = 'https://api.github.com/repos/WiltonGabriel/WebPullBook/releases?per_page=5';
  const root = document.documentElement;

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

  function parseSemverTag(tagName) {
    const m = String(tagName || '')
      .trim()
      .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/i);
    if (!m) return null;
    return {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      pre: m[4] || ''
    };
  }

  function compareSemver(a, b) {
    const pa = parseSemverTag(a?.tag_name);
    const pb = parseSemverTag(b?.tag_name);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    if (pa.patch !== pb.patch) return pa.patch - pb.patch;
    if (!pa.pre && pb.pre) return 1;
    if (pa.pre && !pb.pre) return -1;
    return pa.pre.localeCompare(pb.pre);
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
    if (!document.querySelector('[data-wpb-version]')) return;
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
      const published = Array.isArray(list) ? list.filter((r) => r && !r.draft && r.tag_name) : [];
      if (published.length === 0) return;
      published.sort((a, b) => compareSemver(b, a));
      const latest = published[0];

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

  applyTheme(getSavedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getSavedTheme());
    resolveLatestRelease();

    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
      const currentVal = (root.lang || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
      const SAFE_LANG_ROUTES = new Map([
        ['index.html', { 'pt-BR': 'pt/', enFromPt: '../' }],
        ['features.html', { 'pt-BR': 'pt/features.html', enFromPt: '../features.html' }],
        ['installation.html', { 'pt-BR': 'pt/installation.html', enFromPt: '../installation.html' }],
        ['compatibility.html', { 'pt-BR': 'pt/compatibility.html', enFromPt: '../compatibility.html' }],
        ['faq.html', { 'pt-BR': 'pt/faq.html', enFromPt: '../faq.html' }],
        ['privacy.html', { 'pt-BR': 'pt/privacy.html', enFromPt: '../privacy.html' }],
        ['contributing.html', { 'pt-BR': 'pt/contributing.html', enFromPt: '../contributing.html' }]
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

    const prefsToggle = document.getElementById('prefs-toggle');
    const prefsPanel = document.getElementById('prefs-panel');
    if (prefsToggle && prefsPanel) {
      if (Object.hasOwn(HTMLElement.prototype, 'popover')) {
        prefsPanel.addEventListener('toggle', (e) => {
          prefsToggle.setAttribute('aria-expanded', String(e.newState === 'open'));
        });
      } else {
        const setFallbackOpen = (open) => {
          prefsPanel.classList.toggle(':popover-open', open);
          prefsToggle.setAttribute('aria-expanded', String(open));
        };
        setFallbackOpen(false);
        prefsToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          setFallbackOpen(!prefsPanel.classList.contains(':popover-open'));
        });
        document.addEventListener('click', (e) => {
          if (
            prefsPanel.classList.contains(':popover-open') &&
            !prefsPanel.contains(e.target) &&
            !prefsToggle.contains(e.target)
          ) {
            setFallbackOpen(false);
          }
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && prefsPanel.classList.contains(':popover-open')) {
            setFallbackOpen(false);
            prefsToggle.focus();
          }
        });
      }
    }

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
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
      const closeMobileMenu = () => {
        navToggle.setAttribute('aria-expanded', 'false');
        navList.classList.remove('is-open');
      };
      navToggle.addEventListener('click', () => {
        const expanded = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', String(!expanded));
        navList.classList.toggle('is-open', !expanded);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navList.classList.contains('is-open')) {
          closeMobileMenu();
          navToggle.focus();
        }
      });
      document.addEventListener('click', (e) => {
        if (
          navList.classList.contains('is-open') &&
          !navList.contains(e.target) &&
          !navToggle.contains(e.target)
        ) {
          closeMobileMenu();
        }
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
