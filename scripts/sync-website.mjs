#!/usr/bin/env node
/**
 * Synchronizes website/ static HTML, site.config.json, robots.txt, and sitemap.xml
 * from the repository's authoritative documentation and manifest files:
 *  - docs/COMPATIBILITY.md            -> website/compatibility.html, website/pt/compatibility.html, website/{,pt/}index.html
 *  - docs/READER_PRESETS.md           -> website/features.html
 *  - docs/READER_PRESETS.pt.md        -> website/pt/features.html
 *  - manifest.json, package.json & site.config.json -> version labels, official links, JSON-LD, sitemap.xml & robots.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEBSITE_DIR = path.join(ROOT, 'website');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderInlineMarkdown(md) {
  let out = escapeHtml(String(md || '').trim());
  // Strip markdown links [label](url) -> label, supporting one level of balanced parentheses in URLs
  out = out.replace(/\[([^\]]+)\]\((?:[^()]+|\([^()]*\))+\)/g, '$1');
  // Inline code `code`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Em-dash
  out = out.replace(/\s—\s/g, ' &mdash; ').replace(/^—$/, '&mdash;');
  return out;
}

function splitMarkdownTableRow(line) {
  const inner = line.slice(1, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (inner[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += inner[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseMarkdownSections(markdown) {
  const sections = new Map();
  let currentHeading = '';
  for (const rawLine of String(markdown || '').split('\n')) {
    const line = rawLine.trim();
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      currentHeading = h2Match[1].trim();
      sections.set(currentHeading, []);
      continue;
    }
    if (!currentHeading) continue;
    if (line.startsWith('|') && line.endsWith('|')) {
      sections.get(currentHeading).push(line);
    }
  }

  const parsedTables = new Map();
  for (const [heading, lines] of sections.entries()) {
    if (lines.length < 3) continue;
    const headers = splitMarkdownTableRow(lines[0]);
    const rows = [];
    for (let i = 2; i < lines.length; i++) {
      const cells = splitMarkdownTableRow(lines[i]);
      if (cells.length >= 2) {
        rows.push(cells);
      }
    }
    parsedTables.set(heading, { headers, rows });
  }
  return parsedTables;
}

const PT_TRANSLATIONS = {
  // Tier 1 notes
  'End-to-end tested (static SSR, zero SPA tabs): multi-volume detection, cover, synopsis, genres, and chapter fidelity.':
    'Testado de ponta a ponta (SSR estático, zero abas SPA): detecção de múltiplos volumes, capa, sinopse, gêneros e fidelidade de capítulos.',
  'End-to-end tested (20 chapters): volume & chapter metadata, full synopsis, tags, cover, inline images, and hidden `<style>` watermark filtering.':
    'Testado de ponta a ponta (20 capítulos): metadados de volumes e capítulos, sinopse completa, tags, capa, imagens internas e filtragem de marcas d\'água ocultas em `<style>`.',
  'End-to-end tested (20 chapters): paginated chapter API & multi-volume detection, full synopsis, genres, status, original cover, inline images, `.sr-only` heading cleanup, and footnote anchors.':
    'Testado de ponta a ponta (20 capítulos): API paginada de capítulos e múltiplos volumes, sinopse completa, gêneros, status, capa original, imagens internas, limpeza de `.sr-only` e âncoras de notas de rodapé.',
  'End-to-end tested (index & direct chapter URL): AJAX full TOC, open-tab reuse, chronological ordering, metadata, inline images, and author note cleanup.':
    'Testado de ponta a ponta (índice e URL direta de capítulo): sumário completo via AJAX, reaproveitamento de aba aberta, ordenação cronológica, metadados, imagens internas e limpeza de notas de autor.',
  'End-to-end tested (index & direct chapter URL, 2 novels): automatic SPA tab hydration, reusable tab pool, JSON-LD author & full metadata, cover, sr-only/duplicate-heading cleanup, and ad-free chapter XHTML.':
    'Testado de ponta a ponta (índice e URL direta de capítulo, 2 obras): hidratação automática de SPA via aba, pool reutilizável de abas, autor via JSON-LD e metadados completos, capa, limpeza de sr-only/título duplicado e XHTML de capítulos sem anúncios.',

  // Tier 2
  'Madara-based platforms (`.wp-manga-chapter`, `.reading-content`)':
    'Plataformas baseadas em Madara (`.wp-manga-chapter`, `.reading-content`)',
  'Other WordPress novel theme clones (`.eplister`, `.ts-chl-collapsible`, `.epcontent`)':
    'Outros clones de temas WordPress de novels (`.eplister`, `.ts-chl-collapsible`, `.epcontent`)',
  'Fixture-tested only': 'Testado via fixture',
  'Structural match': 'Compatibilidade estrutural',
  'Implemented with volume grouping and chapter extraction; pending official live-site testing checklist.':
    'Implementado com agrupamento por volumes e extração de capítulos; aguardando checklist oficial de teste em site ao vivo.',
  'Shares the same WordPress novel DOM layout as Central Novel; awaiting individual live reports.':
    'Compartilha a mesma estrutura DOM de temas WordPress do Central Novel; aguardando relatos individuais em uso real.',

  // Tier 3
  'Static HTML chapter indexes, blogs & paginated lists (`rel="next"`)':
    'Índices HTML estáticos, blogs e listas paginadas (`rel="next"`)',
  'Uses link-cluster scoring, prose density extraction, heuristic selector assistant, and visual picker.':
    'Usa pontuação de clusters de links, extração por densidade de prosa, assistente heurístico de seletores e seletor visual Apontar.',
  'Sequential chapters without a TOC page':
    'Capítulos sequenciais sem página de sumário',
  '`generic-html` ("Next Chapter" crawl)':
    '`generic-html` (rastreamento "Próximo Capítulo")',
  'Automatically crawls sequential *"Next Chapter"* links when landing on a prose chapter.':
    'Rastreia automaticamente links sequenciais de *"Próximo Capítulo"* / *"Next Chapter"* ao iniciar em um capítulo.',
  'JavaScript / SPA pages (React, Vue, Next.js)':
    'Páginas JavaScript / SPA (React, Vue, Next.js)',
  'Tab rendering (`renderWithTab`)':
    'Renderização via aba (`renderWithTab`)',
  'Extracts hydrated DOM via open or background browser tab when static HTML is an empty shell.':
    'Extrai o DOM hidratado via aba aberta ou aba auxiliar em segundo plano quando o HTML estático é uma casca vazia.',
  'Open browser tabs':
    'Abas abertas do navegador',
  'Merge Tabs':
    'Juntar Abas (*Merge Tabs*)',
  'Compiles open HTTP/HTTPS tabs into a single anthology or standalone books.':
    'Compila abas HTTP/HTTPS abertas em uma única coletânea ou em livros separados.',

  // Tier 4 (Limitations)
  'Proprietary DRM platforms':
    'Plataformas com DRM proprietário',
  'Content is encrypted and inaccessible as standard DOM text.':
    'O conteúdo é criptografado e inacessível como texto DOM padrão.',
  '`<canvas>` or scrambled-image chapters':
    'Capítulos em `<canvas>` ou imagens embaralhadas',
  'Text is rendered purely as pixels without HTML text nodes.':
    'O texto é renderizado apenas como pixels de imagem sem nós de texto HTML.',
  'Locked paywalls without session access':
    'Paywalls fechados sem acesso na sessão',
  'Browser session cannot access chapters behind paywalls.':
    'A sessão do navegador não tem acesso a capítulos bloqueados por paywall.',
  'Hard non-bypassable anti-bot / CAPTCHA gates':
    'Barreiras anti-bot / CAPTCHA estritas',
  'Automated requests are blocked until the user manually solves verification in a normal tab.':
    'Requisições automatizadas ficam bloqueadas até que o usuário conclua a verificação manualmente em uma aba normal.'
};

function translateCell(text, isPt, { required = false } = {}) {
  const clean = String(text || '').trim();
  if (!isPt) return clean;
  if (Object.hasOwn(PT_TRANSLATIONS, clean)) {
    return PT_TRANSLATIONS[clean];
  }
  if (required && clean && /[A-Za-z]/.test(clean) && !/^`[^`]+`$/.test(clean)) {
    throw new Error(`Missing PT_TRANSLATIONS entry in sync-website.mjs for: "${clean}"`);
  }
  return clean;
}

function formatLeadColumn(text) {
  const clean = String(text || '').trim();
  const parenIdx = clean.indexOf(' (');
  if (parenIdx > 0 && clean.endsWith(')')) {
    const titlePart = clean.slice(0, parenIdx);
    const parenPart = clean.slice(parenIdx + 1);
    return `<strong>${renderInlineMarkdown(titlePart)}</strong> ${renderInlineMarkdown(parenPart)}`;
  }
  return `<strong>${renderInlineMarkdown(clean)}</strong>`;
}

function findTableByPrefix(tablesMap, prefix) {
  for (const [heading, table] of tablesMap.entries()) {
    if (heading.toLowerCase().startsWith(prefix.toLowerCase())) {
      return table;
    }
  }
  return { headers: [], rows: [] };
}

function buildCompatibilityTbodies(compatMd, isPt) {
  const tables = parseMarkdownSections(compatMd);
  const tier1 = findTableByPrefix(tables, 'Verified & Tested');
  const tier2 = findTableByPrefix(tables, 'Added / Not Officially Tested');
  const tier3 = findTableByPrefix(tables, 'Potentially Compatible');
  const tier4 = findTableByPrefix(tables, 'Not Compatible');

  if (!tier1.rows.length || !tier2.rows.length || !tier3.rows.length || !tier4.rows.length) {
    throw new Error('docs/COMPATIBILITY.md: expected non-empty tables for all 4 compatibility tiers.');
  }

  const indent = '              ';

  const tbody1 = tier1.rows
    .map(([site, adapter, lastVerified, _fixture, notes]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(site, isPt))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(adapter)}</td>`,
        `${indent}  <td>${escapeHtml(lastVerified)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(notes, isPt, { required: true }))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const tbody2 = tier2.rows
    .map(([site, adapter, status, _fixture, notes]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(site, isPt, { required: true }))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(adapter)}</td>`,
        `${indent}  <td><span class="badge warn">${renderInlineMarkdown(translateCell(status, isPt, { required: true }))}</span></td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(notes, isPt, { required: true }))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const tbody3 = tier3.rows
    .map(([pattern, mode, notes]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(pattern, isPt, { required: true }))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(mode, isPt, { required: true }))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(notes, isPt, { required: true }))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const tbody4 = tier4.rows
    .map(([limitation, reason]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(limitation, isPt, { required: true }))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(reason, isPt, { required: true }))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const verifiedNames = tier1.rows.map(([site]) => translateCell(site, isPt));
  const limitationNames = tier4.rows.map(([limitation]) =>
    renderInlineMarkdown(translateCell(limitation, isPt, { required: true }))
  );

  return {
    'compat-tier-1': tbody1,
    'compat-tier-2': tbody2,
    'compat-tier-3': tbody3,
    'compat-tier-4': tbody4,
    verifiedNames,
    limitationNames
  };
}

function buildReaderPresetsTbody(presetsMd) {
  const tables = parseMarkdownSections(presetsMd);
  let presetTable = { rows: [] };
  for (const table of tables.values()) {
    if (table.rows.length > 0) {
      presetTable = table;
      break;
    }
  }
  if (!presetTable.rows.length) {
    throw new Error('READER_PRESETS markdown contains no profile rows.');
  }
  const indent = '              ';
  return presetTable.rows
    .map((cells) => {
      // Columns in docs/READER_PRESETS*.md:
      // 0: Profile, 1: EPUB Standard, 2: Pop-up Footnotes, 3: Cover JPEG, 4: Image Optimization, 5: Max Resolution, 6: Text Alignment, 7: Recommended For
      const [profile, epubStd, footnotes, coverJpeg, imgOpt, maxRes, _align, recommended] =
        cells.length >= 8 ? cells : [...cells, ''];
      return [
        `${indent}<tr>`,
        `${indent}  <td>${renderInlineMarkdown(profile)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(epubStd)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(footnotes)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(coverJpeg)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(imgOpt)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(maxRes)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(recommended)}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');
}

function replaceSyncedTbody(html, syncId, newInnerRows) {
  const pattern = new RegExp(
    `(<tbody[^>]*data-sync-table="${syncId}"[^>]*>)([\\s\\S]*?)(<\\/tbody>)`,
    'g'
  );
  return html.replace(pattern, (_full, open, _inner, close) => `${open}\n${newInnerRows}\n            ${close}`);
}

function replaceSyncedLimitationsSummary(html, compatData, isPt) {
  const limList = compatData.limitationNames.join(', ');
  const verList = compatData.verifiedNames.join(', ');
  const summaryHtml = isPt
    ? `O WebPullBook extrai texto em DOM HTML padrão acessível na sessão do navegador (${verList} verificados de ponta a ponta, além de suporte heurístico genérico e modo SPA). Limitações mapeadas em <a href="compatibility.html">docs/COMPATIBILITY.md</a>: ${limList}.`
    : `WebPullBook extracts standard DOM HTML text accessible in your browser session (${verList} verified end-to-end, plus generic heuristic and SPA tab modes). Known limitations tracked in <a href="compatibility.html">docs/COMPATIBILITY.md</a>: ${limList}.`;

  return html.replace(
    /(<p[^>]*data-sync-compat-summary[^>]*>)([\s\S]*?)(<\/p>)/g,
    (_full, open, _inner, close) => `${open}${summaryHtml}${close}`
  );
}

export function normalizeGoatCounterConfig(analytics) {
  const endpoint = String(analytics?.endpoint || '').trim();
  const scriptSrc = String(analytics?.scriptSrc || 'https://gc.zgo.at/count.js').trim();
  return {
    enabled: Boolean(endpoint),
    endpoint,
    scriptSrc
  };
}

export function syncGoatCounterScript(html, analyticsConfig) {
  const withoutExisting = String(html || '').replace(
    /^[ \t]*<script\b[^>]*\bdata-goatcounter\s*=\s*"[^"]*"[^>]*><\/script>[ \t]*\n?/gim,
    ''
  );
  if (!analyticsConfig?.enabled) {
    return withoutExisting;
  }
  const tag = `<script data-goatcounter="${escapeHtml(analyticsConfig.endpoint)}" async src="${escapeHtml(analyticsConfig.scriptSrc)}"></script>`;
  return withoutExisting.replace(
    /^([ \t]*)(<script\b[^>]*\bsrc="[^"]*assets\/js\/site\.js"[^>]*><\/script>)/m,
    (_full, indent, baseTag) => `${indent}${baseTag}\n${indent}${tag}`
  );
}

export function getConfiguredLinkMap(siteConfig) {
  if (!siteConfig) return {};
  return {
    firefoxAddons: siteConfig.firefoxAddonsUrl,
    releases: siteConfig.releasesUrl,
    releasesLatest: siteConfig.releasesLatestUrl,
    repository: siteConfig.repositoryUrl,
    issues: siteConfig.issuesUrl
  };
}

function syncConfiguredLinks(html, siteConfig) {
  const linkMap = getConfiguredLinkMap(siteConfig);
  if (Object.keys(linkMap).length === 0) return html;
  return String(html || '').replace(/<a\b[^>]*\bdata-wpb-link="([^"]+)"[^>]*>/gi, (tag, key) => {
    const nextHref = linkMap[key];
    if (!nextHref) return tag;
    return tag.replace(/\bhref="[^"]*"/i, () => `href="${escapeHtml(nextHref)}"`);
  });
}

function syncIndexJsonLd(html, siteConfig, softwareVersion = '') {
  if (!siteConfig || !/"@type"\s*:\s*"SoftwareApplication"/.test(html)) return html;
  return String(html || '').replace(
    /([ \t]*)(<script\s+type="application\/ld\+json">)([\s\S]*?)(<\/script>)/gi,
    (full, indent, openTag, rawJson, closeTag) => {
      let data;
      try {
        data = JSON.parse(rawJson);
      } catch {
        return full;
      }
      if (!data || typeof data !== 'object' || data['@type'] !== 'SoftwareApplication') {
        return full;
      }
      if (softwareVersion) data.softwareVersion = softwareVersion;
      if (siteConfig.firefoxAddonsUrl) data.installUrl = siteConfig.firefoxAddonsUrl;
      if (siteConfig.releasesUrl) data.downloadUrl = siteConfig.releasesUrl;
      if (siteConfig.repositoryUrl) data.codeRepository = siteConfig.repositoryUrl;
      if (siteConfig.firefoxAddonsUrl && siteConfig.repositoryUrl) {
        data.sameAs = [siteConfig.firefoxAddonsUrl, siteConfig.repositoryUrl];
      }
      const formattedJson = JSON.stringify(data, null, 2)
        .split('\n')
        .map((line) => `${indent}${line}`)
        .join('\n');
      return `${indent}${openTag}\n${formattedJson}\n${indent}${closeTag}`;
    }
  );
}

function resolveGitLastmodDate(relRepoPath) {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', relRepoPath], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  if (dirty) {
    return new Date().toISOString().slice(0, 10);
  }
  const commitIso = execFileSync('git', ['log', '-1', '--format=%cI', '--', relRepoPath], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  if (!commitIso) return '';
  const parsed = new Date(commitIso);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function extractExistingSitemapDates(rawXml) {
  const dates = new Map();
  for (const block of String(rawXml || '').matchAll(/<url>[\s\S]*?<\/url>/g)) {
    const loc = block[0].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    const lastmod = block[0].match(/<lastmod>([^<]*)<\/lastmod>/)?.[1]?.trim();
    if (loc && lastmod && /^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
      dates.set(loc, lastmod);
    }
  }
  return dates;
}

function syncSitemapAndRobots(siteConfig, writeOrCheck) {
  if (!siteConfig?.baseUrl || !Array.isArray(siteConfig.pages)) return;
  const baseUrl = String(siteConfig.baseUrl).replace(/\/+$/, '');

  // Generate website/robots.txt from site.config.json baseUrl
  const robotsPath = path.join(WEBSITE_DIR, 'robots.txt');
  const prevRobots = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : '';
  const nextRobots = `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
  writeOrCheck(robotsPath, prevRobots, nextRobots);

  // Generate website/sitemap.xml from site.config.json pages
  const sitemapPath = path.join(WEBSITE_DIR, 'sitemap.xml');
  const prevSitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';
  const fallbackDates = extractExistingSitemapDates(prevSitemap);
  const todayUtc = new Date().toISOString().slice(0, 10);

  let canQueryGitHistory = false;
  try {
    const isShallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    canQueryGitHistory = isShallow === 'false';
  } catch {
    canQueryGitHistory = false;
  }

  const resolveDateFor = (loc, repoRel) => {
    if (canQueryGitHistory) {
      try {
        const d = resolveGitLastmodDate(repoRel);
        if (d) return d;
      } catch {
        // fall through to fallback
      }
    }
    return fallbackDates.get(loc) || todayUtc;
  };

  const urlBlocks = [];
  for (const p of siteConfig.pages) {
    const enHref = `${baseUrl}${p.en}`;
    const ptHref = `${baseUrl}${p.pt}`;
    const variants = [
      { loc: enHref, file: `website/${p.enFile}` },
      { loc: ptHref, file: `website/${p.ptFile}` }
    ];
    for (const v of variants) {
      const lastmod = resolveDateFor(v.loc, v.file);
      urlBlocks.push(
        [
          '  <url>',
          `    <loc>${escapeHtml(v.loc)}</loc>`,
          `    <lastmod>${lastmod}</lastmod>`,
          `    <xhtml:link rel="alternate" hreflang="en" href="${escapeHtml(enHref)}"/>`,
          `    <xhtml:link rel="alternate" hreflang="pt-BR" href="${escapeHtml(ptHref)}"/>`,
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(enHref)}"/>`,
          '  </url>'
        ].join('\n')
      );
    }
  }

  const nextSitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urlBlocks,
    '</urlset>',
    ''
  ].join('\n');
  writeOrCheck(sitemapPath, prevSitemap, nextSitemap);
}

function getRepoOwnerAndLicense(siteConfig, pkg) {
  const repoUrl = String(siteConfig?.repositoryUrl || 'https://github.com/WiltonGabriel/WebPullBook').replace(/\/+$/, '');
  let ownerUrl = 'https://github.com/WiltonGabriel';
  try {
    const parsed = new URL(repoUrl);
    const ownerSeg = parsed.pathname.split('/').filter(Boolean)[0];
    if (ownerSeg) ownerUrl = `${parsed.origin}/${ownerSeg}`;
  } catch {
    // keep default ownerUrl
  }
  const spdx = String(pkg?.license || 'AGPL-3.0-or-later');
  const isAgpl = /^AGPL-3\.0/i.test(spdx);
  return {
    ownerUrl,
    licenseUrl: `${repoUrl}/blob/main/LICENSE`,
    enLicenseLabel: isAgpl ? 'GNU AGPLv3 License' : `${spdx} License`,
    ptLicenseLabel: isAgpl ? 'Licença GNU AGPLv3' : `Licença ${spdx}`
  };
}

export function syncWebsite({ checkOnly = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const compatMd = fs.readFileSync(path.join(ROOT, 'docs', 'COMPATIBILITY.md'), 'utf8');
  const presetsEnMd = fs.readFileSync(path.join(ROOT, 'docs', 'READER_PRESETS.md'), 'utf8');
  const presetsPtMd = fs.readFileSync(path.join(ROOT, 'docs', 'READER_PRESETS.pt.md'), 'utf8');

  const drifted = [];
  const updated = [];
  const writeOrCheck = (filePath, prevContent, nextContent) => {
    if (nextContent === prevContent) return;
    const rel = path.relative(ROOT, filePath);
    if (checkOnly) {
      drifted.push(rel);
    } else {
      fs.writeFileSync(filePath, nextContent, 'utf8');
      updated.push(rel);
    }
  };

  const softwareVersion = manifest.version_name || manifest.version;
  const versionLabel = `v${softwareVersion}`;
  const siteConfigPath = path.join(WEBSITE_DIR, 'site.config.json');
  const rawConfig = fs.readFileSync(siteConfigPath, 'utf8');
  const siteConfig = JSON.parse(rawConfig);
  siteConfig.version = manifest.version;
  siteConfig.versionName = softwareVersion;
  if (siteConfig.releasesUrl) {
    const baseRel = String(siteConfig.releasesUrl).replace(/\/+$/, '');
    const isPre = /(?:beta|alpha|rc)/i.test(softwareVersion);
    siteConfig.releasesLatestUrl = isPre ? `${baseRel}/tag/v${manifest.version}` : `${baseRel}/latest`;
  }
  writeOrCheck(siteConfigPath, rawConfig, `${JSON.stringify(siteConfig, null, 2)}\n`);

  const goatCounterConfig = normalizeGoatCounterConfig(siteConfig.analytics);
  const { ownerUrl, licenseUrl, enLicenseLabel, ptLicenseLabel } = getRepoOwnerAndLicense(siteConfig, pkg);

  const compatEn = buildCompatibilityTbodies(compatMd, false);
  const compatPt = buildCompatibilityTbodies(compatMd, true);
  const presetsEnTbody = buildReaderPresetsTbody(presetsEnMd);
  const presetsPtTbody = buildReaderPresetsTbody(presetsPtMd);

  for (const pageEntry of siteConfig.pages || []) {
    for (const isPt of [false, true]) {
      const compatData = isPt ? compatPt : compatEn;
      const presetsTbody = isPt ? presetsPtTbody : presetsEnTbody;
      const relFile = isPt ? pageEntry.ptFile : pageEntry.enFile;
      const filePath = path.join(WEBSITE_DIR, relFile);
      let prevHtml;
      try {
        prevHtml = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }

      let html = prevHtml;

      // 1. Sync compatibility & limitations tables (compatibility.html)
      for (const tierKey of ['compat-tier-1', 'compat-tier-2', 'compat-tier-3', 'compat-tier-4']) {
        html = replaceSyncedTbody(html, tierKey, compatData[tierKey]);
      }

      // 2. Sync Reader Profiles table (features.html)
      html = replaceSyncedTbody(html, 'reader-presets', presetsTbody);

      // 3. Sync compatibility & limitations summary (index.html)
      html = replaceSyncedLimitationsSummary(html, compatData, isPt);

      // 4. Sync footer authorship, derived repo license link, and version line across all pages
      const footerLine = isPt
        ? `<span>Criado e mantido por <a href="${escapeHtml(ownerUrl)}">Wilton Gabriel</a> e contribuidores • <a href="${escapeHtml(licenseUrl)}">${escapeHtml(ptLicenseLabel)}</a> • <span data-wpb-version data-wpb-version-prefix="Versão ">Versão ${versionLabel}</span></span>`
        : `<span>Created and maintained by <a href="${escapeHtml(ownerUrl)}">Wilton Gabriel</a> &amp; contributors • <a href="${escapeHtml(licenseUrl)}">${escapeHtml(enLicenseLabel)}</a> • <span data-wpb-version data-wpb-version-prefix="Version ">Version ${versionLabel}</span></span>`;
      html = html.replace(
        /(<div class="footer-bottom">\s*)<span>[\s\S]*?<\/span><\/span>/,
        (_full, indent) => `${indent}${footerLine}`
      );

      // 5. Sync [data-wpb-version] spans (including any non-footer spans if added)
      html = html.replace(
        /(<span[^>]*data-wpb-version[^>]*>)(?:Versão\s+|Version\s+)?v[0-9A-Za-z.-]+(<\/span>)/g,
        (_, open, close) => {
          const prefixMatch = open.match(/data-wpb-version-prefix="([^"]*)"/);
          const prefix = prefixMatch ? prefixMatch[1] : '';
          return `${open}${prefix}${versionLabel}${close}`;
        }
      );

      // 6. Sync [data-wpb-link] official links and JSON-LD metadata from website/site.config.json
      html = syncConfiguredLinks(html, siteConfig);
      html = syncIndexJsonLd(html, siteConfig, softwareVersion);

      // 7. Sync optional GoatCounter analytics script tag from website/site.config.json
      html = syncGoatCounterScript(html, goatCounterConfig);

      writeOrCheck(filePath, prevHtml, html);
    }
  }

  const notFoundPath = path.join(WEBSITE_DIR, '404.html');
  try {
    const raw404 = fs.readFileSync(notFoundPath, 'utf8');
    const synced404 = syncConfiguredLinks(raw404, siteConfig);
    writeOrCheck(notFoundPath, raw404, synced404);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  syncSitemapAndRobots(siteConfig, writeOrCheck);
  return { drifted, updated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.includes('--check');
  const { drifted, updated } = syncWebsite({ checkOnly });
  if (checkOnly) {
    if (drifted.length > 0) {
      console.error(`Website files out of sync with docs/manifest:\n  - ${drifted.join('\n  - ')}`);
      process.exit(1);
    }
    console.log('[OK] Website is synchronized with docs/COMPATIBILITY.md, docs/READER_PRESETS*.md, and manifest.json.');
  } else {
    console.log(
      `[OK] Synchronized website/ (${updated.length} file(s) updated) from docs/COMPATIBILITY.md, docs/READER_PRESETS*.md, and manifest.json.`
    );
  }
}
