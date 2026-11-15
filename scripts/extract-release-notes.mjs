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
  `- **Chrome / Chromium:** Baixe **\`WebPullBook-v${cleanVer}.zip\`** abaixo, extraia para uma pasta, abra \`chrome://extensions/\` com o **Modo do desenvolvedor** ativo e clique em **Carregar sem compactação** (ou **Recarregar (\`↻\`)** se já estiver instalada).`,
  `- **Mozilla Firefox (128+):** Baixe **\`WebPullBook-v${cleanVer}.zip\`**, abra \`about:debugging#/runtime/this-firefox\`, clique em **Carregar extensão temporária...** e selecione o arquivo \`.zip\` diretamente.`
].join('\n');

const output = `${headingLine}\n\n${sectionBody}\n\n${installNote}\n`;

if (outPath) {
  fs.writeFileSync(outPath, output, 'utf8');
} else {
  process.stdout.write(output);
}
