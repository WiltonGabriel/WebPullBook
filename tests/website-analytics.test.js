import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGoatCounterConfig, syncGoatCounterScript } from '../scripts/sync-website.mjs';

const EN_HEAD = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <script src="assets/js/site.js" defer></script>',
  '</head>',
  '<body></body>',
  '</html>'
].join('\n');

const PT_HEAD = [
  '<!DOCTYPE html>',
  '<html lang="pt-BR">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <script src="../assets/js/site.js" defer></script>',
  '</head>',
  '<body></body>',
  '</html>'
].join('\n');

test('syncGoatCounterScript omits script tag and removes stale tags when endpoint is empty', () => {
  const config = normalizeGoatCounterConfig({
    provider: 'goatcounter',
    endpoint: '',
    scriptSrc: 'https://gc.zgo.at/count.js'
  });
  assert.equal(config.enabled, false);

  const clean = syncGoatCounterScript(EN_HEAD, config);
  assert.equal(clean, EN_HEAD);
  assert.equal(clean.includes('data-goatcounter'), false);

  const stale = EN_HEAD.replace(
    '  <script src="assets/js/site.js" defer></script>',
    '  <script src="assets/js/site.js" defer></script>\n  <script data-goatcounter="https://stale.example/count" async src="https://gc.zgo.at/count.js"></script>'
  );
  const stripped = syncGoatCounterScript(stale, config);
  assert.equal(stripped, EN_HEAD);
});

test('syncGoatCounterScript injects official GoatCounter tag once after site.js for EN and PT pages', () => {
  const config = normalizeGoatCounterConfig({
    provider: 'goatcounter',
    endpoint: 'https://wiltongabriel.goatcounter.com/count',
    scriptSrc: 'https://gc.zgo.at/count.js'
  });
  assert.equal(config.enabled, true);

  const expectedTag = '  <script data-goatcounter="https://wiltongabriel.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>';

  const enSynced = syncGoatCounterScript(EN_HEAD, config);
  assert.equal(
    enSynced.includes(`  <script src="assets/js/site.js" defer></script>\n${expectedTag}`),
    true
  );
  assert.equal(enSynced.match(/data-goatcounter=/g)?.length, 1);

  const ptSynced = syncGoatCounterScript(PT_HEAD, config);
  assert.equal(
    ptSynced.includes(`  <script src="../assets/js/site.js" defer></script>\n${expectedTag}`),
    true
  );
  assert.equal(ptSynced.match(/data-goatcounter=/g)?.length, 1);
});

test('syncGoatCounterScript is idempotent, deduplicates repeated tags, and updates changed endpoints cleanly', () => {
  const initialConfig = normalizeGoatCounterConfig({
    provider: 'goatcounter',
    endpoint: 'https://wiltongabriel.goatcounter.com/count',
    scriptSrc: 'https://gc.zgo.at/count.js'
  });

  const once = syncGoatCounterScript(EN_HEAD, initialConfig);
  const twice = syncGoatCounterScript(once, initialConfig);
  assert.equal(twice, once);

  const duplicated = `${once.replace(
    '  <script src="assets/js/site.js" defer></script>',
    '  <script src="assets/js/site.js" defer></script>\n  <script data-goatcounter="https://old.example/count" async src="https://gc.zgo.at/count.js"></script>'
  )}`;
  const deduped = syncGoatCounterScript(duplicated, initialConfig);
  assert.equal(deduped, once);
  assert.equal(deduped.match(/data-goatcounter=/g)?.length, 1);

  const updatedConfig = normalizeGoatCounterConfig({
    provider: 'goatcounter',
    endpoint: 'https://stats.example.org/count',
    scriptSrc: 'https://stats.example.org/count.js'
  });
  const replaced = syncGoatCounterScript(once, updatedConfig);
  const expectedReplaced = EN_HEAD.replace(
    '  <script src="assets/js/site.js" defer></script>',
    '  <script src="assets/js/site.js" defer></script>\n  <script data-goatcounter="https://stats.example.org/count" async src="https://stats.example.org/count.js"></script>'
  );
  assert.equal(replaced.match(/data-goatcounter=/g)?.length, 1);
  assert.equal(replaced, expectedReplaced);
  const endpointMatch = replaced.match(/data-goatcounter="([^"]+)"/);
  assert.ok(endpointMatch);
  assert.equal(new URL(endpointMatch[1]).hostname, 'stats.example.org');
});
