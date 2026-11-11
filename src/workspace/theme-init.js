try {
  const stored = localStorage.getItem('wpb-color-scheme');
  if (stored === 'light' || stored === 'dark') {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = stored;
  }
} catch {
  // Ignore storage access errors
}
