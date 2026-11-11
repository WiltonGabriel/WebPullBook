import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomGlobals } from './helpers/dom-shim.js';
import { BaseParser } from '../src/core/parser-engine.js';
import { ParserRegistry, loadSeriesWithParser, parserRegistry } from '../src/parsers/index.js';
import { wpLightNovelParser } from '../src/parsers/wp-lightnovel.js';
import { madaraThemeParser } from '../src/parsers/madara-theme.js';
import { genericHtmlParser } from '../src/parsers/generic-html.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');
const SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'snapshots.json'), 'utf8'));

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

function mockFetchRoutes(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const key = String(url);
    calls.push(key);
    const handler = routes[key];
    if (!handler) {
      return new Response('Not Found', { status: 404 });
    }
    const res = typeof handler === 'function' ? handler(calls.filter((u) => u === key).length) : handler;
    if (typeof res === 'string') {
      return new Response(res, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(res.body || '', {
      status: res.status || 200,
      headers: res.headers || { 'content-type': 'text/html; charset=utf-8' }
    });
  };
  return calls;
}

let restoreDom;
let origFetch;
let origChrome;

beforeEach(() => {
  restoreDom = installDomGlobals();
  origFetch = globalThis.fetch;
  origChrome = globalThis.chrome;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  globalThis.chrome = origChrome;
  restoreDom();
});

test('ParserRegistry ranks specialized adapters above generic fallback and honors forcedId', () => {
  const wpDoc = new DOMParser().parseFromString(readFixture('wp-lightnovel-index.html'), 'text/html');
  const madaraDoc = new DOMParser().parseFromString(readFixture('madara-index.html'), 'text/html');
  const genericDoc = new DOMParser().parseFromString(readFixture('generic-index-p1.html'), 'text/html');

  assert.equal(parserRegistry.detect(wpDoc, 'https://novel.example.org/').id, 'wp-lightnovel');
  assert.equal(parserRegistry.detect(madaraDoc, 'https://madara.example.org/').id, 'madara-theme');
  assert.equal(parserRegistry.detect(genericDoc, 'https://blog.example.org/').id, 'generic-html');

  // Explicit forcedId overrides DOM score
  assert.equal(parserRegistry.detect(wpDoc, 'https://novel.example.org/', 'generic-html').id, 'generic-html');

  // Custom parser registration
  class CustomTestParser extends BaseParser {
    matchScore(doc) {
      return doc.querySelector('.custom-novel') ? 95 : 0;
    }
  }
  const customReg = new ParserRegistry([wpLightNovelParser, genericHtmlParser]);
  customReg.register(new CustomTestParser({ id: 'custom-test', name: 'Custom' }));
  const customDoc = new DOMParser().parseFromString('<div class="custom-novel"></div>', 'text/html');
  assert.equal(customReg.detect(customDoc, 'https://example.org').id, 'custom-test');
});

test('Regression snapshot: wp-lightnovel index + chapter breadcrumb resolution + chapter extraction', async () => {
  const expected = SNAPSHOTS['wp-lightnovel'];
  mockFetchRoutes({
    [expected.startingUrl]: readFixture('wp-lightnovel-index.html'),
    [expected.chapters[0].url]: readFixture('wp-lightnovel-chapter.html')
  });

  // Loading from a chapter URL resolves back to the series index via .ts-breadcrumb
  const { parser, series } = await loadSeriesWithParser(expected.chapters[0].url);
  assert.equal(parser.id, expected.parserId);
  assert.equal(series.startingUrl, expected.startingUrl);
  assert.equal(series.title, expected.title);
  assert.equal(series.author, expected.author);
  assert.equal(series.language, expected.language);
  assert.equal(series.status, expected.status);
  assert.deepEqual(series.genres, expected.genres);
  assert.equal(series.coverUrl, expected.coverUrl);
  assert.equal(series.synopsis, expected.synopsis);
  assert.deepEqual(
    series.chapters.map((c) => ({ url: c.url, displayTitle: c.displayTitle, volume: c.volume })),
    expected.chapters
  );

  // Extract chapter 1 content, ensuring ad block & nav links are stripped and lazy image URL resolved
  const parsedCh = await parser.downloadChapter(series.chapters[0]);
  assert.equal(parsedCh.chapterTitle, 'Capítulo 1 — O Primeiro Sinal');
  assert.equal(parsedCh.subtitle, 'O Primeiro Sinal');
  assert.equal(parsedCh.images.length, 1);
  assert.equal(parsedCh.images[0].originalUrl, 'https://novel.example.org/uploads/sigilo-01.png');
  const chXhtml = parsedCh.serialize('../styles/stylesheet.css', true);
  assert.doesNotMatch(chXhtml, /Publicidade removível/);
  assert.doesNotMatch(chXhtml, /Próximo Capítulo/);
  assert.match(chXhtml, /Arlan/);
});

test('Regression snapshot: madara-theme index + chapter breadcrumb resolution + chapter extraction', async () => {
  const expected = SNAPSHOTS['madara-theme'];
  mockFetchRoutes({
    [expected.startingUrl]: readFixture('madara-index.html'),
    [expected.chapters[0].url]: readFixture('madara-chapter.html')
  });

  const { parser, series } = await loadSeriesWithParser(expected.chapters[0].url);
  assert.equal(parser.id, expected.parserId);
  assert.equal(series.startingUrl, expected.startingUrl);
  assert.equal(series.title, expected.title);
  assert.equal(series.author, expected.author);
  assert.equal(series.language, expected.language);
  assert.deepEqual(series.genres, expected.genres);
  assert.equal(series.coverUrl, expected.coverUrl);
  assert.equal(series.synopsis, expected.synopsis);
  assert.deepEqual(
    series.chapters.map((c) => ({ url: c.url, displayTitle: c.displayTitle, volume: c.volume })),
    expected.chapters
  );

  const parsedCh = await parser.downloadChapter(series.chapters[0]);
  const chXhtml = parsedCh.serialize('../styles/stylesheet.css', true);
  assert.match(chXhtml, /Never follow the compass after midnight/);
});

test('Regression snapshot: generic-html multi-page pagination + Readability prose extraction', async () => {
  const expected = SNAPSHOTS['generic-html'];
  mockFetchRoutes({
    [expected.startingUrl]: readFixture('generic-index-p1.html'),
    'https://blog.example.org/observatory/page-2': readFixture('generic-index-p2.html'),
    [expected.chapters[0].url]: readFixture('generic-chapter.html')
  });

  const { parser, series } = await loadSeriesWithParser(expected.startingUrl);
  assert.equal(parser.id, expected.parserId);
  assert.equal(series.title, expected.title);
  assert.equal(series.author, expected.author);
  assert.equal(series.language, expected.language);
  assert.equal(series.synopsis, expected.synopsis);
  assert.deepEqual(
    series.chapters.map((c) => ({ url: c.url, displayTitle: c.displayTitle, volume: c.volume })),
    expected.chapters
  );

  const parsedCh = await parser.downloadChapter(series.chapters[0]);
  const chXhtml = parsedCh.serialize('../styles/stylesheet.css', true);
  assert.match(chXhtml, /barometer dropped three millibars/);
  assert.doesNotMatch(chXhtml, /Next Chapter/);
});

test('BaseParser supports custom CSS selectors, JSON-LD @graph, retries, rate-limit flag, and SPA tab fallback', async () => {
  // 1. Custom CSS selectors override automatic list/content/exclude extraction
  mockFetchRoutes({
    'https://custom.example.org/book': `
      <html><body>
        <h1>Custom Book</h1>
        <div class="my-list"><a href="/c/1">Ch 1</a><a href="/c/2">Ch 2</a></div>
      </body></html>`,
    'https://custom.example.org/c/1': `
      <html><body>
        <div class="custom-body"><p>Real story.</p><p class="junk">Drop me</p></div>
      </body></html>`
  });

  const { series } = await loadSeriesWithParser('https://custom.example.org/book', {
    parserId: 'generic-html',
    customListSelector: '.my-list a'
  });
  assert.equal(series.chapters.length, 2);

  const ch = await genericHtmlParser.downloadChapter(series.chapters[0], {
    customContentSelector: '.custom-body',
    customExcludeSelector: '.junk'
  });
  const chXml = ch.serialize('../styles/stylesheet.css', true);
  assert.match(chXml, /Real story/);
  assert.doesNotMatch(chXml, /Drop me/);

  // 2. JSON-LD @graph extraction + resilient handling of malformed JSON-LD
  const jsonLdDoc = new DOMParser().parseFromString(`
    <html><head>
      <script type="application/ld+json">{bad json</script>
      <script type="application/ld+json">
        {"@graph":[{"@type":"Novel","name":"Graph Book","author":[{"name":"A1"},{"name":"A2"}],"description":"Desc","image":{"url":"https://custom.example.org/c.jpg"}}]}
      </script>
    </head><body></body></html>`, 'text/html');
  const meta = genericHtmlParser.extractJsonLdMetadata(jsonLdDoc);
  assert.equal(meta.title, 'Graph Book');
  assert.equal(meta.author, 'A1, A2');
  assert.equal(meta.coverUrl, 'https://custom.example.org/c.jpg');

  // 3. Rate-limit detection (HTTP 429 / Wordfence 503) does not retry and flags err.isRateLimit
  const calls = mockFetchRoutes({
    'https://limit.example.org/ch': {
      status: 503,
      body: 'Wordfence: Your access to this site has been temporarily limited.'
    }
  });
  await assert.rejects(
    () => genericHtmlParser.downloadChapter({ url: 'https://limit.example.org/ch', displayTitle: 'Ch' }),
    (err) => err.isRateLimit === true && err.status === 503
  );
  assert.equal(calls.length, 1);

  // 4. Retry succeeds after transient 500
  const retryCalls = mockFetchRoutes({
    'https://flaky.example.org/ch': (attempt) =>
      attempt === 1
        ? { status: 500, body: 'Server Error' }
        : '<html><body><article><p>Recovered text content on second attempt with enough length.</p></article></body></html>'
  });
  const recovered = await genericHtmlParser.downloadChapter(
    { url: 'https://flaky.example.org/ch', displayTitle: 'Flaky' },
    { autoFallbackTab: false }
  );
  assert.equal(retryCalls.length, 2);
  assert.match(recovered.serialize('../styles/stylesheet.css', true), /Recovered text content/);

  // 5. Missing content root throws err.isNoContent
  mockFetchRoutes({
    'https://empty.example.org/ch': '<html><body><div>hi</div></body></html>'
  });
  await assert.rejects(
    () => genericHtmlParser.downloadChapter({ url: 'https://empty.example.org/ch', displayTitle: 'Empty' }, { autoFallbackTab: false }),
    (err) => err.isNoContent === true
  );

  // 6. Automatic SPA tab fallback via chrome.tabs + chrome.scripting
  mockFetchRoutes({
    'https://spa.example.org/book': '<html><body><div id="app">Loading...</div></body></html>'
  });
  let removedTabId = null;
  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      create: async () => ({ id: 42, status: 'complete' }),
      get: async () => ({ id: 42, status: 'complete' }),
      remove: async (id) => {
        removedTabId = id;
      }
    },
    scripting: {
      executeScript: async () => [
        {
          result: '<html><body><h1>SPA Novel</h1><div class="chapter-list"><a href="/ch/1">Chapter 1</a><a href="/ch/2">Chapter 2</a></div></body></html>'
        }
      ]
    }
  };
  const spaRes = await loadSeriesWithParser('https://spa.example.org/book', { renderWaitMs: 0 });
  assert.equal(spaRes.series.title, 'SPA Novel');
  assert.equal(spaRes.series.chapters.length, 2);
  assert.equal(removedTabId, 42);
});
