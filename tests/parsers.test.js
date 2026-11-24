import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-shim.js';
import {
  SNAPSHOTS,
  assertParserSnapshot,
  mockFetchRoutes,
  readFixture
} from './helpers/parser-snapshot.js';
import {
  BaseParser,
  isAntiBotChallengeDocument
} from '../src/core/parser-engine.js';
import {
  ParserRegistry,
  loadSeriesWithParser,
  looksLikeSpaShell,
  parserRegistry,
  resolveParserForChapterUrl
} from '../src/parsers/index.js';
import { wpLightNovelParser } from '../src/parsers/wp-lightnovel.js';
import { royalRoadParser } from '../src/parsers/royalroad.js';
import { novelManiaParser } from '../src/parsers/novelmania.js';
import { scribbleHubParser } from '../src/parsers/scribblehub.js';
import { novelBinParser } from '../src/parsers/novelbin.js';
import { genericHtmlParser } from '../src/parsers/generic-html.js';

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
  const nbDoc = new DOMParser().parseFromString(readFixture('novelbin-index.html'), 'text/html');
  const genericDoc = new DOMParser().parseFromString(readFixture('generic-index-p1.html'), 'text/html');

  assert.equal(parserRegistry.detect(wpDoc, 'https://novel.example.org/').id, 'wp-lightnovel');
  assert.equal(parserRegistry.detect(madaraDoc, 'https://madara.example.org/').id, 'madara-theme');
  assert.equal(parserRegistry.detect(rrDoc, 'https://www.royalroad.com/fiction/99900/clockwork-vanguard').id, 'royalroad');
  assert.equal(parserRegistry.detect(nmDoc, 'https://novelmania.com.br/novels/cronicas-da-nevoa').id, 'novelmania');
  assert.equal(parserRegistry.detect(nbDoc, 'https://novelbin.example.org/novel/glass-spire').id, 'novelbin');
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
  assertParserSnapshot(expected, { parser, series });

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
  assertParserSnapshot(expected, { parser, series });

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
  assertParserSnapshot(expected, { parser, series });

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
  assertParserSnapshot(expected, { parser, series });

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
  assertParserSnapshot(expected, { parser, series });

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
  assertParserSnapshot(expected, { parser, series });

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

test('Universal Smart Extractor crawls sequential Next Chapter links and beats weak accidental ties', async () => {
  // Weak accidental .spe span without .eplister or .epcontent must not hijack generic extractor
  const genericPageDoc = new DOMParser().parseFromString(
    '<html><body><div class="spe"><span>Status: Ongoing</span></div><main><h1>Serial</h1><ul><li><a href="https://blog.example.org/p1">Cap 1</a></li><li><a href="https://blog.example.org/p2">Cap 2</a></li></ul></main></body></html>',
    'text/html'
  );
  const picked = parserRegistry.detect(genericPageDoc, 'https://blog.example.org/serial');
  assert.equal(picked.id, 'generic-html');
  assert.equal(picked.name, 'Universal Smart Extractor');

  const ch1 = `<html><head><title>Chapter 1</title></head><body><main><h1>Chapter 1: Dawn</h1><article><p>${'A quiet morning breeze drifted over the valley as the caravan prepared to depart before noon. '.repeat(4)}</p></article><div class="chapter-nav"><a href="/ch/2">Próximo Capítulo</a></div></main></body></html>`;
  const ch2 = `<html><head><title>Chapter 2</title></head><body><main><h1>Chapter 2: Road</h1><article><p>${'The stone highway climbed steadily toward the northern ridge while lanterns swayed in the dusk. '.repeat(4)}</p></article><div class="chapter-nav"><a href="/ch/3" rel="next">Next Chapter</a></div></main></body></html>`;
  const ch3 = `<html><head><title>Chapter 3</title></head><body><main><h1>Chapter 3: Gate</h1><article><p>${'Beyond the iron gate lay the sunken library, silent for centuries beneath the roots. '.repeat(4)}</p></article><div class="chapter-nav"><a href="/ch/2">Anterior</a></div></main></body></html>`;

  mockFetchRoutes({
    'https://serial.example.org/ch/1': ch1,
    'https://serial.example.org/ch/2': ch2,
    'https://serial.example.org/ch/3': ch3
  });

  const { parser, series } = await loadSeriesWithParser('https://serial.example.org/ch/1');
  assert.equal(parser.id, 'generic-html');
  assert.equal(series.chapters.length, 3);
  assert.deepEqual(
    series.chapters.map((c) => [c.url, c.displayTitle]),
    [
      ['https://serial.example.org/ch/1', 'Chapter 1: Dawn'],
      ['https://serial.example.org/ch/2', 'Chapter 2: Road'],
      ['https://serial.example.org/ch/3', 'Chapter 3: Gate']
    ]
  );

  // customStripPatterns removes literal banners and /regex/ watermarks without harming prose
  const noisyChapterHtml =
    '<html><body><article><h1>Chapter 1</h1><p>Traduzido por Equipe Exemplo</p><p>Texto real do capítulo. [Nota do Tradutor: teste]</p></article></body></html>';
  mockFetchRoutes({ 'https://serial.example.org/noisy-1': noisyChapterHtml });
  const parsedNoisy = await genericHtmlParser.downloadChapter(
    { url: 'https://serial.example.org/noisy-1', displayTitle: 'Chapter 1' },
    { customStripPatterns: 'Traduzido por Equipe Exemplo\n/\\[Nota do Tradutor:.*?\\]/gi' }
  );
  const textOut = parsedNoisy.nodes.map((n) => n.textContent).join(' ').trim();
  assert.equal(parsedNoisy.chapterTitle, 'Chapter 1');
  assert.equal(textOut, 'Texto real do capítulo.');
});

test('WP ascending chapter lists stay ascending and standalone articles become 1-chapter books', async () => {
  const ascWpHtml = `<html><body><div class="infox"><h1 class="entry-title">Ascending WP</h1></div>
    <div class="ts-chl-collapsible">Volume 01</div>
    <div class="ts-chl-collapsible-content"><div class="eplister"><ul>
      <li><a href="https://wp.example.org/c1"><div class="epl-num">Cap. 1</div><div class="epl-title">One</div></a></li>
      <li><a href="https://wp.example.org/c2"><div class="epl-num">Cap. 2</div><div class="epl-title">Two</div></a></li>
    </ul></div></div>
    <div class="ts-chl-collapsible">Volume 02</div>
    <div class="ts-chl-collapsible-content"><div class="eplister"><ul>
      <li><a href="https://wp.example.org/c3"><div class="epl-num">Cap. 3</div><div class="epl-title">Three</div></a></li>
    </ul></div></div></body></html>`;
  mockFetchRoutes({ 'https://wp.example.org/series': ascWpHtml });
  const { series: wpSeries } = await loadSeriesWithParser('https://wp.example.org/series');
  assert.deepEqual(
    wpSeries.chapters.map((c) => c.titleText),
    ['One', 'Two', 'Three']
  );

  const singleArticleHtml = `<html><head><title>Ensaio Único</title></head><body><main><h1>Ensaio Único</h1><article>
    <p>${'Um texto autônomo longo o bastante para ser convertido diretamente em um livro de capítulo único. '.repeat(3)}</p>
  </article></main></body></html>`;
  mockFetchRoutes({ 'https://essay.example.org/post': singleArticleHtml });
  const { series: essaySeries } = await loadSeriesWithParser('https://essay.example.org/post');
  assert.equal(essaySeries.chapters.length, 1);
  assert.equal(essaySeries.chapters[0].displayTitle, 'Ensaio Único');
});

test('looksLikeSpaShell does not flag normal SSR WordPress pages with noscript or empty widget mounts', () => {
  const ssrDoc = new DOMParser().parseFromString(
    `<html><head><title>Central Novel — Obra Teste</title></head><body>
      <noscript>Por favor, ative o JavaScript para comentários.</noscript>
      <div id="app"></div>
      <h1 class="entry-title">Crônica SSR</h1>
      <div class="eplister"><ul>
        <li><a href="https://centralnovel.example.org/cap-1/"><div class="epl-num">Cap. 1</div></a></li>
        <li><a href="https://centralnovel.example.org/cap-2/"><div class="epl-num">Cap. 2</div></a></li>
      </ul></div>
      <script src="/wp-includes/app.js"></script>
    </body></html>`,
    'text/html'
  );
  assert.equal(looksLikeSpaShell(ssrDoc), false);

  const spaDoc = new DOMParser().parseFromString(
    `<html><head><title>App</title></head><body>
      <div id="root"></div>
      <noscript>Please enable JavaScript to continue.</noscript>
      <script type="module" src="/assets/main.js"></script>
    </body></html>`,
    'text/html'
  );
  assert.equal(looksLikeSpaShell(spaDoc), true);
});

test('WP novel chapter/index with noscript and rel=next loads statically with zero tab opens and no loops', async () => {
  const indexUrl = 'https://centralnovel.example.org/series/cr-teste/';
  const ch1Url = 'https://centralnovel.example.org/cr-teste-cap-1/';
  const ch2Url = 'https://centralnovel.example.org/cr-teste-cap-2/';

  const ch1Html = `<html><head>
    <link rel="next" href="${ch2Url}">
    <title>Cap 1</title>
  </head><body>
    <noscript>Ative o JavaScript para melhor experiência.</noscript>
    <div id="root"></div>
    <div class="ts-breadcrumb"><a href="https://centralnovel.example.org/">Home</a> &gt; <a href="${indexUrl}">Crônica Teste</a></div>
    <h1 class="entry-title">Capítulo 1</h1>
    <div class="epcontent"><p>Texto normal do primeiro capítulo em um site SSR WordPress.</p></div>
  </body></html>`;

  const indexHtml = `<html><head><title>Crônica Teste</title></head><body>
    <noscript>Enable JavaScript to view comments.</noscript>
    <h1 class="entry-title">Crônica Teste</h1>
    <div class="eplister"><ul>
      <li><a href="${ch2Url}"><div class="epl-num">Cap. 2</div><div class="epl-title">Dois</div></a></li>
      <li><a href="${ch1Url}"><div class="epl-num">Cap. 1</div><div class="epl-title">Um</div></a></li>
    </ul></div>
  </body></html>`;

  const calls = mockFetchRoutes({
    [ch1Url]: ch1Html,
    [indexUrl]: indexHtml
  });

  let createdTabs = 0;
  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      query: async () => [],
      create: async ({ url }) => {
        createdTabs += 1;
        return { id: 10, status: 'complete', url };
      },
      get: async () => ({ id: 10, status: 'complete', url: ch1Url }),
      remove: async () => {}
    },
    scripting: { executeScript: async () => [{ result: '' }] }
  };

  const { parser, series, usedAutoSpa } = await loadSeriesWithParser(ch1Url, { renderWaitMs: 0 });
  assert.equal(parser.id, wpLightNovelParser.id);
  assert.equal(series.startingUrl, indexUrl);
  assert.equal(series.chapters.length, 2);
  assert.equal(series.requiresTabRender, false);
  assert.equal(usedAutoSpa, false);
  assert.equal(createdTabs, 0, 'Normal SSR WordPress site must never open background tabs');
  assert.ok(!calls.some((u) => u === ch2Url), 'Must not crawl chapter rel=next link during index loading');
});

test('ScribbleHub direct chapter URL resolves matching series ID without opening tab loops', async () => {
  const chUrl = 'https://www.scribblehub.com/read/88811-ember-protocol/chapter/3001/';
  const seriesUrl = 'https://www.scribblehub.com/series/88811/ember-protocol/';

  const chWithNoiseHtml = `<html><head><title>Chapter 1</title></head><body>
    <header>
      <a href="https://www.scribblehub.com/series-finder/">Series Finder</a>
      <a href="https://www.scribblehub.com/series/99999/unrelated-book/">Unrelated</a>
    </header>
    <div class="wi_breadcrumb">
      <a href="https://www.scribblehub.com/">Home</a>
      <a href="${seriesUrl}">Ember Protocol</a>
    </div>
    <div id="chp_raw"><p>Chapter prose body.</p></div>
  </body></html>`;

  // Series page with hash pagination link & failed AJAX to verify no tab loop occurs
  const seriesCyclicHtml = `<html><head><title>Ember Protocol</title></head><body>
    <div class="fic_title">Ember Protocol</div>
    <input type="hidden" id="mypostid" value="88811" />
    <ol class="toc_ol">
      <li class="toc_w" order="2"><a class="toc_a" href="https://www.scribblehub.com/read/88811-ember-protocol/chapter/3002/">Ch 2</a></li>
      <li class="toc_w" order="1"><a class="toc_a" href="${chUrl}">Ch 1</a></li>
    </ol>
    <ul id="pagination-mesh-toc">
      <li><a class="page-link next" href="#page-2">Next</a></li>
    </ul>
  </body></html>`;

  mockFetchRoutes({
    [chUrl]: () => new Response('Forbidden', { status: 403 }),
    [seriesUrl]: () => new Response('Forbidden', { status: 403 }),
    'https://www.scribblehub.com/wp-admin/admin-ajax.php': () => new Response('Forbidden', { status: 403 })
  });

  const createdUrls = [];
  globalThis.chrome = {
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      // Simulate user already having the chapter tab open!
      query: async () => [{ id: 77, status: 'complete', url: chUrl }],
      create: async ({ url }) => {
        createdUrls.push(url);
        return { id: 78 + createdUrls.length, status: 'complete', url };
      },
      get: async (id) => ({ id, status: 'complete', url: seriesUrl }),
      remove: async () => {}
    },
    scripting: {
      executeScript: async ({ target, func }) => {
        const src = String(func);
        if (src.includes('wi_getreleases_pagination')) {
          return [{ result: { ok: false, status: 403, html: '' } }];
        }
        if (target.tabId === 77) {
          return [{ result: chWithNoiseHtml }];
        }
        return [{ result: seriesCyclicHtml }];
      }
    }
  };

  const { parser, series } = await loadSeriesWithParser(chUrl, { renderWaitMs: 0 });
  assert.equal(parser.id, scribbleHubParser.id);
  assert.equal(series.startingUrl, seriesUrl);
  assert.equal(series.chapters.length, 2);
  assert.ok(
    !createdUrls.some((u) => u.includes('series-finder') || u.includes('99999')),
    'Must ignore unrelated /series/ links'
  );
  assert.ok(createdUrls.length <= 2, `Expected bounded tab creation, got ${createdUrls.length}: ${createdUrls.join(', ')}`);
});

test('BaseParser.collectAllChapters stops immediately on zero-new-chapter pages instead of looping', async () => {
  const p1 = 'https://loop.example.org/p1';
  const p2 = 'https://loop.example.org/p2';
  const p3 = 'https://loop.example.org/p3';
  const calls = mockFetchRoutes({
    [p1]: `<html><body><div class="list"><a href="/c1">Cap 1</a></div><a rel="next" href="${p2}">Next</a></body></html>`,
    [p2]: `<html><body><div class="list"><a href="/c1">Cap 1</a></div><a rel="next" href="${p3}">Next</a></body></html>`,
    [p3]: `<html><body><div class="list"><a href="/c2">Cap 2</a></div></body></html>`
  });

  class DummyPaginatedParser extends BaseParser {
    constructor() {
      super({ id: 'dummy-pag', name: 'Dummy', maxIndexPages: 20 });
    }
    collectChapterNodes(doc, url) {
      return Array.from(doc.querySelectorAll('.list a')).map((a) => ({
        url: new URL(a.getAttribute('href'), url).toString(),
        displayTitle: a.textContent.trim(),
        volume: 'Volume 01',
        included: true
      }));
    }
  }

  const p = new DummyPaginatedParser();
  const series = await p.loadSeries(p1);
  assert.equal(series.chapters.length, 1);
  assert.ok(!calls.some((u) => u === p3), 'Pagination must stop as soon as p2 adds 0 new chapters');
});

test('GenericHtmlParser fixes all 6 weaknesses: <br> prose, TOC vs chapter detection, TOC link resolution, innermost list, and ascending sort', async () => {
  // 1. <br>-based chapter without <p> tags
  const brDoc = new DOMParser().parseFromString(
    `<html><body>
      <div class="wrapper">
        <div id="chapter-body" class="chapter-text">
          Primeira linha da história com bastante texto narrativo.<br><br>
          Segunda linha com diálogos, pausas e desenvolvimento de cena.<br><br>
          Terceira linha continuando o enredo sem nenhuma tag de parágrafo.<br><br>
          Quarta linha encerrando a cena dramática com sucesso!
        </div>
      </div>
    </body></html>`,
    'text/html'
  );
  const foundRoot = genericHtmlParser.findChapterContentRoot(brDoc);
  assert.equal(foundRoot?.id, 'chapter-body', 'Must detect <br>-separated prose container without <p> tags');

  // 2. Chapter page with long prose + recent chapters list resolves explicit TOC link instead of mistaking sidebar for TOC
  const chUrl = 'https://indie.example.org/story/ch-1';
  const tocUrl = 'https://indie.example.org/story/index';
  const longProse = '<p>Este é um parágrafo longo de narrativa contínua no capítulo atual, cheio de detalhes e diálogos para caracterizar claramente uma página de leitura.</p>'.repeat(12);
  const chapterHtml = `<html><body>
    <main>
      <h1>Capítulo 1</h1>
      <article class="story-prose">${longProse}</article>
      <div class="controls"><a href="${tocUrl}">Índice</a> | <a href="/story/ch-2">Próximo Capítulo</a></div>
      <div class="recent-box">
        <a href="/story/ch-98">Capítulo 98</a>
        <a href="/story/ch-99">Capítulo 99</a>
        <a href="/story/ch-100">Capítulo 100</a>
      </div>
    </main>
  </body></html>`;
  // 3. TOC page with outer wrapper + tighter inner <ul> in descending order (Cap 3 -> Cap 1)
  const tocHtml = `<html><body>
    <main>
      <h1>Minha Obra</h1>
      <section class="book-box">
        <p>Sinopse breve.</p>
        <ul class="cap-list">
          <li><a href="/story/ch-3">Capítulo 3</a></li>
          <li><a href="/story/ch-2">Capítulo 2</a></li>
          <li><a href="/story/ch-1">Capítulo 1</a></li>
        </ul>
      </section>
    </main>
  </body></html>`;

  mockFetchRoutes({
    [chUrl]: chapterHtml,
    [tocUrl]: tocHtml
  });

  const { series } = await loadSeriesWithParser(chUrl, { parserId: 'generic-html' });
  assert.equal(series.startingUrl, tocUrl, 'Must resolve explicit TOC link from chapter page');
  assert.deepEqual(
    series.chapters.map((c) => c.displayTitle),
    ['Capítulo 1', 'Capítulo 2', 'Capítulo 3'],
    'Must sort descending generic chapter list into ascending order'
  );

  // Innermost list wins for selector suggestion
  const tocDoc = new DOMParser().parseFromString(tocHtml, 'text/html');
  const sug = genericHtmlParser.suggestSelectors({ indexDoc: tocDoc, targetUrl: tocUrl });
  assert.match(sug.listSelector, /ul\.cap-list/);
});

test('resolveParserForChapterUrl selects host-appropriate parser for multi-domain chapters', () => {
  const rr = resolveParserForChapterUrl(
    'https://www.royalroad.com/fiction/12345/demo/chapter/99/ch-1',
    genericHtmlParser,
    'auto',
    'https://hub.example.org/toc'
  );
  assert.equal(rr.id, royalRoadParser.id);

  const sh = resolveParserForChapterUrl(
    'https://www.scribblehub.com/read/12345-demo/chapter/99/',
    genericHtmlParser,
    'auto',
    'https://hub.example.org/toc'
  );
  assert.equal(sh.id, scribbleHubParser.id);

  const otherHost = resolveParserForChapterUrl(
    'https://translator-b.example.net/cap-2',
    royalRoadParser,
    'auto',
    'https://www.royalroad.com/fiction/12345/demo'
  );
  assert.equal(otherHost.id, genericHtmlParser.id);
});

test('BaseParser falls back to native adapter when stale customListSelector returns 0 chapters and retries HTTP if sourceTab DOM is empty', async () => {
  const seriesUrl = 'https://centralnovel.example.org/series/devourer/';
  const fullHtml = `<html><head><title>Devourer</title></head><body>
    <h1 class="entry-title">Devourer</h1>
    <div class="spe"><span>Autor: CypherTails</span></div>
    <span class="ts-chl-collapsible">Capítulos</span>
    <div class="ts-chl-collapsible-content"><div class="eplister"><ul>
      <li><a href="https://centralnovel.example.org/devourer-cap-2/"><div class="epl-num">Cap. 2</div><div class="epl-title">Dois</div></a></li>
      <li><a href="https://centralnovel.example.org/devourer-cap-1/"><div class="epl-num">Cap. 1</div><div class="epl-title">Um</div></a></li>
    </ul></div></div>
  </body></html>`;
  const emptyListHtml = `<html><head><title>Devourer</title></head><body>
    <h1 class="entry-title">Devourer</h1>
    <div class="spe"><span>Autor: CypherTails</span></div>
    <span class="ts-chl-collapsible">Capítulos</span>
    <div class="ts-chl-collapsible-content"><div class="eplister"><ul></ul></div></div>
  </body></html>`;

  const logs = [];
  const doc = new DOMParser().parseFromString(fullHtml, 'text/html');
  const series = await wpLightNovelParser.loadSeries(
    seriesUrl,
    {
      customListSelector: '.unrelated-site-chapters a',
      onLog: (msg, level) => logs.push({ msg, level })
    },
    undefined,
    doc
  );
  assert.equal(series.chapters.length, 2, 'Stale customListSelector must fall back to native adapter extraction');
  assert.ok(
    logs.some((l) => l.level === 'warn' && /retornou 0 capítulos/i.test(l.msg)),
    'Should warn when customListSelector matched 0 chapters and fell back'
  );

  // Half-loaded sourceTab DOM (0 chapters) should fall back cleanly to HTTP fetchWithRetry
  mockFetchRoutes({ [seriesUrl]: fullHtml });
  const partialDoc = new DOMParser().parseFromString(emptyListHtml, 'text/html');
  partialDoc._wpbFromSourceTab = true;
  const recovered = await wpLightNovelParser.loadSeries(seriesUrl, {}, undefined, partialDoc);
  assert.equal(recovered.chapters.length, 2, 'Empty sourceTab DOM should recover via direct HTTP fetch');
});

test('Regression snapshot: novelbin chapter-to-index resolution, metadata, chapter list, and sr-only/duplicate-heading/ad cleanup', async () => {
  const expected = SNAPSHOTS.novelbin;
  const indexHtml = readFixture('novelbin-index.html');
  const ch1Html = readFixture('novelbin-chapter.html');

  mockFetchRoutes({
    [expected.startingUrl]: indexHtml,
    [expected.chapters[0].url]: ch1Html
  });

  // Loading directly from a chapter URL resolves back to the /novel/<slug> index
  const { parser, series } = await loadSeriesWithParser(expected.chapters[0].url);
  assertParserSnapshot(expected, { parser, series });
  assert.notEqual(series.author, 'Novelbin');
  assert.equal(series.requiresTabRender, true);

  const parsedCh1 = await parser.downloadChapter(series.chapters[0], {});
  assert.equal(parsedCh1.chapterTitle, 'Chapter 1 - The Lantern');
  const xhtml = parsedCh1.serialize('../styles/book.css', true);
  assert.ok(!/sr-only/i.test(xhtml), 'Screen-reader-only h1 should be stripped by sanitizer');
  assert.ok(!/Chapter 1: The Lantern/i.test(xhtml), 'Duplicate leading <h3> inside wrapper div should be removed');
  assert.ok(!/<iframe/i.test(xhtml), 'Middle ad iframe should be stripped');
  assert.match(xhtml, /Rain tapped against the brass windowpanes/);
  assert.match(xhtml, /clocktower bell tolled once/);

  // Loading from an unhydrated chapter URL containing a <noscript> SEO fallback list
  // must resolve to /novel/<slug>, never to an unrelated link in #ssr-home-fallback
  const ssrChapterStubHtml = `<html><head>
    <meta property="og:site_name" content="Novelbin">
  </head><body>
    <div id="root"><main class="container"><div class="skeleton"></div><div class="skeleton"></div></main></div>
    <noscript><div id="ssr-home-fallback"><a href="/novel/unrelated-popular">Unrelated</a></div></noscript>
  </body></html>`;
  const stubChapterUrl = 'https://novelbin.example.org/read/glass-spire/chapter-2';
  mockFetchRoutes({
    [stubChapterUrl]: ssrChapterStubHtml,
    [expected.startingUrl]: indexHtml
  });
  const stubRes = await loadSeriesWithParser(stubChapterUrl);
  assert.equal(stubRes.series.startingUrl, expected.startingUrl);
  assert.equal(stubRes.series.title, expected.title);

  // resolveParserForChapterUrl routes novelbin.xyz URLs cleanly even from generic hub contexts
  const resolved = resolveParserForChapterUrl(
    'https://novelbin.xyz/read/demo/chapter-1',
    genericHtmlParser,
    'auto',
    'https://hub.example.org/toc'
  );
  assert.equal(resolved.id, novelBinParser.id);
});

test('NovelBinParser matches SSR stub & domain-agnostic hydrated DOM, and rejects skeleton reader content', () => {
  const ssrStubDoc = new DOMParser().parseFromString(
    `<html><head>
      <meta property="og:site_name" content="Novelbin">
    </head><body><div id="root">
      <div id="ssr-novel-card">
        <img src="https://cdn.novelbin.example.org/thumbnail/demo.jpg" alt="Cover">
        <h1>Demo Skyblade</h1>
        <p><strong>Author:</strong> L. Author</p>
        <p><strong>Status:</strong> Ongoing</p>
        <a href="/genre/fantasy">Fantasy</a>
        <section><h2>Synopsis</h2><div><p>Full SSR synopsis paragraph.</p></div></section>
      </div>
    </div></body></html>`,
    'text/html'
  );
  assert.ok(novelBinParser.matchScore(ssrStubDoc, 'https://mirror.example.org/novel/demo-skyblade') >= 50);
  const ssrMeta = novelBinParser.extractSiteMetadata(ssrStubDoc, 'https://mirror.example.org/novel/demo-skyblade');
  assert.equal(ssrMeta.title, 'Demo Skyblade');
  assert.equal(ssrMeta.author, 'L. Author');
  assert.equal(ssrMeta.status, 'Ongoing');
  assert.deepEqual(ssrMeta.genres, ['Fantasy']);

  const skeletonChapterDoc = new DOMParser().parseFromString(
    `<html><body><main class="reader-content">
      <div class="skeleton"></div><div class="skeleton"></div>
    </main></body></html>`,
    'text/html'
  );
  assert.equal(novelBinParser.findChapterContentRoot(skeletonChapterDoc), null);

  const hydratedNoDomainDoc = new DOMParser().parseFromString(
    `<html><body><div class="novel-page-wrapper">
      <div class="novel-detail-hero"><h1 class="detail-title">Domainless Test</h1></div>
      <div class="chapter-box"><div class="chapter-list">
        <a class="chapter-item" href="/read/domainless/chapter-1"><span>Chapter 1</span></a>
      </div></div>
    </div></body></html>`,
    'text/html'
  );
  assert.equal(parserRegistry.detect(hydratedNoDomainDoc, 'https://mirror.example.org/novel/domainless').id, 'novelbin');
});

test('looksLikeSpaShell detects React skeleton SPA even when noscript SEO fallback contains many links', () => {
  const spaWithNoscriptDoc = new DOMParser().parseFromString(
    `<html><head><title>App</title><script type="module" src="/assets/app.js"></script></head><body>
      <div id="root">
        <div class="navbar">App</div>
        <main class="reader-content">
          <div class="skeleton"></div>
          <div class="skeleton"></div>
          <div class="skeleton"></div>
        </main>
      </div>
      <noscript>
        <div>
          ${Array.from({ length: 18 }, (_, i) => `<a href="/genre/g${i}">Genre ${i}</a>`).join('')}
          <p>Fallback SEO copy 1</p><p>Fallback SEO copy 2</p><p>Fallback SEO copy 3</p>
        </div>
      </noscript>
    </body></html>`,
    'text/html'
  );
  assert.equal(looksLikeSpaShell(spaWithNoscriptDoc), true);
});

test('BaseParser never caches anti-bot chapter responses in PageDomCache and RoyalRoadParser rejects mismatched fiction ID', async () => {
  const { PageDomCache } = await import('../src/core/parser-engine.js');
  const pageDomCache = new PageDomCache();
  globalThis.fetch = async () =>
    new Response('<html><title>Just a moment...</title><body>Checking your browser before accessing... Enable JavaScript and cookies to continue</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    });
  await assert.rejects(
    () =>
      genericHtmlParser.downloadChapter(
        { url: 'https://novel.example.org/cf-ch', displayTitle: 'CF' },
        { pageDomCache, maxRetries: 0 }
      ),
    (err) => Boolean(err.isAntiBotChallenge)
  );
  assert.equal(pageDomCache.get('https://novel.example.org/cf-ch'), null);

  const chapterWrongFiction = new DOMParser().parseFromString(
    `<html><body>
      <a href="/fiction/99999/other-story">Fiction Home</a>
      <div class="chapter-content"><p>Content</p></div>
    </body></html>`,
    'text/html'
  );
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const s = String(url);
    requestedUrls.push(s);
    if (s.includes('/fiction/12345/')) {
      return new Response(
        '<html><body><table id="chapters"><tbody><tr><td><a href="/fiction/12345/my-story/chapter/1">Ch 1</a></td></tr></tbody></table></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    return new Response('Not Found', { status: 404 });
  };
  const resolved = await royalRoadParser.resolveIndexDocument(
    'https://www.royalroad.com/fiction/12345/my-story/chapter/1',
    chapterWrongFiction
  );
  assert.equal(requestedUrls.some((u) => u.includes('/fiction/99999/')), false);
  assert.ok(resolved.targetUrl.includes('/fiction/12345/'));

  const fakeScribblePrevLoop = new DOMParser().parseFromString(
    '<div id="pagination-mesh-toc"><a class="page-link next" href="?toc=1">Next</a></div>',
    'text/html'
  );
  assert.equal(
    scribbleHubParser.findNextPageUrl(fakeScribblePrevLoop, 'https://www.scribblehub.com/series/1/t/?toc=abc'),
    null
  );
  const fakeScribbleInvalidNext = new DOMParser().parseFromString(
    '<div id="pagination-mesh-toc"><a class="page-link next" href="?toc=xyz">Next</a></div>',
    'text/html'
  );
  assert.equal(
    scribbleHubParser.findNextPageUrl(fakeScribbleInvalidNext, 'https://www.scribblehub.com/series/1/t/?toc=1'),
    null
  );
  const fakeScribbleAdvance = new DOMParser().parseFromString(
    '<div id="pagination-mesh-toc"><a class="page-link next" href="?toc=2">Next</a></div>',
    'text/html'
  );
  assert.equal(
    scribbleHubParser.findNextPageUrl(fakeScribbleAdvance, 'https://www.scribblehub.com/series/1/t/?toc=abc'),
    'https://www.scribblehub.com/series/1/t/?toc=2'
  );
});

test('MadaraThemeParser fetches POST /ajax/chapters/ when SSR listing wrapper is empty', async () => {
  const { madaraThemeParser } = await import('../src/parsers/madara-theme.js');
  const origFetch = globalThis.fetch;
  let postedAjaxUrl = '';
  let postedMethod = '';
  globalThis.fetch = async (url, init = {}) => {
    postedAjaxUrl = String(url);
    postedMethod = String(init.method || 'GET').toUpperCase();
    return new Response(
      '<ul class="main version-chap"><li class="wp-manga-chapter"><a href="https://madara.example.org/novel/my-story/chapter-2/">Chapter 2</a></li><li class="wp-manga-chapter"><a href="https://madara.example.org/novel/my-story/chapter-1/">Chapter 1</a></li></ul>',
      { status: 200, headers: { 'content-type': 'text/html' } }
    );
  };
  try {
    const ssrDoc = new DOMParser().parseFromString(
      '<html><body><div class="post-title"><h1>My Madara Story</h1></div><div class="listing-chapters_wrap"></div></body></html>',
      'text/html'
    );
    const resolved = await madaraThemeParser.resolveIndexDocument(
      'https://madara.example.org/novel/my-story/',
      ssrDoc
    );
    assert.equal(postedMethod, 'POST');
    assert.equal(postedAjaxUrl, 'https://madara.example.org/novel/my-story/ajax/chapters/');
    const chapters = madaraThemeParser.collectChapterNodes(resolved.doc, resolved.targetUrl);
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0].titleText, 'Chapter 1');
    assert.equal(chapters[1].titleText, 'Chapter 2');
  } finally {
    globalThis.fetch = origFetch;
  }
});

