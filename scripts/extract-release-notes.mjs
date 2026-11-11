#!/usr/bin/env node
import fs from 'node:fs';

const rawTag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const outPath = process.argv[3] || '';
const cleanVer = rawTag.replace(/^v/i, '');
const baseVer = cleanVer.split('-')[0];

if (!cleanVer || !fs.existsSync('CHANGELOG.md')) {
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
    headingLine = `## WebPullBook v${cleanVer}${/\(beta\)/i.test(m[2]) ? ' (Beta)' : ''}`;
    break;
  }
}

if (startIdx === -1) {
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
  process.exit(2);
}

const installNote = [
  '### Instalação / Atualização',
  `1. Baixe **\`WebPullBook-v${cleanVer}.zip\`** abaixo e extraia na pasta da extensão (ou execute \`git pull\`).`,
  '2. Abra `chrome://extensions/` e clique em **Recarregar (`↻`)** no card do **WebPullBook**.'
].join('\n');

const output = `${headingLine}\n\n${sectionBody}\n\n${installNote}\n`;

if (outPath) {
  fs.writeFileSync(outPath, output, 'utf8');
} else {
  process.stdout.write(output);
}
