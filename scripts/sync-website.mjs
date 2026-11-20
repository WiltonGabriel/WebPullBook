#!/usr/bin/env node
/**
 * Synchronizes website/ static HTML and site.config.json from the repository's
 * authoritative documentation and manifest files:
 *  - docs/COMPATIBILITY.md       -> website/compatibility.html, website/pt/compatibility.html, index.html, faq.html
 *  - docs/READER_PRESETS.md      -> website/features.html
 *  - docs/READER_PRESETS.pt.md   -> website/pt/features.html
 *  - manifest.json & CHANGELOG.md -> version strings, JSON-LD softwareVersion, site.config.json
 */

import fs from 'node:fs';
import path from 'node:path';
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

function renderInlineMarkdown(md) {
  let out = escapeHtml(String(md || '').trim());
  // Strip relative markdown links [label](url) -> label
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
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

function parseMarkdownSections(markdown) {
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
    const headers = lines[0]
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    const rows = [];
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
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
  'Uses link-cluster scoring, prose density extraction, heuristic selector assistant, and 🎯 visual picker.':
    'Usa pontuação de clusters de links, extração por densidade de prosa, assistente heurístico de seletores e seletor visual 🎯 Apontar.',
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

function translateCell(text, isPt) {
  const clean = String(text || '').trim();
  if (!isPt) return clean;
  return PT_TRANSLATIONS[clean] || clean;
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

  const indent = '              ';

  const tbody1 = tier1.rows
    .map(([site, adapter, lastVerified, _fixture, notes]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(site, isPt))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(adapter)}</td>`,
        `${indent}  <td>${escapeHtml(lastVerified)}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(notes, isPt))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const tbody2 = tier2.rows
    .map(([site, adapter, status, _fixture, notes]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(site, isPt))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(adapter)}</td>`,
        `${indent}  <td><span class="badge warn">${renderInlineMarkdown(translateCell(status, isPt))}</span></td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(notes, isPt))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const tbody3 = tier3.rows
    .map(([pattern, mode, notes]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(pattern, isPt))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(mode, isPt))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(notes, isPt))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const tbody4 = tier4.rows
    .map(([limitation, reason]) => {
      return [
        `${indent}<tr>`,
        `${indent}  <td>${formatLeadColumn(translateCell(limitation, isPt))}</td>`,
        `${indent}  <td>${renderInlineMarkdown(translateCell(reason, isPt))}</td>`,
        `${indent}</tr>`
      ].join('\n');
    })
    .join('\n');

  const verifiedNames = tier1.rows.map(([site]) => translateCell(site, isPt));
  const limitationNames = tier4.rows.map(([limitation]) =>
    renderInlineMarkdown(translateCell(limitation, isPt))
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
  const indent = '              ';
  return presetTable.rows
    .map((cells) => {
      // Columns in docs/READER_PRESETS*.md:
      // 0: Profile, 1: EPUB Standard, 2: Pop-up Footnotes, 3: Cover JPEG, 4: Image Optimization, 5: Max Resolution, 6: Text Alignment, 7: Recommended For
      const [profile, epubStd, footnotes, coverJpeg, imgOpt, maxRes, _align, recommended] =
        cells.length >= 8 ? cells : [...cells, ''];
      return [
        `${indent}<tr>`,
        `${indent}  <td>${ renderInlineMarkdown(profile) }</td>`,
        `${indent}  <td>${ renderInlineMarkdown(epubStd) }</td>`,
        `${indent}  <td>${ renderInlineMarkdown(footnotes) }</td>`,
        `${indent}  <td>${ renderInlineMarkdown(coverJpeg) }</td>`,
        `${indent}  <td>${ renderInlineMarkdown(imgOpt) }</td>`,
        `${indent}  <td>${ renderInlineMarkdown(maxRes) }</td>`,
        `${indent}  <td>${ renderInlineMarkdown(recommended) }</td>`,
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
  return html.replace(pattern, `$1\n${newInnerRows}\n            $3`);
}

function replaceSyncedLimitationsSummary(html, compatData, isPt) {
  const limList = compatData.limitationNames.join(', ');
  const verList = compatData.verifiedNames.join(', ');
  const summaryHtml = isPt
    ? `O WebPullBook extrai texto em DOM HTML padrão acessível na sessão do navegador (${verList} verificados de ponta a ponta, além de suporte heurístico genérico e modo SPA). Limitações mapeadas em <a href="compatibility.html">docs/COMPATIBILITY.md</a>: ${limList}.`
    : `WebPullBook extracts standard DOM HTML text accessible in your browser session (${verList} verified end-to-end, plus generic heuristic and SPA tab modes). Known limitations tracked in <a href="compatibility.html">docs/COMPATIBILITY.md</a>: ${limList}.`;

  return html.replace(
    /(<p[^>]*data-sync-compat-summary[^>]*>)([\s\S]*?)(<\/p>)/g,
    `$1${summaryHtml}$3`
  );
}

export function syncWebsite() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const compatMd = fs.readFileSync(path.join(ROOT, 'docs', 'COMPATIBILITY.md'), 'utf8');
  const presetsEnMd = fs.readFileSync(path.join(ROOT, 'docs', 'READER_PRESETS.md'), 'utf8');
  const presetsPtMd = fs.readFileSync(path.join(ROOT, 'docs', 'READER_PRESETS.pt.md'), 'utf8');

  const versionLabel = `v${manifest.version_name || manifest.version}`;
  const siteConfigPath = path.join(WEBSITE_DIR, 'site.config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(siteConfigPath, 'utf8'));
    cfg.version = manifest.version;
    cfg.versionName = manifest.version_name || manifest.version;
    fs.writeFileSync(siteConfigPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const compatEn = buildCompatibilityTbodies(compatMd, false);
  const compatPt = buildCompatibilityTbodies(compatMd, true);
  const presetsEnTbody = buildReaderPresetsTbody(presetsEnMd);
  const presetsPtTbody = buildReaderPresetsTbody(presetsPtMd);

  const pages = [
    'index.html',
    'features.html',
    'installation.html',
    'compatibility.html',
    'faq.html',
    'privacy.html',
    'contributing.html'
  ];

  for (const isPt of [false, true]) {
    const compatData = isPt ? compatPt : compatEn;
    const presetsTbody = isPt ? presetsPtTbody : presetsEnTbody;

    for (const page of pages) {
      const filePath = isPt
        ? path.join(WEBSITE_DIR, 'pt', page)
        : path.join(WEBSITE_DIR, page);
      let html;
      try {
        html = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }

      // 1. Sync version labels in [data-wpb-version] and JSON-LD softwareVersion
      html = html.replace(
        /(<span[^>]*data-wpb-version[^>]*>)(?:Versão\s+|Version\s+)?v[0-9A-Za-z.-]+(<\/span>)/g,
        (_, open, close) => {
          const prefixMatch = open.match(/data-wpb-version-prefix="([^"]*)"/);
          const prefix = prefixMatch ? prefixMatch[1] : '';
          return `${open}${prefix}${versionLabel}${close}`;
        }
      );
      html = html.replace(
        /"softwareVersion":\s*"[^"]+"/,
        `"softwareVersion": "${manifest.version_name || manifest.version}"`
      );

      // 2. Sync compatibility & limitations tables (compatibility.html)
      for (const tierKey of ['compat-tier-1', 'compat-tier-2', 'compat-tier-3', 'compat-tier-4']) {
        html = replaceSyncedTbody(html, tierKey, compatData[tierKey]);
      }

      // 3. Sync Reader Profiles table (features.html)
      html = replaceSyncedTbody(html, 'reader-presets', presetsTbody);

      // 4. Sync compatibility & limitations summary (index.html, faq.html)
      html = replaceSyncedLimitationsSummary(html, compatData, isPt);

      // 5. Sync footer authorship & license line across all pages
      const footerLine = isPt
        ? `<span>Criado e mantido por <a href="https://github.com/WiltonGabriel">Wilton Gabriel</a> e contribuidores • <a href="https://github.com/WiltonGabriel/WebPullBook/blob/main/LICENSE">Licença MIT</a> • <span data-wpb-version data-wpb-version-prefix="Versão ">Versão ${versionLabel}</span></span>`
        : `<span>Created and maintained by <a href="https://github.com/WiltonGabriel">Wilton Gabriel</a> &amp; contributors • <a href="https://github.com/WiltonGabriel/WebPullBook/blob/main/LICENSE">MIT License</a> • <span data-wpb-version data-wpb-version-prefix="Version ">Version ${versionLabel}</span></span>`;
      html = html.replace(
        /(<div class="footer-bottom">\s*)<span>[\s\S]*?<\/span><\/span>/,
        `$1${footerLine}`
      );

      fs.writeFileSync(filePath, html, 'utf8');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncWebsite();
  console.log('[OK] Synchronized website/ from docs/COMPATIBILITY.md, docs/READER_PRESETS*.md, and manifest.json.');
}
