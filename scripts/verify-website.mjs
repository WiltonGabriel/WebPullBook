#!/usr/bin/env node
/**
 * Automated validator for the official WebPullBook static website (website/).
 * Verifies HTML structure, heading hierarchy, internal links, image paths,
 * canonical URLs, bidirectional hreflang tags, Open Graph & Twitter Card metadata,
 * JSON-LD validity, sitemap.xml parity, and robots.txt configuration.
 */
import fs from 'node:fs';
import path from 'node:path';

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
const BASE_URL = siteConfig.baseUrl.replace(/\/+$/, '');

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

// 2. Validate sitemap.xml
const sitemapPath = path.join(SITE_DIR, 'sitemap.xml');
const expectedCanonicalUrls = new Set();
for (const page of siteConfig.pages) {
  expectedCanonicalUrls.add(`${BASE_URL}${page.en}`);
  expectedCanonicalUrls.add(`${BASE_URL}${page.pt}`);
}

if (!fs.existsSync(sitemapPath)) {
  fail('website/sitemap.xml is missing');
} else {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const locMatches = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  for (const expectedUrl of expectedCanonicalUrls) {
    if (!locMatches.includes(expectedUrl)) {
      fail(`sitemap.xml missing <loc>${expectedUrl}</loc>`);
    }
  }
  for (const loc of locMatches) {
    if (!expectedCanonicalUrls.has(loc)) {
      fail(`sitemap.xml contains unexpected <loc>${loc}</loc>`);
    }
  }
}

// 3. Validate each bilingual page pair
const seenTitles = new Map();
const seenDescriptions = new Map();

function extractAttr(tag, attr) {
  const rx = new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, 'i');
  return tag.match(rx)?.[1] ?? null;
}

for (const page of siteConfig.pages) {
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

    const htmlLangMatch = html.match(/<html\b[^>]*\blang="([^"]+)"/i);
    if (!htmlLangMatch || htmlLangMatch[1] !== v.htmlLang) {
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

    // Meta description
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    const desc = descMatch?.[1]?.trim() || '';
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

    // Canonical URL
    const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (!canonicalMatch || canonicalMatch[1] !== v.canonical) {
      fail(`${v.relFile}: canonical "${canonicalMatch?.[1]}" !== expected "${v.canonical}"`);
    }

    // Hreflang links (en, pt-BR, x-default)
    const hreflangs = new Map();
    for (const m of html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/gi)) {
      hreflangs.set(m[1], m[2]);
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

    // Open Graph & Twitter Card
    const requiredMetaProps = ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image'];
    for (const prop of requiredMetaProps) {
      const rx = new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]+)"`, 'i');
      const m = html.match(rx);
      if (!m || !m[1].trim()) {
        fail(`${v.relFile}: missing <meta property="${prop}">`);
      } else if (prop === 'og:url' && m[1] !== v.canonical) {
        fail(`${v.relFile}: og:url (${m[1]}) !== canonical (${v.canonical})`);
      } else if (prop === 'og:image' && m[1] !== siteConfig.socialPreviewImage) {
        fail(`${v.relFile}: og:image (${m[1]}) !== ${siteConfig.socialPreviewImage}`);
      }
    }

    for (const tw of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
      const rx = new RegExp(`<meta\\s+name="${tw}"\\s+content="([^"]+)"`, 'i');
      if (!rx.test(html)) fail(`${v.relFile}: missing <meta name="${tw}">`);
    }

    // Semantic landmarks & heading hierarchy
    if (!/<header\b/i.test(html)) fail(`${v.relFile}: missing <header>`);
    if (!/<nav\b/i.test(html)) fail(`${v.relFile}: missing <nav>`);
    if (!/<main\b/i.test(html)) fail(`${v.relFile}: missing <main>`);
    if (!/<footer\b/i.test(html)) fail(`${v.relFile}: missing <footer>`);
    if (!/aria-current="page"/i.test(html)) fail(`${v.relFile}: missing aria-current="page" in navigation`);
    if (/class="beta-bar"/i.test(html)) fail(`${v.relFile}: must not include top .beta-bar banner`);
    if (!/<select\b[^>]*\bid="lang-select"/i.test(html)) fail(`${v.relFile}: missing #lang-select dropdown`);
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

    // Validate JSON-LD blocks if present
    for (const ld of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
      try {
        JSON.parse(ld[1]);
      } catch (err) {
        fail(`${v.relFile}: invalid JSON-LD block: ${err.message}`);
      }
    }

    // Validate internal links (<a href="..."> and <link rel="stylesheet|icon" href="...">)
    for (const tagMatch of html.matchAll(/<(?:a|link)\b[^>]+>/gi)) {
      const tag = tagMatch[0];
      const href = extractAttr(tag, 'href');
      if (!href || href.startsWith('#') || /^(?:https?:|mailto:)/i.test(href)) continue;
      const cleanHref = href.split('#')[0].split('?')[0];
      if (!cleanHref) continue;
      const resolved = cleanHref.startsWith('/WebPullBook/')
        ? path.join(SITE_DIR, cleanHref.replace(/^\/WebPullBook\//, ''))
        : path.resolve(fileDir, cleanHref);
      if (!fs.existsSync(resolved)) {
        fail(`${v.relFile}: broken internal link "${href}" -> ${resolved}`);
      }
      if (!resolved.startsWith(SITE_DIR)) {
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
      const resolved = src.startsWith('/WebPullBook/')
        ? path.join(SITE_DIR, src.replace(/^\/WebPullBook\//, ''))
        : path.resolve(fileDir, src);
      if (!fs.existsSync(resolved)) {
        fail(`${v.relFile}: missing image file "${src}" -> ${resolved}`);
      }
      if (!resolved.startsWith(SITE_DIR)) {
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
      const resolved = src.startsWith('/WebPullBook/')
        ? path.join(SITE_DIR, src.replace(/^\/WebPullBook\//, ''))
        : path.resolve(fileDir, src);
      if (!fs.existsSync(resolved)) {
        fail(`${v.relFile}: missing script file "${src}" -> ${resolved}`);
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

    const configuredLinks = {
      firefoxAddons: siteConfig.firefoxAddonsUrl,
      releases: siteConfig.releasesUrl,
      releasesLatest: siteConfig.releasesLatestUrl,
      repository: siteConfig.repositoryUrl,
      issues: siteConfig.issuesUrl
    };
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

// 4. Verify social preview image exists inside website/assets/images/social-preview.png
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
