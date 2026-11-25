import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchFirefoxExtension } from './helpers/firefox-driver.mjs';
import { inspectEpubFile } from './helpers/epub-inspector.mjs';
import { createMockNovelServer } from './helpers/mock-novel-server.mjs';

async function runFirefoxE2E() {
  const headless = process.env.WPB_E2E_HEADED !== '1';
  const { server, serverState } = createMockNovelServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const seriesUrl = `${origin}/series/e2e-book/`;

  let ff;
  try {
    ff = await launchFirefoxExtension({ headless });

    // 1. Open workspace and verify Firefox-specific MV3 UI, DNR Rule 1, theme/lang, and File System Access fallback
    const wsHandle = await ff.openWorkspace(seriesUrl);
    await ff.waitFor(`return document.querySelector('#meta-title')?.value === 'Crônica E2E';`, 15000);
    assert.equal(await ff.execAsync(`return document.querySelector('#meta-author')?.value;`), 'Autora E2E');
    assert.equal(
      await ff.execAsync(`return document.querySelectorAll('#chapters-tbody tr').length;`),
      2
    );

    const ffCaps = await ff.execAsync(`
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const saveBtn = document.querySelector('#btn-pick-save-folder');
      return {
        rule1: rules.find((r) => r.id === 1) || null,
        saveBtnHidden: saveBtn ? saveBtn.classList.contains('hidden') : false
      };
    `);
    assert.ok(ffCaps.rule1, 'Firefox MV3 DNR Rule ID 1 (Origin removal) must be installed');
    assert.equal(ffCaps.saveBtnHidden, true, 'Custom directory picker should be hidden on Firefox');

    // 2. Verify language switcher translates #opt-parser auto option & theme switcher updates data-theme
    await ff.selectOption('#ui-lang-top', 'en');
    assert.equal(
      await ff.execAsync(`return document.querySelector('#opt-parser option[value="auto"]')?.textContent?.trim();`),
      'Automatic (DOM Scoring)'
    );
    await ff.selectOption('#ui-lang-top', 'pt');
    assert.equal(
      await ff.execAsync(`return document.querySelector('#opt-parser option[value="auto"]')?.textContent?.trim();`),
      'Automático (Pontuação DOM)'
    );
    await ff.selectOption('#ui-theme-top', 'midnight');
    assert.equal(await ff.execAsync(`return document.documentElement.dataset.theme;`), 'midnight');
    await ff.selectOption('#ui-theme-top', 'system');

    // 3. Verify Safe Mode toggle does NOT flip Reader Preset to 'custom'
    await ff.selectOption('#reader-preset', 'kobo');
    await ff.setChecked('#opt-safe-mode', false);
    assert.equal(await ff.execAsync(`return document.querySelector('#reader-preset').value;`), 'kobo');
    await ff.setChecked('#opt-safe-mode', true);
    assert.equal(await ff.execAsync(`return document.querySelector('#reader-preset').value;`), 'kobo');

    // 4. Verify <dialog> backdrop click dismiss fallback (Firefox < 141 compatibility) & Preview Quick Edit
    await ff.click('#chapters-tbody tr:first-child .chap-preview-btn');
    await ff.waitFor(`return Boolean(document.querySelector('#preview-modal[open]') && !document.querySelector('#btn-preview-toggle-edit')?.classList.contains('hidden'));`, 10000);
    await ff.execAsync(`
      const dlg = document.querySelector('#preview-modal');
      dlg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      return true;
    `);
    await ff.waitFor(`return !document.querySelector('#preview-modal')?.open;`, 5000);

    // Quick Edit chapter 1 and pack EPUB 3 (modern preset) via Firefox chrome.downloads
    await ff.click('#chapters-tbody tr:first-child .chap-preview-btn');
    await ff.waitFor(`return Boolean(document.querySelector('#preview-modal[open]'));`, 10000);
    await ff.click('#btn-preview-toggle-edit');
    await ff.fill('#preview-edit-title-input', 'Capítulo 1 — Firefox Editado');
    await ff.execAsync(`document.querySelector('#preview-modal-content').innerHTML = '<p>Prosa editada no Firefox real.</p>'; return true;`);
    await ff.click('#btn-preview-save-edit');
    await ff.click('#preview-modal .dialog-footer form[method="dialog"] button');
    await ff.waitFor(`return !document.querySelector('#preview-modal')?.open;`, 5000);

    await ff.selectOption('#reader-preset', 'modern');
    await ff.fill('#opt-delay', '0');
    await ff.click('[data-tab="main"]');
    await ff.click('#btn-pack-epub');
    await ff.waitFor(`return /Concluído/i.test(document.querySelector('#progress-label')?.textContent || '');`, 25000);
    const epub3Path = await ff.waitForDownloadedFile(/\.epub$/i);
    const epub3Audit = await inspectEpubFile(epub3Path, { expectedVersion: 3, minChapters: 2, requireCover: true });
    assert.equal(epub3Audit.ok, true, `Firefox EPUB 3 audit failed:\n${epub3Audit.issues.join('\n')}`);
    fs.rmSync(epub3Path, { force: true });

    // 5. Verify EPUB 2 (kindle preset) + HTML + MD + TXT exporters in Firefox
    await ff.selectOption('#reader-preset', 'kindle');
    await ff.click('#btn-pack-epub');
    await ff.waitFor(`return /Concluído/i.test(document.querySelector('#progress-label')?.textContent || '');`, 25000);
    const epub2Path = await ff.waitForDownloadedFile(/\.epub$/i);
    const epub2Audit = await inspectEpubFile(epub2Path, { expectedVersion: 2, minChapters: 2, requireCover: true });
    assert.equal(epub2Audit.ok, true, `Firefox EPUB 2 audit failed:\n${epub2Audit.issues.join('\n')}`);
    fs.rmSync(epub2Path, { force: true });

    for (const [fmt, rx] of [['html', /\.html$/i], ['md', /\.md$/i], ['txt', /\.txt$/i]]) {
      await ff.selectOption('#output-format', fmt);
      await ff.click('#btn-pack-epub');
      await ff.waitFor(`return /Concluído/i.test(document.querySelector('#progress-label')?.textContent || '');`, 20000);
      const outPath = await ff.waitForDownloadedFile(rx);
      const txt = fs.readFileSync(outPath, 'utf8');
      assert.match(txt, /Prosa editada no Firefox real/);
      if (fmt === 'html') assert.match(txt, /data:image\/png;base64,/);
      fs.rmSync(outPath, { force: true });
    }
    await ff.selectOption('#output-format', 'epub');
    await ff.selectOption('#reader-preset', 'modern');

    // 6. Verify IndexedDB Cache Session restore keeps edited chapter & requiresTabRender
    await ff.click('[data-tab="library"]');
    await ff.waitFor(`return document.querySelectorAll('#cache-sessions-grid .lib-card').length >= 1;`, 10000);
    await ff.execAsync(`document.querySelector('#chapters-tbody').replaceChildren(); return true;`);
    await ff.click('#cache-sessions-grid .lib-card button.primary');
    await ff.waitFor(`return document.querySelectorAll('#chapters-tbody tr .badge.edited').length >= 1;`, 10000);

    // 7. Verify Library Save, Check New Chapters, Batch Download Updates (SVG icon preserved!), & Referer-protected DNR image (cap-03)
    await ff.click('#btn-save-library');
    serverState.newChapterAdded = true;
    await ff.click('[data-tab="library"]');
    await ff.click('#btn-check-all-library');
    await ff.waitFor(`return /1 novo/i.test(document.querySelector('#library-grid .lib-status-pill')?.textContent || '');`, 15000);
    await ff.click('#btn-download-library-updates');
    await ff.waitFor(
      `const b = document.querySelector('#btn-download-library-updates');
       return b && !b.disabled && /Baixar Novidades/i.test(b.textContent || '') && Boolean(document.querySelector('#export-report:not(.hidden)'));`,
      30000
    );
    assert.equal(
      await ff.execAsync(`return Boolean(document.querySelector('#btn-download-library-updates svg.wpb-icon'));`),
      true,
      'Batch download button must keep its SVG icon after completion'
    );
    const updateEpubPath = await ff.waitForDownloadedFile(/\.epub$/i);
    const updateAudit = await inspectEpubFile(updateEpubPath, { expectedVersion: 3, minChapters: 1, requireCover: true, requireImages: true });
    assert.equal(updateAudit.ok, true, `Firefox update EPUB failed:\n${updateAudit.issues.join('\n')}`);
    assert.ok(updateAudit.summary.chapterImageFiles.length >= 1, 'DNR Referer fallback should embed hotlink-pic.png in Firefox');
    fs.rmSync(updateEpubPath, { force: true });

    // 8. Verify Retry Failed workflow (500 -> 200 on retry) & Pause/Cancel workflow
    await ff.selectOption('#output-format', 'epub');
    await ff.fill('#starting-url', `${origin}/series/flaky-book/`);
    await ff.click('#btn-load-series');
    await ff.waitFor(`return document.querySelector('#meta-title')?.value === 'Livro Instável E2E';`, 15000);
    await ff.setChecked('#opt-continue-on-error', true);
    await ff.fill('#opt-retries', '0');
    await ff.fill('#opt-delay', '0');
    await ff.click('[data-tab="main"]');
    await ff.click('#btn-pack-epub');
    await ff.waitFor(`return !document.querySelector('#btn-retry-failed')?.classList.contains('hidden');`, 25000);
    // Clear the partial 1-chapter EPUB produced before retrying the failed chapter
    const partialFlakyEpub = await ff.waitForDownloadedFile(/\.epub$/i, 10000);
    fs.rmSync(partialFlakyEpub, { force: true });
    await ff.click('#btn-retry-failed');
    await ff.waitFor(`return document.querySelector('#btn-retry-failed')?.classList.contains('hidden') && /Concluído/i.test(document.querySelector('#progress-label')?.textContent || '');`, 25000);
    const flakyEpub = await ff.waitForDownloadedFile(/\.epub$/i);
    const flakyAudit = await inspectEpubFile(flakyEpub, { minChapters: 2 });
    assert.equal(flakyAudit.ok, true, `Firefox flaky retry EPUB failed:\n${flakyAudit.issues.join('\n')}`);
    fs.rmSync(flakyEpub, { force: true });

    // Pause -> Resume and Cancel with #confirm-cancel-modal
    await ff.fill('#starting-url', `${origin}/series/slow-book/`);
    await ff.click('#btn-load-series');
    await ff.waitFor(`return document.querySelector('#meta-title')?.value === 'Livro Lento E2E';`, 15000);
    await ff.click('#btn-pack-epub');
    await ff.waitFor(`return !document.querySelector('#btn-pause').disabled;`, 10000);
    await ff.click('#btn-pause');
    assert.match(await ff.execAsync(`return document.querySelector('#progress-label').textContent;`), /Pausado|Paused/i);
    await ff.click('#btn-cancel');
    await ff.waitFor(`return Boolean(document.querySelector('#confirm-cancel-modal[open]'));`, 5000);
    await ff.click('#btn-confirm-cancel-run');
    await ff.waitFor(`return document.querySelector('#btn-cancel').disabled;`, 10000);

    // 9. Verify Reset All Options does not break metadata UI (state.activeParser preserved) & Merge Tabs + SPA fallback
    await ff.click('[data-tab="advanced"]');
    await ff.click('#btn-reset-all-opts');
    await ff.waitFor(`return Boolean(document.querySelector('#confirm-reset-modal[open]'));`, 5000);
    await ff.click('#btn-confirm-reset-all');
    await ff.waitFor(`return !document.querySelector('#confirm-reset-modal')?.open;`, 5000);
    const parserBadgeAfterReset = await ff.execAsync(`
      const { syncMetadataToUi } = await import('/src/workspace/options-storage.js');
      syncMetadataToUi();
      return document.querySelector('#parser-badge')?.textContent || '';
    `);
    assert.match(parserBadgeAfterReset, /Universal Smart Extractor/);

    // 10. Verify SPA TabRenderPool fallback in Firefox
    const spaHandle = await ff.openWorkspace(`${origin}/spa-novel/`);
    await ff.waitFor(`return document.querySelector('#meta-title')?.value === 'Livro SPA E2E';`, 25000);
    assert.equal(await ff.execAsync(`return document.querySelectorAll('#chapters-tbody tr').length;`), 1);
    await ff.click('#btn-preview-chapter');
    await ff.waitFor(`return /Prosa hidratada via JavaScript/i.test(document.querySelector('#preview-modal-content')?.textContent || '');`, 15000);
    await ff.closeTab(spaHandle);
    await ff.switchToTab(wsHandle);

    // 11. Verify Firefox permissions revocation banner & submit/merge guard
    await ff.execAsync(`await chrome.permissions.remove({ origins: ['https://*/*', 'http://*/*'] }); return true;`);
    await ff.waitFor(`return !document.querySelector('#firefox-perm-banner')?.classList.contains('hidden');`, 5000);
    await ff.click('#btn-merge-tabs');
    assert.match(await ff.execAsync(`return document.querySelector('#status-banner')?.textContent || '';`), /permissão|permission/i);

    console.log('[OK] Firefox MV3 E2E passed end-to-end (DNR rule 1 + 120..129, downloads, EPUB 2/3, HTML/MD/TXT, retry, pause/cancel, cache/library, SPA, perms guard)');
  } finally {
    if (ff) await ff.close();
    server.close();
  }
}

runFirefoxE2E().catch((err) => {
  console.error('Firefox E2E test failed:', err);
  process.exit(1);
});
