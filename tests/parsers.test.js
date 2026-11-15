import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installDomGlobals } from './helpers/dom-shim.js';
import { BaseParser, isAntiBotChallengeDocument } from '../src/core/parser-engine.js';
import { ParserRegistry, loadSeriesWithParser, parserRegistry } from '../src/parsers/index.js';
import { wpLightNovelParser } from '../src/parsers/wp-lightnovel.js';
import { madaraThemeParser } from '../src/parsers/madara-theme.js';
import { royalRoadParser } from '../src/parsers/royalroad.js';
import { novelManiaParser } from '../src/parsers/novelmania.js';
import { scribbleHubParser } from '../src/parsers/scribblehub.js';
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
  const rrDoc = new DOMParser().parseFromString(readFixture('royalroad-index.html'), 'text/html');
  const nmDoc = new DOMParser().parseFromString(readFixture('novelmania-index.html'), 'text/html');
  const genericDoc = new DOMParser().parseFromString(readFixture('generic-index-p1.html'), 'text/html');

  assert.equal(parserRegistry.detect(wpDoc, 'https://novel.example.org/').id, 'wp-lightnovel');
  assert.equal(parserRegistry.detect(madaraDoc, 'https://madara.example.org/').id, 'madara-theme');
  assert.equal(parserRegistry.detect(rrDoc, 'https://www.royalroad.com/fiction/99900/clockwork-vanguard').id, 'royalroad');
  assert.equal(parserRegistry.detect(nmDoc, 'https://novelmania.com.br/novels/cronicas-da-nevoa').id, 'novelmania');
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
      create: async () => ({ id: 42, status: 'complete', url: 'https://spa.example.org/book' }),
      get: async () => ({ id: 42, status: 'complete', url: 'https://spa.example.org/book' }),
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

test('Regression snapshot: royalroad index + chapter back-link resolution + hidden watermark stripping', async () => {
  const expected = SNAPSHOTS.royalroad;
  mockFetchRoutes({
    [expected.startingUrl]: readFixture('royalroad-index.html'),
    [expected.chapters[0].url]: readFixture('royalroad-chapter.html')
  });

  // Loading from a chapter URL resolves back to the fiction index page
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

  const parsedCh = await parser.downloadChapter(series.chapters[0]);
  assert.equal(parsedCh.chapterTitle, 'Chapter 1: First Spark');
  assert.equal(parsedCh.subtitle, '');
  assert.equal(parsedCh.images.length, 1);
  assert.equal(parsedCh.images[0].originalUrl, 'https://i.imgur.com/sample01.png');

  const chXhtml = parsedCh.serialize('../styles/stylesheet.css', true);
  assert.match(chXhtml, /Sparks showered across the workshop floor/);
  assert.doesNotMatch(chXhtml, /taken without approval/);
  assert.doesNotMatch(chXhtml, /Author note outside chapter body/);

  // Fallback to DOM table when window.chapters is absent
  const tableOnlyDoc = new DOMParser().parseFromString(`
    <html><body>
      <table id="chapters"><tbody>
        <tr class="chapter-row" data-volume-id="null">
          <td><a href="/fiction/99900/clockwork-vanguard/chapter/1001/ch-1">Chapter 1: Fallback</a></td>
          <td><time datetime="2026-02-01T00:00:00Z">2026-02-01</time></td>
        </tr>
      </tbody></table>
    </body></html>`, 'text/html');
  const fallbackChapters = royalRoadParser.collectChapterNodes(tableOnlyDoc, expected.startingUrl);
  assert.equal(fallbackChapters.length, 1);
  assert.equal(fallbackChapters[0].displayTitle, 'Chapter 1: Fallback');
  assert.equal(fallbackChapters[0].dateText, '2026-02-01');
});

test('Regression snapshot: novelmania index + API pagination + chapter resolution + footnotes & sr-only cleanup', async () => {
  const expected = SNAPSHOTS.novelmania;
  mockFetchRoutes({
    [expected.startingUrl]: readFixture('novelmania-index.html'),
    [expected.chapters[0].url]: readFixture('novelmania-chapter.html')
  });

  // 1. DOM fallback from a chapter URL resolves back to the novel index page
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

  // 2. Chapter extraction strips .sr-only suffix, preserves inline image and intra-chapter footnote anchors
  const parsedCh = await parser.downloadChapter(series.chapters[0]);
  assert.equal(parsedCh.chapterTitle, 'Prólogo: Sinais na Névoa');
  assert.equal(parsedCh.subtitle, '');
  assert.equal(parsedCh.images.length, 1);
  assert.equal(parsedCh.images[0].originalUrl, 'https://us-east-1.linodeobjects.com/novelmania/sample/ilustra-01.jpg');

  const chXhtml = parsedCh.serialize('../styles/stylesheet.css', true);
  assert.doesNotMatch(chXhtml, /Prólogo: Sinais na Névoa – Crônicas da Névoa/);
  assert.match(chXhtml, /<a id="nota1v"(?:\s*\/>|><\/a>)<a href="#nota1">¹<\/a>/);
  assert.match(chXhtml, /<a id="nota1"(?:\s*\/>|><\/a>)<a href="#nota1v">1<\/a>/);
  assert.match(chXhtml, /<h5 class="wpb-center"><strong>Notas:<\/strong><\/h5>/);

  // 3. Multi-page API chapter pagination and original cover enrichment
  mockFetchRoutes({
    [expected.startingUrl]: readFixture('novelmania-index.html'),
    'https://novelmania.com.br/api/novels/cronicas-da-nevoa': JSON.stringify({
      success: true,
      data: {
        title: 'Crônicas da Névoa',
        author: 'L. Vasconcelos',
        status: 'Ativo',
        cover: {
          original: 'https://assets.novelmania.com.br/uploads/novel/cover/99/original_nevoa.jpg',
          large: 'https://assets.novelmania.com.br/uploads/novel/cover/99/hero_nevoa.jpg'
        }
      }
    }),
    'https://novelmania.com.br/api/novels/cronicas-da-nevoa/chapters?page=1&items=50&sort=asc': JSON.stringify({
      success: true,
      meta: { page: 1, limit: 50, pages: 2, count: 3 },
      data: [
        {
          slug: 'volume-1-prologo',
          title: 'Prólogo: Sinais na Névoa',
          publishedAt: '2026-01-10T12:00:00Z',
          unity: { name: 'Volume 1', title: 'O Farol Cinzento' }
        },
        {
          slug: 'volume-1-capitulo-1',
          title: 'Capítulo 1: Primeira Guarda',
          publishedAt: '2026-01-12T12:00:00Z',
          unity: { name: 'Volume 1', title: 'O Farol Cinzento' }
        }
      ]
    }),
    'https://novelmania.com.br/api/novels/cronicas-da-nevoa/chapters?page=2&items=50&sort=asc': JSON.stringify({
      success: true,
      meta: { page: 2, limit: 50, pages: 2, count: 3 },
      data: [
        {
          slug: 'ano-1-volume-2-capitulo-1',
          title: 'Capítulo 1: Além da Muralha',
          publishedAt: '2026-01-20T12:00:00Z',
          unity: { name: 'Ano 1 - Volume 2', title: null }
        }
      ]
    })
  });

  const apiRes = await loadSeriesWithParser(expected.startingUrl);
  assert.equal(apiRes.parser.id, novelManiaParser.id);
  assert.equal(apiRes.series.coverUrl, 'https://assets.novelmania.com.br/uploads/novel/cover/99/original_nevoa.jpg');
  assert.deepEqual(
    apiRes.series.chapters.map((c) => ({ url: c.url, displayTitle: c.displayTitle, volume: c.volume, dateText: c.dateText })),
    [
      { ...expected.chapters[0], dateText: '2026-01-10' },
      { ...expected.chapters[1], dateText: '2026-01-12' },
      { ...expected.chapters[2], dateText: '2026-01-20' }
    ]
  );
});

test('GenericHtmlParser + BaseParser handle modern SSR index & chapter semantics without site-specific adapters', async () => {
  const indexHtml = readFixture('novelmania-index.html');
  const chapterHtml = readFixture('novelmania-chapter.html');
  const mirrorIndexUrl = 'https://mirror-example.invalid/novels/cronicas-da-nevoa';
  const mirrorChapterUrl = 'https://mirror-example.invalid/novels/cronicas-da-nevoa/capitulos/volume-1-prologo';

  mockFetchRoutes({
    [mirrorIndexUrl]: indexHtml,
    [mirrorChapterUrl]: chapterHtml
  });

  const { parser, series } = await loadSeriesWithParser(mirrorIndexUrl, { parserId: 'generic-html' });
  assert.equal(parser.id, 'generic-html');
  assert.equal(series.title, 'Crônicas da Névoa');
  assert.equal(series.author, 'L. Vasconcelos');
  assert.equal(series.status, 'Ativo');
  assert.deepEqual(series.genres, ['Ação', 'Fantasia', 'Sci-fi']);
  assert.match(series.synopsis, /Na fronteira coberta por névoa/);
  assert.equal(series.coverUrl, 'https://assets.novelmania.com.br/uploads/novel/cover/99/hero_nevoa.jpg');
  assert.equal(series.chapters.length, 3);
  assert.deepEqual(
    series.chapters.map((c) => ({ title: c.displayTitle, dateText: c.dateText })),
    [
      { title: 'Prólogo: Sinais na Névoa', dateText: '2026-01-10' },
      { title: 'Capítulo 1: Primeira Guarda', dateText: '2026-01-12' },
      { title: 'Capítulo 1: Além da Muralha', dateText: '2026-01-20' }
    ]
  );

  const chapterData = await genericHtmlParser.downloadChapter(series.chapters[0]);
  assert.equal(chapterData.chapterTitle, 'Prólogo: Sinais na Névoa');
  const chXml = chapterData.serialize('../styles/stylesheet.css', true);
  assert.match(chXml, /Sinal detectado/);
  assert.match(chXml, /O rádio estalou enquanto a neblina avançava/);
});

test('NovelManiaParser matches via DOM signals even if the domain changes', async () => {
  const indexDoc = new DOMParser().parseFromString(readFixture('novelmania-index.html'), 'text/html');
  const chapterDoc = new DOMParser().parseFromString(readFixture('novelmania-chapter.html'), 'text/html');

  assert.ok(
    novelManiaParser.matchScore(indexDoc, 'https://new-domain.example/novels/cronicas-da-nevoa') >=
      genericHtmlParser.matchScore(indexDoc, 'https://new-domain.example/novels/cronicas-da-nevoa')
  );
  assert.ok(
    novelManiaParser.matchScore(chapterDoc, 'https://new-domain.example/novels/cronicas-da-nevoa/capitulos/1') >=
      genericHtmlParser.matchScore(chapterDoc, 'https://new-domain.example/novels/cronicas-da-nevoa/capitulos/1')
  );
});

test('GenericHtmlParser infers ancestor volume headings, applies Innermost Node Wins, and suggests usable CSS selectors', async () => {
  const indexHtml = readFixture('novelmania-index.html');
  const chapterHtml = `
    <html><body>
      <main id="page-shell">
        <div class="outer-wrapper">
          <div class="meta-bar">Author note sidebar banner text with links <a href="/a">A</a><a href="/b">B</a></div>
          <div class="story-prose">
            <p>First long narrative paragraph with commas, pauses, and dialogue inside the inner prose block.</p>
            <p>Second detailed paragraph expanding the world, atmosphere, and tension across the quiet night.</p>
            <p>Third paragraph concluding the scene gracefully cleanly.</p>
            <div class="author-note">Translator chatter to exclude</div>
          </div>
        </div>
      </main>
    </body></html>`;

  const indexDoc = new DOMParser().parseFromString(indexHtml, 'text/html');
  const chapterDoc = new DOMParser().parseFromString(chapterHtml, 'text/html');
  const indexUrl = 'https://mirror-example.invalid/novels/cronicas-da-nevoa';

  // Innermost Node Wins chooses .story-prose rather than .outer-wrapper
  const root = genericHtmlParser.findChapterContentRoot(chapterDoc);
  assert.match(root.className, /\bstory-prose\b/);

  // Heuristic selector scanner generates working selectors for both list and content
  const suggestion = genericHtmlParser.suggestSelectors({ indexDoc, chapterDoc, targetUrl: indexUrl });
  assert.ok(suggestion.listSelector);
  assert.equal(suggestion.listCount, 3);
  assert.equal(suggestion.contentSelector, 'div.story-prose');
  assert.match(suggestion.excludeSelector, /\.author-note/);

  // Feed suggested selectors directly into loadSeriesWithParser + downloadChapter
  mockFetchRoutes({
    [indexUrl]: indexHtml,
    'https://mirror-example.invalid/novels/cronicas-da-nevoa/capitulos/volume-1-prologo': chapterHtml
  });

  const autoNodes = genericHtmlParser.collectChapterNodes(indexDoc, indexUrl);
  assert.deepEqual(
    autoNodes.map((c) => c.volume),
    ['Volume 01', 'Volume 01', 'Volume 02']
  );

  const { series } = await loadSeriesWithParser(indexUrl, {
    parserId: 'generic-html',
    customListSelector: suggestion.listSelector
  });
  assert.equal(series.chapters.length, 3);

  const parsed = await genericHtmlParser.downloadChapter(series.chapters[0], {
    customContentSelector: suggestion.contentSelector,
    customExcludeSelector: suggestion.excludeSelector
  });
  const xml = parsed.serialize('../styles/stylesheet.css', true);
  assert.match(xml, /First long narrative paragraph/);
  assert.doesNotMatch(xml, /Translator chatter to exclude/);
});

test('Regression snapshot: scribblehub index + pagination ordering + chapter resolution + challenge detection', async () => {
  const expected = SNAPSHOTS.scribblehub;
  const page2Url = `${expected.startingUrl}?toc=2`;

  mockFetchRoutes({
    [expected.startingUrl]: readFixture('scribblehub-index-p1.html'),
    [page2Url]: readFixture('scribblehub-index-p2.html'),
    [expected.chapters[0].url]: readFixture('scribblehub-chapter.html')
  });

  // 1. Loading from a chapter URL resolves back to the series page and collects paginated TOC in ascending order
  const { parser, series } = await loadSeriesWithParser(expected.chapters[0].url);
  assert.equal(parser.id, scribbleHubParser.id);
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

  // 2. Chapter extraction deduplicates leading title heading, strips .p-avatar-wrap, separates author notes, keeps inline image
  const parsedCh = await parser.downloadChapter(series.chapters[0]);
  assert.equal(parsedCh.chapterTitle, 'Chapter 1: Ignition');
  assert.equal(parsedCh.subtitle, '');
  assert.equal(parsedCh.images.length, 1);
  assert.equal(parsedCh.images[0].originalUrl, 'https://cdn.scribblehub.com/img/sketch-01.png');

  const chXhtml = parsedCh.serialize('../styles/stylesheet.css', true);
  assert.match(chXhtml, /Static hissed over the shortwave radio/);
  assert.match(chXhtml, /<hr\s*\/>[\s\S]*Thanks for reading the opening chapter!/);
  assert.doesNotMatch(chXhtml, /avatarnew\.png/);
  assert.doesNotMatch(chXhtml, /<h2><b>Chapter 1: Ignition<\/b><\/h2>/);

  // 3. HTTP 403 triggers automatic tab fallback and detects localized anti-bot challenge interstitials
  mockFetchRoutes({
    [expected.startingUrl]: () => new Response('Forbidden', { status: 403 })
  });
  let tabCalls = 0;
  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      query: async () => [],
      create: async ({ url }) => {
        tabCalls += 1;
        return { id: 99, status: 'complete', url };
      },
      get: async () => ({ id: 99, status: 'complete', url: expected.startingUrl }),
      remove: async () => {}
    },
    scripting: {
      executeScript: async ({ func }) => {
        const src = String(func);
        if (src.includes('wi_getreleases_pagination')) {
          return [
            {
              result: {
                ok: true,
                status: 200,
                html: '<ol class="toc_ol"><li class="toc_w" order="1"><a class="toc_a" href="https://www.scribblehub.com/read/88811-ember-protocol/chapter/3001/">Chapter 1: Ignition</a></li></ol>'
              }
            }
          ];
        }
        return [{ result: readFixture('scribblehub-index-p1.html') }];
      }
    }
  };

  const tabSeries = await loadSeriesWithParser(expected.startingUrl, { renderWaitMs: 0 });
  assert.equal(tabSeries.series.requiresTabRender, true);
  assert.ok(tabCalls >= 1);
  assert.equal(tabSeries.series.chapters.length, 1);

  const ptChallengeDoc = new DOMParser().parseFromString(
    '<html><head><title>Um momento…</title></head><body><p>Este site utiliza um serviço de segurança para proteção contra bots maliciosos.</p></body></html>',
    'text/html'
  );
  assert.equal(isAntiBotChallengeDocument(ptChallengeDoc), true);
  const legitimateDoc = new DOMParser().parseFromString(readFixture('scribblehub-chapter.html'), 'text/html');
  assert.equal(isAntiBotChallengeDocument(legitimateDoc), false);
});
