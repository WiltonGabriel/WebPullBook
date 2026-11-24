#!/usr/bin/env node
import fs from 'node:fs';

const rawTag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const outPath = process.argv[3] || '';
const cleanVer = rawTag.replace(/^v/i, '');
const baseVer = cleanVer.split('-')[0];

if (!cleanVer) {
  console.error('extract-release-notes: missing release tag/version argument');
  process.exit(1);
}
if (!fs.existsSync('CHANGELOG.md')) {
  console.error('extract-release-notes: CHANGELOG.md not found');
  process.exit(1);
}

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const candidates = [...new Set([cleanVer, baseVer])];
const lines = changelog.split(/\r?\n/);

let startIdx = -1;
let headingLine = '';
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^##\s+\[?v?([^\]\s]+)\]?(.*)$/i);
  if (m && candidates.includes(m[1])) {
    startIdx = i + 1;
    const suffixNeeded = !/-beta$/i.test(cleanVer) && !/\(beta\)/i.test(cleanVer) && /\(beta\)/i.test(m[2]);
    headingLine = `## WebPullBook v${cleanVer}${suffixNeeded ? ' (Beta)' : ''}`;
    break;
  }
}

if (startIdx === -1) {
  console.error(`extract-release-notes: no CHANGELOG.md section found for version "${cleanVer}"`);
  process.exit(2);
}

let endIdx = lines.length;
for (let i = startIdx; i < lines.length; i++) {
  if (/^##\s+/.test(lines[i])) {
    endIdx = i;
    break;
  }
}

const sectionBody = lines.slice(startIdx, endIdx).join('\n').trim();
if (!sectionBody) {
  console.error(`extract-release-notes: empty CHANGELOG.md section for version "${cleanVer}"`);
  process.exit(2);
}

const installNote = [
  '### Installation / Update',
  `- **Chrome / Chromium:** Download **\`WebPullBook-v${cleanVer}.zip\`** below, extract it to a folder, open \`chrome://extensions/\` with **Developer mode** enabled, and click **Load unpacked** (or **Reload (\`↻\`)** if already installed).`,
  `- **Mozilla Firefox (128+):** Install directly from [**Firefox Add-ons (AMO)**](https://addons.mozilla.org/firefox/addon/webpullbook/) for signed packages and automatic updates, or download **\`WebPullBook-v${cleanVer}.zip\`** below and load it via \`about:debugging#/runtime/this-firefox\` for temporary testing.`
].join('\n');

const output = `${headingLine}\n\n${sectionBody}\n\n${installNote}\n`;

if (outPath) {
  fs.writeFileSync(outPath, output, 'utf8');
} else {
  process.stdout.write(output);
}
