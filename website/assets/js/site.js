/**
 * WebPullBook Official Website — Minimalist Vanilla JS controller
 * Handles theme switching (System / Light / Dark), mobile navigation disclosure,
 * interactive screenshot tabs, and automatic GitHub Release version & direct ZIP asset resolution.
 */
(function () {
  const THEME_STORAGE_KEY = 'wpb-site-theme';
  const RELEASE_CACHE_KEY = 'wpb-latest-release-v1';
  const RELEASE_CACHE_TTL_MS = 10 * 60 * 1000;
  const RELEASES_API_URL = 'https://api.github.com/repos/WiltonGabriel/WebPullBook/releases?per_page=1';
  const root = document.documentElement;

  function getSavedTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    } catch {
      return 'system';
    }
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const isPt = (root.lang || '').toLowerCase().startsWith('pt');
      const labels = isPt
        ? { system: 'Tema: Auto', light: 'Tema: Claro', dark: 'Tema: Escuro' }
        : { system: 'Theme: Auto', light: 'Theme: Light', dark: 'Theme: Dark' };
      btn.textContent = labels[theme] || labels.system;
      btn.dataset.currentTheme = theme;
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
    if (!info) return;
    if (info.versionLabel) {
      for (const el of document.querySelectorAll('[data-wpb-version]')) {
        const prefix = el.getAttribute('data-wpb-version-prefix') || '';
        el.textContent = `${prefix}${info.versionLabel}`;
      }
    }
    if (info.downloadUrl) {
      for (const link of document.querySelectorAll('a[data-wpb-download]')) {
        link.href = info.downloadUrl;
        if (info.assetName) {
          link.title = info.assetName;
        }
      }
    }
  }

  async function resolveLatestRelease() {
    try {
      const cachedRaw = sessionStorage.getItem(RELEASE_CACHE_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (cached && Date.now() - (cached.timestamp || 0) < RELEASE_CACHE_TTL_MS) {
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

      const assets = Array.isArray(latest.assets) ? latest.assets : [];
      const zipAsset =
        assets.find((a) => typeof a?.name === 'string' && a.name.endsWith('.zip') && !a.name.endsWith('.sha256')) ||
        null;

      const info = {
        tagName: latest.tag_name,
        versionLabel: formatVersionLabel(latest.tag_name, Boolean(latest.prerelease)),
        downloadUrl: zipAsset?.browser_download_url || latest.html_url || '',
        assetName: zipAsset?.name || '',
        timestamp: Date.now()
      };

      applyReleaseMetadata(info);
      try {
        sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(info));
      } catch {
        // ignore storage quota errors
      }
    } catch {
      // keep static fallback version and links when offline
    }
  }

  applyTheme(getSavedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getSavedTheme());
    resolveLatestRelease();

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const current = themeBtn.dataset.currentTheme || 'system';
        const order = ['system', 'dark', 'light'];
        const next = order[(order.indexOf(current) + 1) % order.length];
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
