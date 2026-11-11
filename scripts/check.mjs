#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const fixMode = process.argv.includes('--fix');
const errors = [];
const fixedFiles = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fail(msg) {
  errors.push(msg);
}

// 1. Validate manifest.json and version parity with package.json
try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (manifest.manifest_version !== 3) fail('manifest.json: manifest_version must be 3');
  if (!manifest.name || !manifest.version) fail('manifest.json: name and version are required');
  if (pkg.version !== manifest.version) {
    fail(`Version mismatch: manifest.json (${manifest.version}) !== package.json (${pkg.version})`);
  }
  for (const iconPath of Object.values(manifest.icons || {})) {
    if (!fs.existsSync(iconPath)) fail(`manifest.json: missing icon ${iconPath}`);
  }
  if (!fs.existsSync(manifest.background?.service_worker || '')) {
    fail(`manifest.json: missing service_worker ${manifest.background?.service_worker}`);
  }
  console.log(`[OK] manifest.json & package.json: ${manifest.name} v${manifest.version}`);
} catch (err) {
  fail(`manifest.json error: ${err.message}`);
}

// 2. JS syntax checks across src/, tests/, scripts/
const jsFiles = [
  ...walk('src').filter((f) => f.endsWith('.js') || f.endsWith('.mjs')),
  ...walk('tests').filter((f) => f.endsWith('.js') || f.endsWith('.mjs')),
  ...walk('scripts').filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
];
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(`Syntax error in ${file}: ${err.stderr?.toString() || err.message}`);
  }
}
console.log(`[OK] JS syntax checked (${jsFiles.length} files)`);

// 3. MV3 strict CSP check on extension HTML pages
const htmlFiles = walk('src').filter((f) => f.endsWith('.html'));
for (const htmlPath of htmlFiles) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const inlineScripts = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/gi);
  if (inlineScripts) fail(`MV3 CSP violation (inline <script>) in ${htmlPath}`);
  const inlineEvents = html.match(/<[^>]*\s+on[a-z]+\s*=/gi);
  if (inlineEvents) fail(`MV3 CSP violation (inline on* handler) in ${htmlPath}`);
}
console.log(`[OK] MV3 CSP check (${htmlFiles.length} HTML files)`);

// 4. EPUB container media-type check
const epubBuilderPath = path.join('src', 'core', 'epub-builder.js');
const epubBuilderJs = fs.readFileSync(epubBuilderPath, 'utf8');
if (!epubBuilderJs.includes('application/oebps-package+xml')) {
  fail('src/core/epub-builder.js must declare media-type="application/oebps-package+xml"');
}
console.log('[OK] EPUB container media-type check');

// 5. Relative markdown links check
const mdFiles = [
  'README.md',
  'README.en.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  '.github/SECURITY.md',
  ...walk('docs').filter((f) => f.endsWith('.md'))
];
for (const md of mdFiles) {
  if (!fs.existsSync(md)) continue;
  const content = fs.readFileSync(md, 'utf8');
  const baseDir = path.dirname(md);
  const rx = /\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/g;
  let m;
  while ((m = rx.exec(content)) !== null) {
    const link = m[1];
    if (/^(https?:|mailto:)/i.test(link)) continue;
    const target = path.normalize(path.join(baseDir, link));
    if (!fs.existsSync(target)) {
      fail(`Broken relative link in ${md}: ${link} -> ${target}`);
    }
  }
}
console.log(`[OK] Markdown relative links (${mdFiles.length} files)`);

// 6. i18n and DOM ID consistency check
try {
  const i18nSrc = fs.readFileSync(path.join('src', 'workspace', 'i18n.js'), 'utf8');
  const ptMatch = i18nSrc.match(/\n  pt:\s*\{([\s\S]*?)\n  \},\n  en:\s*\{([\s\S]*?)\n  \}\n\};/);
  if (!ptMatch) {
    fail('Could not parse pt/en dictionaries in src/workspace/i18n.js');
  } else {
    const extractKeys = (block) => [...block.matchAll(/^\s{4}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
    const ptList = extractKeys(ptMatch[1]);
    const enList = extractKeys(ptMatch[2]);
    const findDupes = (arr) => arr.filter((k, i) => arr.indexOf(k) !== i);
    const ptDupes = findDupes(ptList);
    const enDupes = findDupes(enList);
    if (ptDupes.length) fail(`i18n.js duplicate keys in pt: ${ptDupes.join(', ')}`);
    if (enDupes.length) fail(`i18n.js duplicate keys in en: ${enDupes.join(', ')}`);
    const ptKeys = new Set(ptList);
    const enKeys = new Set(enList);
    const missingInEn = [...ptKeys].filter((k) => !enKeys.has(k));
    const missingInPt = [...enKeys].filter((k) => !ptKeys.has(k));
    if (missingInEn.length) fail(`i18n.js missing in en: ${missingInEn.join(', ')}`);
    if (missingInPt.length) fail(`i18n.js missing in pt: ${missingInPt.join(', ')}`);

    const wsHtml = fs.readFileSync(path.join('src', 'workspace', 'workspace.html'), 'utf8');
    const wsJs = fs.readFileSync(path.join('src', 'workspace', 'workspace.js'), 'utf8');

    for (const m of wsHtml.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) {
      if (!ptKeys.has(m[1])) fail(`workspace.html references missing i18n key: ${m[1]}`);
    }
    for (const m of wsJs.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      if (!ptKeys.has(m[1])) fail(`workspace.js references missing i18n key: ${m[1]}`);
    }

    const htmlIds = new Set([...wsHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of wsJs.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!htmlIds.has(m[1])) fail(`workspace.js references missing HTML id: #${m[1]}`);
    }
    console.log(`[OK] i18n (${ptKeys.size} keys) and workspace DOM IDs verified`);
  }
} catch (err) {
  fail(`Consistency check error: ${err.message}`);
}

// 7. Formatting & hygiene lint across src/, tests/, scripts/
const lintableExts = new Set(['.js', '.mjs', '.html', '.css', '.json']);
const textFiles = [
  'manifest.json',
  'package.json',
  ...walk('src'),
  ...walk('tests').filter((f) => !f.includes(`${path.sep}fixtures${path.sep}`)),
  ...walk('scripts')
].filter((f) => lintableExts.has(path.extname(f)));

for (const file of textFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  let next = raw;

  if (next.charCodeAt(0) === 0xfeff) {
    if (fixMode) next = next.slice(1);
    else fail(`UTF-8 BOM found in ${file}`);
  }
  if (next.includes('\r\n')) {
    if (fixMode) next = next.replace(/\r\n/g, '\n');
    else fail(`CRLF line endings found in ${file} (expected LF)`);
  }
  if (/[ \t]+$/m.test(next)) {
    if (fixMode) next = next.replace(/[ \t]+$/gm, '');
    else fail(`Trailing whitespace found in ${file}`);
  }
  if (fixMode && next !== raw) {
    fs.writeFileSync(file, next, 'utf8');
    fixedFiles.push(file);
  }

  if (file.startsWith(`src${path.sep}`) && (file.endsWith('.js') || file.endsWith('.mjs'))) {
    if (/\bdebugger\b/.test(next)) fail(`Leftover debugger statement in ${file}`);
    if (/\bconsole\.log\s*\(/.test(next)) fail(`Leftover console.log() in ${file}`);
  }
}

console.log(`[OK] Formatting & hygiene lint (${textFiles.length} files)`);
if (fixedFiles.length > 0) {
  console.log(`Fixed formatting in ${fixedFiles.length} file(s):`, fixedFiles.join(', '));
}

if (errors.length > 0) {
  console.error('\nValidation failed:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
