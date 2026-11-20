try {
  const stored = localStorage.getItem('wpb-color-scheme');
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (stored === 'light' || stored === 'dark' || stored === 'sepia' || stored === 'midnight') {
    root.dataset.theme = stored;
    if (meta) {
      meta.content = stored === 'dark' || stored === 'midnight' ? 'dark' : 'light';
    }
  } else {
    delete root.dataset.theme;
    if (meta) meta.content = 'light dark';
  }
  const initialUrl = new URLSearchParams(window.location.search).get('url');
  if (initialUrl && /^https?:\/\//i.test(initialUrl)) {
    root.dataset.initialLoading = 'true';
  }
} catch {
  // Ignore storage access errors
}
