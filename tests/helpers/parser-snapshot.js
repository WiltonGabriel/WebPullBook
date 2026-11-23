import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const FIXTURES_DIR = path.resolve('tests/fixtures');
export const SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'snapshots.json'), 'utf8'));

export function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

export function mockFetchRoutes(routes) {
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

export function assertParserSnapshot(expected, { parser, series }) {
  assert.equal(parser.id, expected.parserId);
  if ('startingUrl' in expected) {
    assert.equal(series.startingUrl, expected.startingUrl);
  }
  assert.equal(series.title, expected.title);
  assert.equal(series.author, expected.author);
  assert.equal(series.language, expected.language);
  if ('status' in expected) {
    assert.equal(series.status, expected.status);
  }
  if ('genres' in expected) {
    assert.deepEqual(series.genres, expected.genres);
  }
  if ('coverUrl' in expected) {
    assert.equal(series.coverUrl, expected.coverUrl);
  }
  assert.equal(series.synopsis, expected.synopsis);
  assert.deepEqual(
    series.chapters.map((c) => ({ url: c.url, displayTitle: c.displayTitle, volume: c.volume })),
    expected.chapters
  );
}
