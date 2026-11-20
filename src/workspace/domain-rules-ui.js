import { $, normalizeRuleDomain, state, t } from './state.js';
import { appendLog, showBanner } from './logger.js';
import { readOptionsFromUi } from './options-storage.js';

export async function loadDomainRules() {
  if (chrome?.storage?.local) {
    const res = await chrome.storage.local.get('wpbDomainRules');
    if (res?.wpbDomainRules && typeof res.wpbDomainRules === 'object') {
      state.domainRules = { ...res.wpbDomainRules };
    }
  }
  renderDomainRules();
}

export async function saveDomainRules() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ wpbDomainRules: state.domainRules });
  }
  renderDomainRules();
}

export function applyDomainRuleToInputs(domain) {
  const rule = state.domainRules[domain];
  if (!rule) return false;
  $('opt-list-selector').value = rule.listSelector || '';
  $('opt-content-selector').value = rule.contentSelector || '';
  $('opt-exclude-selector').value = rule.excludeSelector || '';
  $('opt-strip-regex').value = rule.stripPatterns || '';
  if (typeof rule.renderWithTab === 'boolean') {
    $('opt-render-with-tab').checked = rule.renderWithTab;
  }
  state.appliedRuleDomain = domain;
  readOptionsFromUi();
  return true;
}

export function applyDomainRuleForUrl(rawUrl) {
  const domain = normalizeRuleDomain(rawUrl);
  if (!domain) return false;
  if (state.appliedRuleDomain && state.appliedRuleDomain !== domain) {
    const prev = state.domainRules[state.appliedRuleDomain];
    if (prev) {
      if ($('opt-list-selector').value === (prev.listSelector || '')) $('opt-list-selector').value = '';
      if ($('opt-content-selector').value === (prev.contentSelector || '')) $('opt-content-selector').value = '';
      if ($('opt-exclude-selector').value === (prev.excludeSelector || '')) $('opt-exclude-selector').value = '';
      if ($('opt-strip-regex').value === (prev.stripPatterns || '')) $('opt-strip-regex').value = '';
    }
    state.appliedRuleDomain = '';
  }
  if (state.domainRules[domain]) {
    applyDomainRuleToInputs(domain);
    appendLog(`[RULE] Regra salva aplicada automaticamente para "${domain}".`);
    return true;
  }
  return false;
}

export function renderDomainRules() {
  const container = $('domain-rules-list');
  if (!container) return;
  const entries = Object.values(state.domainRules || {}).sort((a, b) => a.domain.localeCompare(b.domain));
  if (entries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted sm';
    empty.textContent = t('domainRulesEmpty');
    container.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const rule of entries) {
    const chip = document.createElement('div');
    chip.className = 'domain-rule-chip';
    const label = document.createElement('span');
    label.textContent = rule.domain;
    label.title = [
      rule.listSelector ? `list: ${rule.listSelector}` : '',
      rule.contentSelector ? `content: ${rule.contentSelector}` : '',
      rule.excludeSelector ? `exclude: ${rule.excludeSelector}` : ''
    ]
      .filter(Boolean)
      .join(' | ');

    const btnApply = document.createElement('button');
    btnApply.type = 'button';
    btnApply.className = 'btn ghost sm';
    btnApply.textContent = t('btnRuleApply');
    btnApply.addEventListener('click', () => {
      applyDomainRuleToInputs(rule.domain);
      showBanner(t('msgDomainRuleApplied', { domain: rule.domain }), 'success');
    });

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn ghost sm';
    btnDel.textContent = t('btnRuleDelete');
    btnDel.addEventListener('click', async () => {
      if (state.appliedRuleDomain === rule.domain) {
        if ($('opt-list-selector').value === (rule.listSelector || '')) $('opt-list-selector').value = '';
        if ($('opt-content-selector').value === (rule.contentSelector || '')) $('opt-content-selector').value = '';
        if ($('opt-exclude-selector').value === (rule.excludeSelector || '')) $('opt-exclude-selector').value = '';
        if ($('opt-strip-regex').value === (rule.stripPatterns || '')) $('opt-strip-regex').value = '';
        state.appliedRuleDomain = '';
        readOptionsFromUi();
      }
      delete state.domainRules[rule.domain];
      await saveDomainRules();
      showBanner(t('msgDomainRuleDeleted', { domain: rule.domain }), 'info');
    });

    chip.append(label, btnApply, btnDel);
    frag.appendChild(chip);
  }
  container.replaceChildren(frag);
}

export async function handleSaveDomainRule() {
  readOptionsFromUi();
  const domain = normalizeRuleDomain($('starting-url').value.trim() || state.metadata.startingUrl);
  const hasSelectors = Boolean(
    state.options.customListSelector ||
      state.options.customContentSelector ||
      state.options.customExcludeSelector ||
      state.options.customStripPatterns
  );
  if (!domain || !hasSelectors) {
    showBanner(t('msgDomainRuleNoUrl'), 'error');
    return;
  }
  state.domainRules[domain] = {
    domain,
    listSelector: state.options.customListSelector,
    contentSelector: state.options.customContentSelector,
    excludeSelector: state.options.customExcludeSelector,
    stripPatterns: state.options.customStripPatterns,
    renderWithTab: Boolean(state.options.renderWithTab),
    updatedAt: new Date().toISOString()
  };
  state.appliedRuleDomain = domain;
  await saveDomainRules();
  appendLog(`[RULE] Regra de seletores salva para "${domain}".`);
  showBanner(t('msgDomainRuleSaved', { domain }), 'success');
}
