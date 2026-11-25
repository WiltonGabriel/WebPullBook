import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './helpers/dom-env.js';
import { DEFAULT_OPTIONS, getCacheKey, state } from '../src/workspace/state.js';
import {
  applyThemeChoice,
  populateRegistries,
  sanitizeCoverPreviewUrl,
  sanitizeImportedOptions
} from '../src/workspace/options-storage.js';
import { applyI18nToDom } from '../src/workspace/i18n.js';
import { sanitizeDomainRules } from '../src/workspace/domain-rules-ui.js';
import { writeBlobToDirectoryHandle } from '../src/workspace/download-storage.js';
import {
  applyStaticIcons,
  createIcon,
  createIconButtonContent,
  setButtonLabel
} from '../src/workspace/icons.js';

let restoreDom;
let prevLocalStorage;
let prevChrome;

beforeEach(() => {
  restoreDom = installDomGlobals();
  prevLocalStorage = globalThis.localStorage;
  prevChrome = globalThis.chrome;
});

afterEach(() => {
  globalThis.localStorage = prevLocalStorage;
  globalThis.chrome = prevChrome;
  restoreDom();
});

test('sanitizeImportedOptions rejects invalid payloads, strips polluted keys, validates enums, and clamps numbers', () => {
  assert.throws(() => sanitizeImportedOptions(null), /Invalid options payload/);
  assert.throws(() => sanitizeImportedOptions([]), /Invalid options payload/);
  assert.throws(() => sanitizeImportedOptions('nope'), /Invalid options payload/);

  const malicious = JSON.parse(
    '{"__proto__":{"polluted":true},"uiLang":"en","theme":"midnight","saveTargetMode":"custom-dir","folderLayout":"custom","compressedFormat":"png","fontFamily":"serif","textAlign":"left","delayMs":999999,"concurrency":0,"lineHeight":9,"grayscaleImages":true,"unknownKey":"drop"}'
  );
  const clean = sanitizeImportedOptions(malicious);

  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(clean, 'unknownKey'), false);
  assert.equal(clean.uiLang, 'en');
  assert.equal(clean.theme, 'midnight');
  assert.equal(clean.saveTargetMode, 'custom-dir');
  assert.equal(clean.folderLayout, 'custom');
  assert.equal(clean.delayMs, 30000);
  assert.equal(clean.concurrency, 1);
  assert.equal(clean.lineHeight, 2.4);
  assert.equal(clean.grayscaleImages, false);

  const fallbackEnum = sanitizeImportedOptions({
    saveTargetMode: 'invalid-target',
    outputFormat: 'pdf',
    parserId: 'nonexistent-parser',
    readerPreset: 'nonexistent-preset'
  });
  assert.equal(fallbackEnum.saveTargetMode, DEFAULT_OPTIONS.saveTargetMode);
  assert.equal(fallbackEnum.outputFormat, DEFAULT_OPTIONS.outputFormat);
  assert.equal(fallbackEnum.parserId, DEFAULT_OPTIONS.parserId);
  assert.equal(fallbackEnum.readerPreset, DEFAULT_OPTIONS.readerPreset);
});

test('sanitizeDomainRules ignores prototype keys and invalid domains while normalizing valid entries', () => {
  const malicious = JSON.parse(
    '{"__proto__":{"domain":"evil.org"},"constructor":{"domain":"constructor"},"prototype":{"domain":"prototype"},"bad":null,"https://WWW.Example.org/series/1":{"listSelector":".list a","contentSelector":".prose","renderWithTab":true}}'
  );
  const rules = sanitizeDomainRules(malicious);

  assert.equal(Object.hasOwn(rules, '__proto__'), false);
  assert.equal(Object.hasOwn(rules, 'constructor'), false);
  assert.equal(Object.hasOwn(rules, 'prototype'), false);
  assert.equal(Object.hasOwn(rules, 'bad'), false);
  assert.equal(Object.hasOwn(rules, 'www.example.org'), false);
  assert.equal(Object.hasOwn(rules, 'example.org'), true);
  assert.equal(rules['example.org'].domain, 'example.org');
  assert.equal(rules['example.org'].listSelector, '.list a');
  assert.equal(rules['example.org'].renderWithTab, true);
});

test('sanitizeCoverPreviewUrl allows safe HTTP/HTTPS and raster data URIs while blocking XSS vectors', () => {
  assert.equal(sanitizeCoverPreviewUrl('https://cdn.example.org/cover.jpg'), 'https://cdn.example.org/cover.jpg');
  assert.match(sanitizeCoverPreviewUrl('data:image/png;base64,iVBORw0KGgo='), /^data:image\/png;base64,/);
  assert.equal(sanitizeCoverPreviewUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeCoverPreviewUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeCoverPreviewUrl('data:image/svg+xml;base64,PHN2Zz4='), '');
});

test('getCacheKey separates entries by explicit parserId and applyThemeChoice preserves system option', () => {
  const doc = new DOMParser().parseFromString(
    `<html data-theme="dark">
      <head><meta name="color-scheme" content="dark"></head>
      <body>
        <select id="ui-theme-top">
          <option value="system">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </body>
    </html>`,
    'text/html'
  );
  globalThis.document = doc;
  const store = new Map([['wpb-color-scheme', 'dark']]);
  globalThis.localStorage = {
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k)
  };

  applyThemeChoice('system');
  assert.equal(doc.documentElement.dataset.theme, undefined);
  assert.equal(doc.getElementById('ui-theme-top').value, 'system');
  assert.equal(store.has('wpb-color-scheme'), false);

  const keyA = getCacheKey('https://example.org/ch1', 'royalroad');
  const keyB = getCacheKey('https://example.org/ch1', 'generic-html');
  assert.notEqual(keyA, keyB);
  assert.ok(keyA.includes('|royalroad|'));
  assert.equal(state.options.theme, DEFAULT_OPTIONS.theme);
});

test('writeBlobToDirectoryHandle rejects traversal paths and aborts writable stream on write failure', async () => {
  let getDirCalls = 0;
  const mockRoot = {
    getDirectoryHandle: async () => {
      getDirCalls++;
      return mockRoot;
    },
    getFileHandle: async () => {
      throw new Error('Should not open file handle on traversal');
    }
  };

  await assert.rejects(
    () => writeBlobToDirectoryHandle(mockRoot, '../outside.epub', new Blob(['x'])),
    /Invalid relative output path/
  );
  await assert.rejects(
    () => writeBlobToDirectoryHandle(mockRoot, 'sub/./../escape.epub', new Blob(['x'])),
    /Invalid relative output path/
  );
  await assert.rejects(
    () => writeBlobToDirectoryHandle(mockRoot, 'sub/bad\x00name.epub', new Blob(['x'])),
    /Invalid relative output path/
  );
  assert.equal(getDirCalls, 0);

  let aborted = false;
  const failingRoot = {
    getDirectoryHandle: async () => failingRoot,
    getFileHandle: async (_name, opts) => {
      if (opts && opts.create === false) {
        const notFound = new Error('Not found');
        notFound.name = 'NotFoundError';
        throw notFound;
      }
      return {
        createWritable: async () => ({
          write: async () => {
            throw new Error('Disk full');
          },
          close: async () => {},
          abort: async () => {
            aborted = true;
          }
        })
      };
    }
  };
  await assert.rejects(
    () => writeBlobToDirectoryHandle(failingRoot, 'Book/ch.epub', new Blob(['x'])),
    /Disk full/
  );
  assert.equal(aborted, true);
});

test('icons helpers build minimalist SVG icons via createElementNS and preserve icons on label updates', () => {
  const icon = createIcon('crosshair', { size: 16 });
  assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(icon.getAttribute('stroke'), 'currentColor');
  assert.equal(icon.getAttribute('stroke-width'), '2');
  assert.equal(icon.getAttribute('fill'), 'none');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.ok(icon.querySelector('circle'));

  const doc = new DOMParser().parseFromString(
    `<button id="b1" data-wpb-icon="download"><span class="wpb-btn-label">Pack</span></button>
     <button id="b2" data-wpb-icon="x" data-wpb-icon-only="true" aria-label="Close">&times;</button>`,
    'text/html'
  );
  globalThis.document = doc;
  applyStaticIcons(doc);

  const b1 = doc.getElementById('b1');
  assert.ok(b1.querySelector('svg.wpb-icon'));
  setButtonLabel(b1, 'Exporting...');
  assert.ok(b1.querySelector('svg.wpb-icon'));
  assert.equal(b1.querySelector('.wpb-btn-label').textContent, 'Exporting...');

  const b2 = doc.getElementById('b2');
  assert.equal(b2.classList.contains('btn-icon-only'), true);
  assert.ok(b2.querySelector('svg.wpb-icon'));
  assert.equal(b2.textContent, '');

  const dyn = doc.createElement('button');
  createIconButtonContent(dyn, 'trash', 'Remove');
  assert.ok(dyn.querySelector('svg.wpb-icon'));
  assert.equal(dyn.querySelector('.wpb-btn-label').textContent, 'Remove');
});

test('populateRegistries tags parser auto option with data-i18n so language switches translate it', () => {
  const doc = new DOMParser().parseFromString(
    '<select id="opt-parser"></select><select id="output-format"></select>',
    'text/html'
  );
  globalThis.document = doc;
  state.options.uiLang = 'pt';
  populateRegistries();
  const autoOpt = doc.querySelector('#opt-parser option[value="auto"]');
  assert.equal(autoOpt.getAttribute('data-i18n'), 'parserAutoOption');
  assert.equal(autoOpt.textContent, 'Automático (Pontuação DOM)');

  applyI18nToDom('en');
  assert.equal(autoOpt.textContent, 'Automatic (DOM Scoring)');
});
