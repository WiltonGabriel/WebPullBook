import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installDomGlobals } from './helpers/dom-shim.js';
import { resolveEpubCheckRunner, runEpubCheck } from './helpers/epubcheck.js';
import { loadSeriesWithParser } from '../src/parsers/index.js';
import { exporterRegistry } from '../src/exporters/index.js';
import { buildEpubStylesheet } from '../src/core/parser-engine.js';

const FIXTURES_DIR = path.resolve('tests/fixtures');
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0)
);

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

let restoreDom;
let origFetch;

beforeEach(() => {
  restoreDom = installDomGlobals();
  origFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  restoreDom();
});

test('Generated EPUB 3 (nested volumes + SVG cover) and EPUB 2 pass W3C EPUBCheck validation', async (t) => {
  const runner = resolveEpubCheckRunner();
  if (!runner) {
    if (process.env.REQUIRE_EPUBCHECK === '1') {
      assert.fail('REQUIRE_EPUBCHECK=1 is set, but EPUBCheck was not found.');
    }
    t.skip('EPUBCheck not installed locally (install to .tools/epubcheck or set EPUBCHECK_JAR)');
    return;
  }

  const routes = {
    'https://novel.example.org/series/torre-cinzenta/': readFixture('wp-lightnovel-index.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-01/': readFixture('wp-lightnovel-chapter.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-02/': readFixture('wp-lightnovel-chapter.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-03/': readFixture('wp-lightnovel-chapter.html'),
    'https://novel.example.org/series/torre-cinzenta/cap-04/': readFixture('wp-lightnovel-chapter.html')
  };

  globalThis.fetch = async (url) => {
    const key = String(url);
    if (routes[key]) {
      return new Response(routes[key], { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (/\.(png|jpg|webp)(\?|$)/i.test(key)) {
      return new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('Not Found', { status: 404 });
  };

  const { parser, series } = await loadSeriesWithParser('https://novel.example.org/series/torre-cinzenta/');
  const parsedChapters = [];
  for (const ch of series.chapters) {
    parsedChapters.push(await parser.downloadChapter(ch));
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpb-epubcheck-suite-'));
  try {
    const scenarios = [
      {
        name: 'epub3-nested.epub',
        createEpub3: true,
        useSvgForImages: false,
        groupNestedVolumes: true
      },
      {
        name: 'epub3-svg-flat.epub',
        createEpub3: true,
        useSvgForImages: true,
        groupNestedVolumes: false
      },
      {
        name: 'epub2-nested.epub',
        createEpub3: false,
        useSvgForImages: false,
        groupNestedVolumes: true
      }
    ];

    for (const sc of scenarios) {
      // Re-parse chapters cleanly per scenario because buildEpubBlob mutates img src in-place
      const freshChapters = [];
      for (const ch of series.chapters) {
        freshChapters.push(await parser.downloadChapter(ch));
      }

      const blob = await exporterRegistry.get('epub').exportBook({
        metadata: series,
        bookTitle: series.title,
        seriesName: series.title,
        seriesIndex: 1,
        parsedChapters: freshChapters,
        options: {
          createEpub3: sc.createEpub3,
          restrictCoverJpeg: false,
          compressImages: false,
          useSvgForImages: sc.useSvgForImages,
          addInfoPage: true,
          stylesheet: buildEpubStylesheet()
        },
        groupNestedVolumes: sc.groupNestedVolumes
      });

      const epubFile = path.join(outDir, sc.name);
      fs.writeFileSync(epubFile, Buffer.from(await blob.arrayBuffer()));
      const result = runEpubCheck(epubFile);
      assert.equal(result.ok, true, `EPUBCheck failed for ${sc.name}:\n${result.output}`);
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
