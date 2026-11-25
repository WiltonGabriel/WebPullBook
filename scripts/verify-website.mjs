#!/usr/bin/env node
/**
 * Automated validator for the official WebPullBook static website (website/).
 * Verifies HTML structure, heading hierarchy, internal links, image paths,
 * canonical URLs, bidirectional hreflang tags, Open Graph & Twitter Card metadata,
 * JSON-LD validity, sitemap.xml parity & xhtml:link alternates, Reader Presets parity,
 * privacy permissions parity, and robots.txt configuration.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfiguredLinkMap, parseMarkdownSections } from './sync-website.mjs';
import { READER_PRESETS } from '../src/workspace/state.js';

const SITE_DIR = path.resolve('website');
const errors = [];

function fail(msg) {
  errors.push(msg);
}

if (!fs.existsSync(SITE_DIR)) {
  console.error('website/ directory not found');
  process.exit(1);
}

const configPath = path.join(SITE_DIR, 'site.config.json');
if (!fs.existsSync(configPath)) {
  console.error('website/site.config.json not found');
  process.exit(1);
}

const siteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const BASE_URL = String(siteConfig.baseUrl || '').replace(/\/+$/, '');
let BASE_PATH = '/';
try {
  const pathname = new URL(BASE_URL).pathname;
  BASE_PATH = pathname.endsWith('/') ? pathname : `${pathname}/`;
} catch {
  fail(`website/site.config.json: invalid baseUrl (${siteConfig.baseUrl})`);
}

const manifestPath = path.resolve('manifest.json');
const pkgPath = path.resolve('package.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null;
const expectedSoftwareVersion = manifest?.version_name || manifest?.version || '';
const expectedVersionLabel = expectedSoftwareVersion ? `v${expectedSoftwareVersion}` : '';

function isInsideSiteDir(targetPath) {
  const rel = path.relative(SITE_DIR, targetPath);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAttr(tag, attr) {
  const rx = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*"([^"]*)"`, 'i');
  return tag.match(rx)?.[1] ?? null;
}

function findMetaContent(html, attrName, attrValue) {
  const target = attrValue.toLowerCase();
  for (const m of html.matchAll(/<meta\b[^>]+>/gi)) {
    const val = extractAttr(m[0], attrName);
    if (val && val.toLowerCase() === target) {
      return extractAttr(m[0], 'content');
    }
  }
  return null;
}

function resolveSiteHref(rawHref, baseFileDir) {
  const cleanHref = rawHref.split('#')[0].split('?')[0];
  if (!cleanHref) return null;
  if (cleanHref.startsWith(BASE_PATH)) {
    const rel = cleanHref.slice(BASE_PATH.length);
    if (!rel) return path.join(SITE_DIR, 'index.html');
    return path.join(SITE_DIR, rel.endsWith('/') ? `${rel}index.html` : rel);
  }
  return path.resolve(baseFileDir, cleanHref);
}

if (manifest) {
  if (!siteConfig.version || siteConfig.version !== manifest.version) {
    fail(`website/site.config.json: version (${siteConfig.version}) !== manifest.json (${manifest.version})`);
  }
  if (!siteConfig.versionName || siteConfig.versionName !== expectedSoftwareVersion) {
    fail(`website/site.config.json: versionName (${siteConfig.versionName}) !== expected (${expectedSoftwareVersion})`);
  }
}
if (pkg && manifest && pkg.version !== manifest.version) {
  fail(`package.json version (${pkg.version}) !== manifest.json (${manifest.version})`);
}

const BASIC_HTML_ENTITIES = new Map([
  ['&amp;', '&'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&lt;', '<'],
  ['&gt;', '>']
]);

function decodeBasicHtmlEntities(str) {
  return String(str || '').replace(/&(?:amp|quot|#39|lt|gt);/g, (entity) => BASIC_HTML_ENTITIES.get(entity) || entity);
}

// Validate Firefox Add-ons canonical URL
if (typeof siteConfig.firefoxAddonsUrl !== 'string' || !siteConfig.firefoxAddonsUrl.trim()) {
  fail('website/site.config.json: firefoxAddonsUrl must be a non-empty HTTPS URL');
} else {
  const amoRaw = siteConfig.firefoxAddonsUrl.trim();
  try {
    const amoUrl = new URL(amoRaw);
    if (amoUrl.protocol !== 'https:') {
      fail(`website/site.config.json: firefoxAddonsUrl must use https: (${amoRaw})`);
    }
    if (amoUrl.hostname !== 'addons.mozilla.org') {
      fail(`website/site.config.json: firefoxAddonsUrl hostname must be addons.mozilla.org (${amoRaw})`);
    }
  } catch {
    fail(`website/site.config.json: invalid firefoxAddonsUrl URL (${amoRaw})`);
  }
}

// 0. Validate GoatCounter analytics configuration
const analyticsCfg = siteConfig.analytics;
let analyticsEndpoint = '';
let analyticsScriptSrc = 'https://gc.zgo.at/count.js';

if (!analyticsCfg || typeof analyticsCfg !== 'object' || Array.isArray(analyticsCfg)) {
  fail('website/site.config.json: missing analytics configuration object');
} else {
  if (analyticsCfg.provider !== 'goatcounter') {
    fail(`website/site.config.json: analytics.provider must be "goatcounter" (found "${analyticsCfg.provider}")`);
  }
  if (typeof analyticsCfg.scriptSrc !== 'string' || !analyticsCfg.scriptSrc.trim()) {
    fail('website/site.config.json: analytics.scriptSrc must be a non-empty HTTPS URL');
  } else {
    analyticsScriptSrc = analyticsCfg.scriptSrc.trim();
    try {
      const scriptUrl = new URL(analyticsScriptSrc);
      if (scriptUrl.protocol !== 'https:') {
        fail(`website/site.config.json: analytics.scriptSrc must use https: (${analyticsScriptSrc})`);
      }
    } catch {
      fail(`website/site.config.json: invalid analytics.scriptSrc URL (${analyticsScriptSrc})`);
    }
  }

  if (typeof analyticsCfg.endpoint !== 'string') {
    fail('website/site.config.json: analytics.endpoint must be a string (empty until configured)');
  } else {
    analyticsEndpoint = analyticsCfg.endpoint.trim();
    if (analyticsEndpoint) {
      if (/(?:your[-_]?code|mycode|example\.com|placeholder|[<>])/i.test(analyticsEndpoint)) {
        fail(`website/site.config.json: analytics.endpoint contains placeholder text (${analyticsEndpoint})`);
      } else {
        try {
          const endpointUrl = new URL(analyticsEndpoint);
          if (endpointUrl.protocol !== 'https:') {
            fail(`website/site.config.json: analytics.endpoint must use https: (${analyticsEndpoint})`);
          }
          if (!endpointUrl.pathname.endsWith('/count')) {
            fail(`website/site.config.json: analytics.endpoint pathname must end with /count (${analyticsEndpoint})`);
          }
        } catch {
          fail(`website/site.config.json: invalid analytics.endpoint URL (${analyticsEndpoint})`);
        }
      }
    }
  }
}

// 1. Validate robots.txt
const robotsPath = path.join(SITE_DIR, 'robots.txt');
if (!fs.existsSync(robotsPath)) {
  fail('website/robots.txt is missing');
} else {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  if (!robots.includes('User-agent: *')) fail('robots.txt missing User-agent: *');
  if (!robots.includes(`Sitemap: ${BASE_URL}/sitemap.xml`)) {
    fail(`robots.txt must reference Sitemap: ${BASE_URL}/sitemap.xml`);
  }
}
if (!fs.existsSync(path.join(SITE_DIR, 'favicon.ico'))) fail('Missing website/favicon.ico');
for (const iconAsset of ['icon.svg', 'icon-32.png', 'icon-48.png', 'icon-128.png']) {
  if (!fs.existsSync(path.join(SITE_DIR, 'assets', 'images', iconAsset))) {
    fail(`Missing website/assets/images/${iconAsset}`);
  }
}

// 2. Validate sitemap.xml (<loc>, <lastmod>, and <xhtml:link> parity)
const sitemapPath = path.join(SITE_DIR, 'sitemap.xml');
const expectedUrlAlts = new Map();
for (const page of siteConfig.pages || []) {
  const enUrl = `${BASE_URL}${page.en}`;
  const ptUrl = `${BASE_URL}${page.pt}`;
  const alts = { en: enUrl, 'pt-BR': ptUrl, 'x-default': enUrl };
  expectedUrlAlts.set(enUrl, alts);
  expectedUrlAlts.set(ptUrl, alts);
}

if (!fs.existsSync(sitemapPath)) {
  fail('website/sitemap.xml is missing');
} else {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const seenLocs = new Set();
  for (const urlBlock of sitemap.matchAll(/<url>[\s\S]*?<\/url>/g)) {
    const block = urlBlock[0];
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    if (!loc) {
      fail('sitemap.xml contains <url> block without <loc>');
      continue;
    }
    if (seenLocs.has(loc)) {
      fail(`sitemap.xml contains duplicate <loc>${loc}</loc>`);
    }
    seenLocs.add(loc);
    const alts = expectedUrlAlts.get(loc);
    if (!alts) {
      fail(`sitemap.xml contains unexpected <loc>${loc}</loc>`);
      continue;
    }
    const lastmod = block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1]?.trim() || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
      fail(`sitemap.xml: invalid or missing <lastmod> for ${loc}: "${lastmod}"`);
    }
    const blockLinks = new Map();
    for (const xMatch of block.matchAll(/<xhtml:link\b[^>]+>/gi)) {
      const hl = extractAttr(xMatch[0], 'hreflang');
      const hr = extractAttr(xMatch[0], 'href');
      if (hl && hr) blockLinks.set(hl, hr);
    }
    for (const [langKey, expectedHref] of Object.entries(alts)) {
      if (blockLinks.get(langKey) !== expectedHref) {
        fail(`sitemap.xml: ${loc} hreflang="${langKey}" (${blockLinks.get(langKey)}) !== "${expectedHref}"`);
      }
    }
  }
  for (const expectedUrl of expectedUrlAlts.keys()) {
    if (!seenLocs.has(expectedUrl)) {
      fail(`sitemap.xml missing <loc>${expectedUrl}</loc>`);
    }
  }
}

// 2b. Validate Reader Presets Markdown vs src/workspace/state.js READERS_PRESETS
const expectedPresetIds = new Set([...Object.keys(READER_PRESETS), 'custom']);
for (const presetFile of ['docs/READER_PRESETS.md', 'docs/pt/READER_PRESETS.pt.md']) {
  const absPreset = path.resolve(presetFile);
  if (!fs.existsSync(absPreset)) {
    fail(`Missing ${presetFile}`);
    continue;
  }
  const tables = parseMarkdownSections(fs.readFileSync(absPreset, 'utf8'));
  let rows = [];
  for (const tbl of tables.values()) {
    if (tbl.rows.length > 0) {
      rows = tbl.rows;
      break;
    }
  }
  if (rows.length !== expectedPresetIds.size) {
    fail(`${presetFile}: expected ${expectedPresetIds.size} profile rows (matching READER_PRESETS + custom), found ${rows.length}`);
  }
  const docIds = new Set(rows.map((r) => r[0]?.match(/`([a-z0-9-]+)`/i)?.[1]).filter(Boolean));
  for (const id of expectedPresetIds) {
    if (!docIds.has(id)) {
      fail(`${presetFile}: profile comparison table missing \`${id}\``);
    }
  }
}

// 3. Validate each bilingual page pair
const seenTitles = new Map();
const seenDescriptions = new Map();
const configuredLinks = getConfiguredLinkMap(siteConfig);
const minGeckoMajor = String(manifest?.browser_specific_settings?.gecko?.strict_min_version || '128').split('.')[0];

for (const page of siteConfig.pages || []) {
  const variants = [
    {
      locale: 'en',
      htmlLang: 'en',
      relFile: page.enFile,
      canonical: `${BASE_URL}${page.en}`,
      enAlt: `${BASE_URL}${page.en}`,
      ptAlt: `${BASE_URL}${page.pt}`
    },
    {
      locale: 'pt-BR',
      htmlLang: 'pt-BR',
      relFile: page.ptFile,
      canonical: `${BASE_URL}${page.pt}`,
      enAlt: `${BASE_URL}${page.en}`,
      ptAlt: `${BASE_URL}${page.pt}`
    }
  ];

  for (const v of variants) {
    const filePath = path.join(SITE_DIR, v.relFile);
    if (!fs.existsSync(filePath)) {
      fail(`Missing website page: ${v.relFile}`);
      continue;
    }

    const html = fs.readFileSync(filePath, 'utf8');
    const fileDir = path.dirname(filePath);

    if (!/^<!DOCTYPE html>/i.test(html.trimStart())) {
      fail(`${v.relFile}: missing <!DOCTYPE html>`);
    }

    const htmlLangMatch = html.match(/<html\b[^>]*>/i);
    const actualLang = htmlLangMatch ? extractAttr(htmlLangMatch[0], 'lang') : null;
    if (actualLang !== v.htmlLang) {
      fail(`${v.relFile}: expected <html lang="${v.htmlLang}">`);
    }

    // Unique <title>
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || '';
    const decodedTitle = decodeBasicHtmlEntities(title);
    if (!title || decodedTitle.length < 15) {
      fail(`${v.relFile}: missing or too short <title>`);
    } else if (decodedTitle.length > 70) {
      fail(`${v.relFile}: <title> exceeds 70 chars (${decodedTitle.length}): "${decodedTitle}"`);
    } else if (seenTitles.has(title)) {
      fail(`${v.relFile}: duplicate <title> with ${seenTitles.get(title)}: "${title}"`);
    } else {
      seenTitles.set(title, v.relFile);
    }

    // Meta description (attribute-order independent)
    const desc = (findMetaContent(html, 'name', 'description') || '').trim();
    const decodedDesc = decodeBasicHtmlEntities(desc);
    if (!desc || decodedDesc.length < 50) {
      fail(`${v.relFile}: missing or too short meta description`);
    } else if (decodedDesc.length > 165) {
      fail(`${v.relFile}: meta description exceeds 165 chars (${decodedDesc.length})`);
    } else if (seenDescriptions.has(desc)) {
      fail(`${v.relFile}: duplicate meta description with ${seenDescriptions.get(desc)}`);
    } else {
      seenDescriptions.set(desc, v.relFile);
    }

    // Canonical URL & hreflang links (attribute-order independent)
    let canonicalActual = null;
    const hreflangs = new Map();
    for (const linkMatch of html.matchAll(/<link\b[^>]+>/gi)) {
      const tag = linkMatch[0];
      const rel = extractAttr(tag, 'rel')?.toLowerCase();
      const href = extractAttr(tag, 'href');
      if (rel === 'canonical' && href) {
        canonicalActual = href;
      } else if (rel === 'alternate') {
        const hl = extractAttr(tag, 'hreflang');
        if (hl && href) hreflangs.set(hl, href);
      }
    }
    if (canonicalActual !== v.canonical) {
      fail(`${v.relFile}: canonical "${canonicalActual}" !== expected "${v.canonical}"`);
    }
    if (hreflangs.get('en') !== v.enAlt) {
      fail(`${v.relFile}: hreflang="en" (${hreflangs.get('en')}) !== ${v.enAlt}`);
    }
    if (hreflangs.get('pt-BR') !== v.ptAlt) {
      fail(`${v.relFile}: hreflang="pt-BR" (${hreflangs.get('pt-BR')}) !== ${v.ptAlt}`);
    }
    if (hreflangs.get('x-default') !== v.enAlt) {
      fail(`${v.relFile}: hreflang="x-default" (${hreflangs.get('x-default')}) !== ${v.enAlt}`);
    }

    // Open Graph & Twitter Card (attribute-order independent)
    const requiredMetaProps = ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image'];
    for (const prop of requiredMetaProps) {
      const val = findMetaContent(html, 'property', prop);
      if (!val || !val.trim()) {
        fail(`${v.relFile}: missing <meta property="${prop}">`);
      } else if (prop === 'og:url' && val !== v.canonical) {
        fail(`${v.relFile}: og:url (${val}) !== canonical (${v.canonical})`);
      } else if (prop === 'og:image' && val !== siteConfig.socialPreviewImage) {
        fail(`${v.relFile}: og:image (${val}) !== ${siteConfig.socialPreviewImage}`);
      }
    }

    for (const tw of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      const val = findMetaContent(html, 'name', tw);
      if (!val || !val.trim()) {
        fail(`${v.relFile}: missing <meta name="${tw}">`);
      } else if (tw === 'twitter:image' && val !== siteConfig.socialPreviewImage) {
        fail(`${v.relFile}: twitter:image (${val}) !== ${siteConfig.socialPreviewImage}`);
      }
    }

    // Semantic landmarks, dead attribute hygiene & heading hierarchy
    if (!/<header\b/i.test(html)) fail(`${v.relFile}: missing <header>`);
    if (!/<nav\b/i.test(html)) fail(`${v.relFile}: missing <nav>`);
    if (!/<main\b/i.test(html)) fail(`${v.relFile}: missing <main>`);
    if (!/<footer\b/i.test(html)) fail(`${v.relFile}: missing <footer>`);
    if (!/aria-current="page"/i.test(html)) fail(`${v.relFile}: missing aria-current="page" in navigation`);
    if (/class="beta-bar"/i.test(html)) fail(`${v.relFile}: must not include top .beta-bar banner`);
    if (!/<button\b[^>]*\bid="prefs-toggle"[^>]*\bpopovertarget="prefs-panel"/i.test(html)) {
      fail(`${v.relFile}: missing #prefs-toggle popover button`);
    }
    if (/\baria-haspopup=/i.test(html) || /\brole="menu"/i.test(html)) {
      fail(`${v.relFile}: prefs popover must not declare role="menu" or aria-haspopup`);
    }
    if (!/<div\b[^>]*\bid="prefs-panel"[^>]*\bpopover="auto"/i.test(html)) {
      fail(`${v.relFile}: missing #prefs-panel popover container`);
    }
    if (!/favicon\.ico"/i.test(html) || !/apple-touch-icon"/i.test(html)) {
      fail(`${v.relFile}: missing favicon.ico or apple-touch-icon link tag`);
    }
    if (!/<select\b[^>]*\bid="lang-select"/i.test(html)) fail(`${v.relFile}: missing #lang-select dropdown`);
    if (/\bdata-href="/i.test(html)) fail(`${v.relFile}: must not contain unused data-href attributes`);
    if (!/<select\b[^>]*\bid="theme-select"/i.test(html)) fail(`${v.relFile}: missing #theme-select dropdown`);
    if (!/class="nav-github-link"/i.test(html)) fail(`${v.relFile}: missing .nav-github-link in header navigation`);
    for (const themeOpt of ['system', 'light', 'dark', 'sepia', 'midnight']) {
      if (!new RegExp(`<option\\s+value="${themeOpt}"`, 'i').test(html)) {
        fail(`${v.relFile}: #theme-select missing option value="${themeOpt}"`);
      }
    }
    if (/🇺🇸|🇧🇷/.test(html)) fail(`${v.relFile}: must not contain country flag emojis`);
    if (/Download\s*\(\.zip\)|Baixar\s*\(\.zip\)/i.test(html)) {
      fail(`${v.relFile}: must not contain Download (.zip) / Baixar (.zip) button`);
    }

    for (const syncedTbody of html.matchAll(/<tbody[^>]*\bdata-sync-table="([^"]+)"[^>]*>([\s\S]*?)<\/tbody>/gi)) {
      if (!/<tr\b/i.test(syncedTbody[2])) {
        fail(`${v.relFile}: synced table data-sync-table="${syncedTbody[1]}" is empty`);
      }
    }

    const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => Number(m[1]));
    const h1Count = headings.filter((lvl) => lvl === 1).length;
    if (h1Count !== 1) {
      fail(`${v.relFile}: expected exactly 1 <h1>, found ${h1Count}`);
    }
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] > headings[i - 1] + 1) {
        fail(`${v.relFile}: heading hierarchy skipped from <h${headings[i - 1]}> to <h${headings[i]}>`);
      }
    }

    // Validate JSON-LD blocks (SoftwareApplication & FAQPage)
    for (const ld of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(ld[1]);
        if (data?.['@type'] === 'SoftwareApplication') {
          if (expectedSoftwareVersion && data.softwareVersion !== expectedSoftwareVersion) {
            fail(`${v.relFile}: JSON-LD softwareVersion "${data.softwareVersion}" !== "${expectedSoftwareVersion}"`);
          }
          if (data.installUrl !== siteConfig.firefoxAddonsUrl) {
            fail(`${v.relFile}: JSON-LD installUrl "${data.installUrl}" !== "${siteConfig.firefoxAddonsUrl}"`);
          }
          if (data.downloadUrl !== siteConfig.releasesUrl) {
            fail(`${v.relFile}: JSON-LD downloadUrl "${data.downloadUrl}" !== "${siteConfig.releasesUrl}"`);
          }
          if (data.codeRepository !== siteConfig.repositoryUrl) {
            fail(`${v.relFile}: JSON-LD codeRepository "${data.codeRepository}" !== "${siteConfig.repositoryUrl}"`);
          }
          const expectedSameAs = [siteConfig.firefoxAddonsUrl, siteConfig.repositoryUrl];
          if (JSON.stringify(data.sameAs) !== JSON.stringify(expectedSameAs)) {
            fail(`${v.relFile}: JSON-LD sameAs out of sync with site.config.json`);
          }
        } else if (data?.['@type'] === 'FAQPage') {
          if (data.inLanguage !== v.htmlLang) {
            fail(`${v.relFile}: JSON-LD FAQPage inLanguage "${data.inLanguage}" !== "${v.htmlLang}"`);
          }
        }
      } catch (err) {
        fail(`${v.relFile}: invalid JSON-LD block: ${err.message}`);
      }
    }

    if (expectedVersionLabel) {
      const exactVerRx = new RegExp(`(?:^|\\s)${escapeRegExp(expectedVersionLabel)}$`);
      for (const verSpan of html.matchAll(/<span[^>]*\bdata-wpb-version\b[^>]*>([\s\S]*?)<\/span>/gi)) {
        const cleanText = verSpan[1].trim();
        if (!exactVerRx.test(cleanText)) {
          fail(`${v.relFile}: [data-wpb-version] "${cleanText}" does not match exact "${expectedVersionLabel}"`);
        }
      }
    }

    // Validate privacy permissions parity & Firefox min-version parity
    if (manifest && (page.id === 'privacy')) {
      for (const perm of [...(manifest.permissions || []), ...(manifest.host_permissions || [])]) {
        if (!html.includes(`<code>${perm}</code>`)) {
          fail(`${v.relFile}: missing manifest permission documentation for "${perm}"`);
        }
      }
      if (!html.includes('120..129')) {
        fail(`${v.relFile}: missing DNR image Referer rule documentation (120..129)`);
      }
    }
    if (manifest && (page.id === 'installation' || page.id === 'compatibility')) {
      if (!html.includes(`${minGeckoMajor}+`)) {
        fail(`${v.relFile}: missing Firefox min version "${minGeckoMajor}+" from manifest.json`);
      }
    }

    // Validate internal links (<a href="..."> and <link rel="stylesheet|icon" href="...">)
    for (const tagMatch of html.matchAll(/<(?:a|link)\b[^>]+>/gi)) {
      const tag = tagMatch[0];
      const href = extractAttr(tag, 'href');
      if (!href || href.startsWith('#') || /^(?:https?:|mailto:)/i.test(href)) continue;
      const resolved = resolveSiteHref(href, fileDir);
      if (!resolved) continue;
      if (!fs.existsSync(resolved)) {
        fail(`${v.relFile}: broken internal link "${href}" -> ${resolved}`);
      }
      if (!isInsideSiteDir(resolved)) {
        fail(`${v.relFile}: link "${href}" escapes website/ directory`);
      }
    }

    // Validate images (<img src="..." alt="..." width="..." height="...">) and <script src="...">
    for (const imgMatch of html.matchAll(/<img\b[^>]+>/gi)) {
      const tag = imgMatch[0];
      const src = extractAttr(tag, 'src');
      const alt = extractAttr(tag, 'alt');
      const width = extractAttr(tag, 'width');
      const height = extractAttr(tag, 'height');
      if (!src) {
        fail(`${v.relFile}: <img> missing src attribute`);
        continue;
      }
      if (alt === null) fail(`${v.relFile}: <img src="${src}"> missing alt attribute`);
      if (!width || !height) fail(`${v.relFile}: <img src="${src}"> missing width or height attribute`);
      const resolved = resolveSiteHref(src, fileDir);
      if (!resolved || !fs.existsSync(resolved)) {
        fail(`${v.relFile}: missing image file "${src}" -> ${resolved}`);
      } else if (!isInsideSiteDir(resolved)) {
        fail(`${v.relFile}: image "${src}" escapes website/ directory`);
      }
    }

    const goatCounterTags = [];
    for (const scriptMatch of html.matchAll(/<script\b[^>]+>/gi)) {
      const tag = scriptMatch[0];
      const dataGoatCounter = extractAttr(tag, 'data-goatcounter');
      const src = extractAttr(tag, 'src');
      if (dataGoatCounter !== null) {
        goatCounterTags.push(tag);
        if (dataGoatCounter !== analyticsEndpoint) {
          fail(`${v.relFile}: data-goatcounter="${dataGoatCounter}" !== expected "${analyticsEndpoint}"`);
        }
        if (src !== analyticsScriptSrc) {
          fail(`${v.relFile}: GoatCounter script src "${src}" !== expected "${analyticsScriptSrc}"`);
        }
        if (!/\basync\b/i.test(tag)) {
          fail(`${v.relFile}: GoatCounter script must include the async attribute`);
        }
        continue;
      }
      if (!src) continue;
      const resolved = resolveSiteHref(src, fileDir);
      if (!resolved || !fs.existsSync(resolved)) {
        fail(`${v.relFile}: missing script file "${src}" -> ${resolved}`);
      } else if (!isInsideSiteDir(resolved)) {
        fail(`${v.relFile}: script "${src}" escapes website/ directory`);
      }
    }

    if (analyticsEndpoint) {
      if (goatCounterTags.length === 0) {
        fail(`${v.relFile}: missing GoatCounter script tag for configured endpoint "${analyticsEndpoint}"`);
      } else if (goatCounterTags.length > 1) {
        fail(`${v.relFile}: duplicate GoatCounter script tags found (${goatCounterTags.length})`);
      }
    } else if (goatCounterTags.length > 0) {
      fail(`${v.relFile}: unexpected GoatCounter script tag while analytics.endpoint is empty`);
    }

    for (const aMatch of html.matchAll(/<a\b[^>]*\bdata-wpb-link="([^"]+)"[^>]*>/gi)) {
      const key = aMatch[1];
      const expectedHref = configuredLinks[key];
      const actualHref = extractAttr(aMatch[0], 'href');
      if (!expectedHref) {
        fail(`${v.relFile}: unknown data-wpb-link="${key}"`);
      } else if (actualHref !== expectedHref) {
        fail(`${v.relFile}: data-wpb-link="${key}" href="${actualHref}" !== "${expectedHref}"`);
      }
    }
  }
}

// 4. Verify 404.html exists and references valid local assets, images, scripts & configured links
const notFoundPath = path.join(SITE_DIR, '404.html');
if (!fs.existsSync(notFoundPath)) {
  fail('Missing website/404.html');
} else {
  const html404 = fs.readFileSync(notFoundPath, 'utf8');
  if (!/^<!DOCTYPE html>/i.test(html404.trimStart())) fail('404.html: missing <!DOCTYPE html>');
  if (!/<h1\b[^>]*>/i.test(html404)) fail('404.html: missing <h1>');
  for (const tagMatch of html404.matchAll(/<(?:a|link)\b[^>]+>/gi)) {
    const href = extractAttr(tagMatch[0], 'href');
    if (!href || href.startsWith('#') || /^(?:https?:|mailto:)/i.test(href)) continue;
    const resolved = resolveSiteHref(href, SITE_DIR);
    if (!resolved || !fs.existsSync(resolved)) {
      fail(`404.html: broken internal link "${href}" -> ${resolved}`);
    } else if (!isInsideSiteDir(resolved)) {
      fail(`404.html: link "${href}" escapes website/ directory`);
    }
  }
  for (const imgMatch of html404.matchAll(/<img\b[^>]+>/gi)) {
    const src = extractAttr(imgMatch[0], 'src');
    if (!src) {
      fail('404.html: <img> missing src attribute');
      continue;
    }
    const resolved = resolveSiteHref(src, SITE_DIR);
    if (!resolved || !fs.existsSync(resolved)) {
      fail(`404.html: missing image file "${src}" -> ${resolved}`);
    } else if (!isInsideSiteDir(resolved)) {
      fail(`404.html: image "${src}" escapes website/ directory`);
    }
  }
  for (const scriptMatch of html404.matchAll(/<script\b[^>]+>/gi)) {
    const src = extractAttr(scriptMatch[0], 'src');
    if (!src) continue;
    const resolved = resolveSiteHref(src, SITE_DIR);
    if (!resolved || !fs.existsSync(resolved)) {
      fail(`404.html: missing script file "${src}" -> ${resolved}`);
    } else if (!isInsideSiteDir(resolved)) {
      fail(`404.html: script "${src}" escapes website/ directory`);
    }
  }
  for (const aMatch of html404.matchAll(/<a\b[^>]*\bdata-wpb-link="([^"]+)"[^>]*>/gi)) {
    const key = aMatch[1];
    const expectedHref = configuredLinks[key];
    const actualHref = extractAttr(aMatch[0], 'href');
    if (!expectedHref) {
      fail(`404.html: unknown data-wpb-link="${key}"`);
    } else if (actualHref !== expectedHref) {
      fail(`404.html: data-wpb-link="${key}" href="${actualHref}" !== "${expectedHref}"`);
    }
  }
}

// 5. Verify social preview image exists inside website/assets/images/social-preview.png
const socialImgPath = path.join(SITE_DIR, 'assets', 'images', 'social-preview.png');
if (!fs.existsSync(socialImgPath)) {
  fail('Missing website/assets/images/social-preview.png');
}

if (errors.length > 0) {
  console.error('\nWebsite verification failed:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

const goatCounterStatus = analyticsEndpoint
  ? `GoatCounter active: ${analyticsEndpoint}`
  : 'GoatCounter ready: endpoint pending in website/site.config.json';
console.log(
  `[OK] Website verified (${siteConfig.pages.length * 2} bilingual pages, sitemap.xml, robots.txt, links, images, canonicals, hreflang, social metadata, and ${goatCounterStatus}).`
);
