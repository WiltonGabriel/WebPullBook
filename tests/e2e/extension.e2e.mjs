import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { readZipArchive } from '../helpers/zip-reader.js';
import { resolveEpubCheckRunner, runEpubCheck } from '../helpers/epubcheck.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function createMockNovelServer() {
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const origin = `http://127.0.0.1:${server.address().port}`;

    if (reqUrl.pathname === '/series/e2e-book/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>E2E Novel — Teste</title>
</head>
<body>
  <div class="thumbook"><div class="thumb"><img src="${origin}/cover.png" alt="Capa"></div></div>
  <div class="infox">
    <h1 class="entry-title">Crônica E2E</h1>
    <div class="spe"><span>Autor: Autora E2E</span><span>Status: Completo</span></div>
    <div class="genxed"><a href="#">Fantasia</a></div>
  </div>
  <div class="synp"><div class="entry-content" itemprop="description"><p>Sinopse E2E automatizada.</p></div></div>
  <div class="ts-chl-collapsible">Volume 1</div>
  <div class="ts-chl-collapsible-content">
    <div class="eplister"><ul>
      <li><a href="${origin}/series/e2e-book/cap-02/"><div class="epl-num">Cap. 2</div><div class="epl-title">Segundo Ato</div></a></li>
      <li><a href="${origin}/series/e2e-book/cap-01/"><div class="epl-num">Cap. 1</div><div class="epl-title">Primeiro Ato</div></a></li>
    </ul></div>
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/e2e-book/cap-01/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Cap. 1</title></head>
<body>
  <h1 class="entry-title">Capítulo 1 — Primeiro Ato</h1>
  <div class="epcontent">
    <p>Conteúdo principal do primeiro capítulo com <b>negrito</b>.</p>
    <img src="${origin}/art-ok.png" alt="Ilustração">
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/e2e-book/cap-02/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Cap. 2</title></head>
<body>
  <h1 class="entry-title">Capítulo 2 — Segundo Ato</h1>
  <div class="epcontent">
    <p>Conteúdo do segundo capítulo com imagem bloqueada.</p>
    <img src="${origin}/blocked-403.png" alt="Imagem 403">
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/cover.png' || reqUrl.pathname === '/art-ok.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_1X1);
      return;
    }

    if (reqUrl.pathname === '/blocked-403.png') {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return server;
}

async function runE2E() {
  const repoRoot = path.resolve('.');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpb-e2e-profile-'));
  const server = createMockNovelServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const seriesUrl = `http://127.0.0.1:${port}/series/e2e-book/`;

  let context;
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${repoRoot}`,
        `--load-extension=${repoRoot}`,
        '--no-sandbox'
      ]
    });

    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    }
    const extId = new URL(sw.url()).host;
    assert.ok(extId, 'Extension ID should resolve from MV3 service worker');

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/src/workspace/workspace.html?url=${encodeURIComponent(seriesUrl)}`);

    // Wait for automatic series loading
    await page.waitForFunction(
      () => document.querySelector('#meta-title')?.value === 'Crônica E2E',
      null,
      { timeout: 15000 }
    );
    assert.equal(await page.inputValue('#meta-author'), 'Autora E2E');

    const rowCount = await page.locator('#chapters-tbody tr').count();
    assert.equal(rowCount, 2, 'Should list both extracted chapters');
    assert.equal((await page.textContent('label.safe-mode-card strong')).trim(), 'Modo Seguro');

    // Test volume re-detection button restores volume labels cleanly
    await page.click('#btn-redetect-volumes');
    await page.waitForFunction(
      () => /Detecção de volumes concluída/i.test(document.querySelector('#status-banner')?.textContent || ''),
      null,
      { timeout: 10000 }
    );

    // 1. Test dry-run chapter preview modal
    await page.click('#btn-preview-chapter');
    await page.waitForSelector('#preview-modal[open]', { timeout: 10000 });
    await page.waitForFunction(
      () => /primeiro capítulo/i.test(document.querySelector('#preview-modal-content')?.textContent || ''),
      null,
      { timeout: 10000 }
    );
    await page.click('#preview-modal .dialog-footer button');
    await page.waitForSelector('#preview-modal:not([open])', { state: 'hidden' });

    // 2. Test Reader Preset selector (kindle disables EPUB 3, legacy switches to EPUB 2, modern restores EPUB 3)
    await page.selectOption('#reader-preset', 'kindle');
    assert.equal(await page.isChecked('#opt-epub3'), false, 'Kindle preset should switch to EPUB 2');
    await page.selectOption('#reader-preset', 'legacy');
    assert.equal(await page.isChecked('#opt-epub3'), false, 'Legacy preset should switch to EPUB 2');
    assert.equal(
      await page.evaluate(() => !document.getElementById('legacy-preset-warning').classList.contains('hidden')),
      true,
      'Legacy warning note should be visible when legacy preset is active'
    );
    await page.selectOption('#reader-preset', 'kobo');
    assert.equal(await page.isChecked('#opt-grayscale-images'), true, 'Kobo preset should enable E-Ink grayscale');
    await page.selectOption('#reader-preset', 'modern');
    assert.equal(await page.isChecked('#opt-epub3'), true, 'Modern preset should re-enable EPUB 3');
    assert.equal(
      await page.evaluate(() => document.getElementById('legacy-preset-warning').classList.contains('hidden')),
      true,
      'Legacy warning note should hide when modern preset is selected'
    );
    assert.equal(await page.isChecked('#opt-grayscale-images'), false);

    // 3. Test Auto Cover generator, then restore mock cover URL for pack verification
    const origCoverUrl = await page.inputValue('#meta-cover-url');
    await page.click('#btn-generate-cover');
    const generatedCover = await page.inputValue('#meta-cover-url');
    assert.match(generatedCover, /^data:image\/jpeg;base64,/);
    await page.fill('#meta-cover-url', origCoverUrl);

    // 4. Test Domain Rule persistence & Library batch check
    await page.click('#btn-save-library');
    await page.click('[data-tab="library"]');
    await page.click('#btn-check-all-library');
    await page.waitForSelector('#library-grid .lib-status-pill', { timeout: 15000 });
    assert.match(await page.textContent('#library-grid .lib-status-pill'), /Em dia/i);

    await page.click('[data-tab="advanced"]');
    await page.fill('#opt-content-selector', '.epcontent');
    await page.click('#btn-save-domain-rule');
    await page.waitForSelector('#domain-rules-list .domain-rule-chip');
    assert.match(await page.textContent('#domain-rules-list'), /127\.0\.0\.1/);

    // Verify custom folder name, organization presets, custom folder template, and live preview
    await page.fill('#opt-root-folder', 'Biblioteca/Novels');
    await page.selectOption('#opt-folder-layout', 'root-author-title');
    assert.match(await page.textContent('#path-preview-text'), /^Downloads\/Biblioteca\/Novels\//);

    await page.selectOption('#opt-folder-layout', 'custom');
    assert.equal(
      await page.evaluate(() => !document.getElementById('custom-folder-template-wrap').classList.contains('hidden')),
      true,
      'Custom folder template field should appear when layout is custom'
    );
    await page.fill('#opt-folder-template', '%Root%/%Format%/%Title%');
    assert.match(await page.textContent('#path-preview-text'), /Downloads\/Biblioteca\/Novels\/EPUB\//);

    // Verify section reset requires confirmation, resets ONLY its card, and displays section-specific banner
    await page.fill('#opt-custom-filename', '%Title%-Custom');
    await page.fill('#opt-retries', '4');
    await page.click('#btn-reset-network');
    await page.waitForSelector('#confirm-reset-modal[open]');
    await page.click('#confirm-reset-modal button[value="cancel"]');
    await page.waitForSelector('#confirm-reset-modal[open]', { state: 'detached' });
    assert.equal(await page.inputValue('#opt-retries'), '4', 'Cancelling section reset must keep retries');

    await page.click('#btn-reset-network');
    await page.waitForSelector('#confirm-reset-modal[open]');
    await page.click('#btn-confirm-reset-all');
    await page.waitForSelector('#confirm-reset-modal[open]', { state: 'detached' });
    assert.equal(await page.inputValue('#opt-retries'), '2', 'Network reset should restore retries');
    assert.equal(
      await page.inputValue('#opt-custom-filename'),
      '%Title%-Custom',
      'Network reset must NOT touch Files section'
    );
    assert.equal(await page.inputValue('#opt-root-folder'), 'Biblioteca/Novels');
    assert.match(await page.textContent('#status-banner'), /Rede, SPA & Resiliência/);

    // Verify Global Reset requires confirmation modal (cancel keeps edits, confirm resets all)
    await page.click('#btn-reset-all-opts');
    await page.waitForSelector('#confirm-reset-modal[open]');
    await page.click('#confirm-reset-modal button[value="cancel"]');
    await page.waitForSelector('#confirm-reset-modal[open]', { state: 'detached' });
    assert.equal(await page.inputValue('#opt-custom-filename'), '%Title%-Custom');

    await page.click('#btn-reset-all-opts');
    await page.waitForSelector('#confirm-reset-modal[open]');
    await page.click('#btn-confirm-reset-all');
    await page.waitForSelector('#confirm-reset-modal[open]', { state: 'detached' });
    assert.equal(await page.inputValue('#opt-custom-filename'), '%Filename%');
    assert.equal(await page.inputValue('#opt-root-folder'), 'WebPullBook');
    assert.equal(await page.inputValue('#opt-folder-layout'), 'root-title');
    assert.match(await page.textContent('#status-banner'), /Todas as opções avançadas foram restauradas/);

    // Configure custom root folder + author/title organization before exporting E2E EPUB
    await page.fill('#opt-root-folder', 'MinhaEstante');
    await page.selectOption('#opt-folder-layout', 'root-author-title');
    await page.fill('#opt-delay', '0');
    assert.equal(await page.inputValue('#opt-root-folder'), 'MinhaEstante');
    assert.match(await page.textContent('#path-preview-text'), /^Downloads\/MinhaEstante\/Autora E2E\/Crônica E2E\//);
    await page.click('[data-tab="main"]');

    // Trigger EPUB packaging and capture Chromium download event
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.click('#btn-pack-epub');
    const download = await downloadPromise;
    await page.waitForSelector('#export-report:not(.hidden)', { timeout: 15000 });
    assert.match(
      await page.textContent('#log-output'),
      /Arquivo salvo: Downloads\/MinhaEstante\//,
      'Log should reflect the configured custom root folder and organization'
    );

    const epubOutPath = path.join(userDataDir, 'downloaded-e2e.epub');
    await download.saveAs(epubOutPath);
    const epubBytes = fs.readFileSync(epubOutPath);
    assert.ok(epubBytes.length > 500, 'Downloaded EPUB should be non-empty');

    // Verify ZIP/EPUB contents
    const zip = await readZipArchive(epubBytes);
    assert.equal(zip.entries[0].name, 'mimetype');
    assert.equal(zip.entries[0].text(), 'application/epub+zip');
    assert.ok(zip.files.has('OEBPS/text/ch_0001.xhtml'));
    assert.ok(zip.files.has('OEBPS/text/ch_0002.xhtml'));
    assert.match(zip.files.get('OEBPS/text/ch_0001.xhtml').text(), /Primeiro Ato/);
    assert.doesNotMatch(zip.files.get('OEBPS/text/ch_0002.xhtml').text(), /blocked-403\.png/);

    // Verify EPUBCheck on the real browser-generated EPUB if available
    if (resolveEpubCheckRunner()) {
      const checkRes = runEpubCheck(epubOutPath);
      assert.equal(checkRes.ok, true, `E2E EPUB failed EPUBCheck:\n${checkRes.output}`);
      console.log('[OK] E2E downloaded EPUB passed W3C EPUBCheck');
    } else if (process.env.REQUIRE_EPUBCHECK === '1') {
      assert.fail('REQUIRE_EPUBCHECK=1 is set, but EPUBCheck was not found.');
    }

    // Verify UI status, non-grave warning report, log badges, and click-to-log jump
    await page.waitForSelector('#export-report:not(.hidden)', { timeout: 10000 });
    const reportText = await page.textContent('#export-report');
    assert.match(reportText, /Não é grave/i);
    assert.match(reportText, /Avisos leves \(imagens\/capa\): 1/);

    const warnBadge = await page.textContent('#log-warn-badge');
    assert.equal(warnBadge.trim(), '1');
    const errorBadgeHidden = await page.locator('#log-error-badge').evaluate((el) => el.classList.contains('hidden'));
    assert.equal(errorBadgeHidden, true, 'Grave error badge should remain hidden on image-only 403 warning');

    // Report exposes direct clickable links to original chapter & failed image URL
    assert.equal(await page.locator('#export-report a.report-ext-link').count(), 2);

    // Click report link -> opens Logs tab, highlights log line, and renders clickable URLs inside log
    await page.click('#export-report .report-jump-btn');
    await page.waitForSelector('#tab-logs:not(.hidden)');
    const highlighted = await page.locator('#log-output .log-line.log-highlight').count();
    assert.equal(highlighted, 1);
    assert.ok((await page.locator('#log-output .log-line.log-highlight a.log-link').count()) >= 2);

    // 5. Test interactive Merge Open Tabs modal (preview eye, uncheck, separate-books mode)
    const tab1 = await context.newPage();
    await tab1.goto(`http://127.0.0.1:${port}/series/e2e-book/cap-01/`);
    const tab2 = await context.newPage();
    await tab2.goto(`http://127.0.0.1:${port}/series/e2e-book/cap-02/`);
    await page.bringToFront();
    await page.click('[data-tab="main"]');
    await page.click('#btn-merge-tabs');
    await page.waitForSelector('#merge-tabs-modal[open]', { timeout: 10000 });
    assert.equal(await page.locator('#merge-tabs-list .merge-tab-row').count(), 2);

    // Preview first detected tab with eye button inside Merge modal
    await page.click('#merge-tabs-list .merge-tab-row:first-child button[title]');
    await page.waitForSelector('#preview-modal[open]', { timeout: 10000 });
    await page.waitForFunction(
      () => /primeiro capítulo/i.test(document.querySelector('#preview-modal-content')?.textContent || ''),
      null,
      { timeout: 10000 }
    );
    await page.click('#preview-modal .dialog-footer button');
    await page.waitForSelector('#preview-modal:not([open])', { state: 'hidden' });

    // Switch to separate-books mode, uncheck 2nd tab, rename 1st book, and confirm
    await page.selectOption('#merge-organize-mode', 'separate-books');
    await page.fill('#merge-tabs-list .merge-tab-row:first-child input.merge-tab-vol', 'Livro Independente Teste');
    await page.uncheck('#merge-tabs-list .merge-tab-row:nth-child(2) input[type="checkbox"]');
    await page.click('#btn-confirm-merge-tabs');
    await page.waitForSelector('#merge-tabs-modal:not([open])', { state: 'hidden' });
    assert.equal(await page.locator('#chapters-tbody tr').count(), 1);
    assert.equal(
      await page.isChecked('input[name="pack-mode"][value="by-volume"]'),
      true,
      'Separate books mode should activate by-volume pack mode'
    );

    console.log('[OK] E2E extension flow passed end-to-end (load -> parse -> pack EPUB -> report -> jump to log -> merge tabs)');
  } finally {
    if (context) await context.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

runE2E().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
