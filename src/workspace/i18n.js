import { PT_MESSAGES } from './locales/pt.js';
import { EN_MESSAGES } from './locales/en.js';

export const I18N_DICTIONARY = {
  pt: PT_MESSAGES,
  en: EN_MESSAGES
};

export function translate(lang, key, vars = {}) {
  const dict = I18N_DICTIONARY[lang] || I18N_DICTIONARY.pt;
  let template = dict[key] ?? I18N_DICTIONARY.pt[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    template = template.replaceAll(`{${k}}`, String(v));
  }
  return template;
}

export function applyI18nToDom(lang = 'pt') {
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = translate(lang, key);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', translate(lang, key));
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', translate(lang, key));
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', translate(lang, key));
  }
  for (const el of document.querySelectorAll('[data-i18n-alt]')) {
    const key = el.getAttribute('data-i18n-alt');
    if (key) el.setAttribute('alt', translate(lang, key));
  }
}
