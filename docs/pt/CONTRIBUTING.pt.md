# Como Contribuir com o WebPullBook

[English](../../CONTRIBUTING.md) | **Português**

Este documento é a versão em português do guia oficial de contribuição ([CONTRIBUTING.md](../../CONTRIBUTING.md)). Para regras específicas voltadas a agentes de programação com IA, consulte [AGENTS.md](../../AGENTS.md).

> **Área de Maior Impacto — Desenvolvimento de Parsers:** Ajudar a desenvolver, aprimorar e adicionar **parsers** (tanto na camada genérica `BaseParser` / `GenericHtmlParser` quanto em adaptadores estruturais em `src/parsers/`) é a principal forma de expandir a compatibilidade do WebPullBook. Veja o passo a passo completo em [Como Adicionar um Adaptador de Parser](#como-adicionar-um-adaptador-de-parser).

## Configuração para Desenvolvimento

O WebPullBook utiliza módulos ES nativos e APIs padrão do navegador, **sem etapa de compilação e sem dependências de execução (`dependencies: {}`)**. Qualquer alteração em `src/` passa a valer imediatamente ao recarregar a extensão.

1. Clone o repositório:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   cd WebPullBook
   ```
2. **Chrome / Chromium / Edge / Brave:** Acesse `chrome://extensions/`, ative o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta raiz `WebPullBook/`.
3. **Firefox (128+):** Acesse `about:debugging#/runtime/this-firefox`, clique em **Carregar extensão temporária...** e selecione [manifest.json](../../manifest.json).
4. Após editar qualquer arquivo em `src/`, recarregue a extensão na respectiva página de extensões (e recarregue abas abertas do workspace).

## Como o WebPullBook Funciona (Fluxo Completo)

Entender as 5 etapas do pipeline ajuda a encontrar rapidamente onde cada alteração se encaixa:

1. **Disparo pelo Ícone ([service-worker.js](../../src/background/service-worker.js)):** Ao clicar no ícone da extensão, ela abre `src/workspace/workspace.html?url=<urlDaAba>&sourceTabId=<tabId>`. No Firefox (`moz-extension://`), também registra a regra de sessão `declarativeNetRequest` (ID `1`) para limpar o cabeçalho `Origin` em requisições cross-origin.
2. **Inicialização do Workspace ([workspace.js](../../src/workspace/workspace.js)):** [theme-init.js](../../src/workspace/theme-init.js) aplica o tema salvo sem piscar a tela; opções, biblioteca e regras por domínio são carregadas de `chrome.storage.local`, entradas expiradas no `IndexedDB` são limpas e `handleLoadSeries()` inicia o carregamento da obra.
3. **Captura de DOM & Seleção de Parser ([net-fetcher.js](../../src/core/net-fetcher.js) e [parsers/index.js](../../src/parsers/index.js)):** Primeiro tenta ler o DOM vivo diretamente de `sourceTabId` (`readOpenTabDocument`), depois faz fallback para `fetchWithRetry()` respeitando charset e, em páginas SPA/dinâmicas, usa uma aba auxiliar reutilizável (`TabRenderPool`). O `parserRegistry.detect()` pontua cada adaptador com `matchScore(doc, url)` e escolhe o melhor (ou `GenericHtmlParser`).
4. **Curadoria & Perfis de Leitor ([src/workspace/](../../src/workspace/workspace.html)):** A pessoa usuária pode filtrar/selecionar capítulos e volumes (`Ctrl+Click` / `Shift+Click`), pré-visualizar e editar capítulos rapidamente, mesclar capítulos ou abas abertas, capturar seletores CSS na página (`Apontar`) ou aplicar um perfil fixo de `READER_PRESETS` ([state.js](../../src/workspace/state.js)).
5. **Sanitização & Empacotamento ([sanitizer.js](../../src/core/sanitizer.js), [xhtml-serializer.js](../../src/core/xhtml-serializer.js), [src/exporters/](../../src/exporters/index.js)):** O `AdaptiveRateLimiter` controla o ritmo entre requisições; cada capítulo é sanitizado em XML/XHTML estrito (removendo scripts, anúncios, URIs inseguras e rastreadores) e salvo no `IndexedDB`; por fim o `exporterRegistry` gera **EPUB 2/3** (`epub-builder.js` + `zip.js`), **HTML único**, **Markdown** ou **TXT**, gravando via `chrome.downloads` ou `showDirectoryPicker()`.

## Estrutura do Repositório e Módulos

```text
WebPullBook/
├── .github/                  # Workflows de CI, Release, Pages e CodeQL, templates de Issue/PR, SECURITY e CoC
├── AGENTS.md                 # Regras e mapa arquitetural para agentes de IA
├── CHANGELOG.md              # Histórico de versões (lido por scripts/extract-release-notes.mjs)
├── CONTRIBUTING.md           # Guia oficial de contribuição (em inglês)
├── manifest.json             # Manifesto MV3 multi-navegador (Chrome + Firefox gecko)
├── package.json              # Scripts NPM e devDependencies (jsdom, fake-indexeddb, @biomejs/biome, addons-linter, playwright)
├── docs/                     # Matriz de compatibilidade, Perfis de Leitor, guia de SEO e espelhos docs/pt/
├── icons/                    # Ícones da extensão (SVG + PNG)
├── scripts/                  # check.mjs (lint/CSP/i18n), sync-website.mjs, verify-website.mjs, extract-release-notes.mjs
├── src/                      # Código da extensão (sem compilação/bundler)
│   ├── background/           # Service worker / script de fundo MV3
│   ├── core/                 # Motor de extração, rede, sanitização, imagens, cache e EPUB
│   ├── exporters/            # Exportadores polimórficos (epub, html, md, txt)
│   ├── parsers/              # ParserRegistry, GenericHtmlParser e adaptadores estruturais
│   └── workspace/            # UI da extensão, 4 temas, controladores modulares e locales PT/EN
├── tests/                    # Testes nativos node:test, fixtures/, helpers/ e E2E Playwright
└── website/                  # Site bilíngue no GitHub Pages (não vai no .zip da extensão)
```

Principais arquivos:

- [manifest.json](../../manifest.json) — Configuração MV3 (`service_worker` + `background.scripts` e `gecko` para Firefox).
- [src/background/service-worker.js](../../src/background/service-worker.js) — Abertura do workspace e regra `Origin` no Firefox.
- [src/core/](../../src/core/parser-engine.js) — Módulos coesos de responsabilidade única: `parser-engine.js`, `base-parser.js`, `net-fetcher.js`, `rate-limiter.js`, `dnr-rules.js`, `text-utils.js`, `selector-utils.js`, `epub-css.js`, `sanitizer.js`, `xhtml-serializer.js`, `image-processor.js`, `epub-templates.js`, `epub-builder.js`, `zip.js` e `cache-store.js`.
- [src/exporters/](../../src/exporters/index.js) — `BaseExporter` e `ExporterRegistry` (`epub`, `html`, `md`, `txt`).
- [src/parsers/](../../src/parsers/index.js) — `ParserRegistry`, resolução multi-domínio de capítulos, `GenericHtmlParser` e os adaptadores estruturais inventariados em [docs/COMPATIBILITY.md](../COMPATIBILITY.md#parser-regression-fixtures).
- [src/workspace/](../../src/workspace/workspace.html) — Workspace modular (`theme-init.js`, `state.js`, `i18n.js` + `locales/`, `logger.js`, `options-storage.js`, `directory-handle.js`, `domain-rules-ui.js`, `chapters-ui.js`, `cover-ui.js`, `chapter-modals.js`, `volume-modals.js`, `series-loader.js`, `export-runner.js`, `download-storage.js`, `library-ui.js`, `library-view.js`, `cache-sessions-ui.js`, `settings-io.js`, `tab-picker.js` e `workspace.js`).
- [docs/READER_PRESETS.pt.md](../READER_PRESETS.pt.md) — Guia dos perfis de leitor definidos em `READER_PRESETS` ([state.js](../../src/workspace/state.js)).
- `website/` — Site estático bilíngue publicado no GitHub Pages (sincronizado via `npm run sync:website` e validado pelo `npm run lint`).

## Padrões de Idioma, Estilo e Segurança

- **Inglês como Padrão:** Issues, Pull Requests, mensagens de commit, comentários no código e documentação principal (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/*.md`) devem ser escritos em **inglês**.
- **Espelhos em Português:** Traduções de referência ficam em `README.pt.md`, `docs/READER_PRESETS.pt.md`, `docs/pt/` e `website/pt/`. Strings da UI (`locales/pt.js` / `en.js`) e páginas de `website/pt/` exigem paridade estrita entre PT e EN (verificada pelo `npm run lint`).
- **CSP do Manifest V3 & Higiene:** Nunca use `<script>` inline nem atributos `on*` em `src/**/*.html`, nunca deixe `console.log()` ou `debugger` em `src/`, e mantenha quebras de linha LF sem espaços sobrando no fim das linhas.
- **HTML Não Confiável:** Todo capítulo extraído deve passar por `HtmlSanitizer` e `serializeChapterXhtml`. Nunca contorne validação de protocolos (`assertSafeHttpUrl`), DRM ou desafios anti-bot.

## Como Adicionar um Adaptador de Parser

### Filosofia: Compatibilidade Genérica Primeiro

O WebPullBook busca ser o **mais genérico possível**, priorizando compatibilidade ampla em vez de regras frágeis por site:

- **Melhore a camada genérica primeiro:** Verifique `BaseParser`, `GenericHtmlParser` e `HtmlSanitizer` para padrões web comuns (JSON-LD, Open Graph, `<dl>`, `itemprop`, pontuação de contêineres, limpeza de `.sr-only` e âncoras internas).
- **Crie um adaptador dedicado apenas quando a heurística genérica não bastar** (APIs JSON paginadas, payloads ofuscados, AJAX específico ou hidratação SPA incomum).
- **Detecte por sinais estruturais de DOM** (`matchScore`), evitando prender o adaptador a nomes de domínio ou URLs fixas sempre que possível.

### Passo a Passo

1. **Crie o módulo do adaptador** em `src/parsers/<nome-do-adaptador>.js` estendendo `BaseParser` de [src/core/parser-engine.js](../../src/core/parser-engine.js):

   ```js
   import { BaseParser } from '../core/parser-engine.js';

   export class CustomAdapter extends BaseParser {
     constructor() {
       super({ id: 'custom-adapter', name: 'Nome Descritivo do Adaptador' });
     }

     matchScore(doc, _url) {
       return doc.querySelector('.my-chapter-list') ? 80 : 0;
     }

     extractSiteMetadata(doc, targetUrl) {
       return {};
     }

     collectChapterNodes(doc, targetUrl, _options, _context) {
       return [];
     }

     findChapterContentRoot(doc) {
       return doc.querySelector('.my-chapter-body');
     }
   }
   ```

2. **Registre a instância** em `parserRegistry` ([src/parsers/index.js](../../src/parsers/index.js)) **antes** de `genericHtmlParser`. A lista nas opções de `workspace.html` é preenchida automaticamente.
3. **Adicione fixtures anonimizadas e snapshots de regressão:**
   - Salve HTMLs anonimizados (com domínios fictícios como `example.org`) em `tests/fixtures/<adaptador>-index.html` e `tests/fixtures/<adaptador>-chapter.html`.
   - Registre o resultado esperado em [tests/fixtures/snapshots.json](../../tests/fixtures/snapshots.json).
   - Adicione um teste em [tests/parsers.test.js](../../tests/parsers.test.js) e documente o padrão em [docs/COMPATIBILITY.md](../COMPATIBILITY.md) (respeitando as 4 faixas de compatibilidade e sem incluir URLs ou domínios reais).
4. **Valide tudo** rodando `npm run check` (e `npm run sync:website` se tiver alterado `docs/COMPATIBILITY.md`).

## Testes Automatizados e Verificações

O código da extensão não tem dependências de runtime nem etapa de compilação (`npm run lint`, `npm run lint:fix` e `npm run sync:website` usam apenas Node.js padrão). Os testes unitários usam `jsdom` + `fake-indexeddb` e o teste E2E em navegador Chromium usa Playwright (`devDependencies`, instalados via `npm install`).

| Comando | Requisitos | O que Valida |
| :--- | :--- | :--- |
| `npm run check` | `npm install` (`Node.js` + `devDependencies`) | Executa `npm run lint && npm test` (recomendado antes de todo commit/PR). |
| `npm run lint` | Apenas Node.js | Paridade `manifest.json`/`package.json`, chaves MV3 do Firefox, sintaxe JS, CSP MV3, links Markdown, paridade PT/EN no i18n, IDs do DOM, LF/espaços e `verify-website.mjs`. |
| `npm run lint:biome` | `npm install` (`@biomejs/biome`) | Análise estática rápida (variáveis/imports não usados, globais não declaradas, código morto) sem alterar formatação. |
| `npm run lint:amo` | `npm install` (`addons-linter`) + `zip` | Monta um ZIP comprimido de prévia (`manifest.json`, `_locales`, `icons`, `src`, `LICENSE`, `README*.md`) e valida no `addons-linter`. |
| `npm run lint:fix` | Apenas Node.js | Corrige automaticamente fins de linha LF e espaços no fim das linhas. |
| `npm test` | `npm install` (`jsdom`, `fake-indexeddb`) | Suíte nativa de testes unitários e snapshots (`node:test`) cobrindo `HtmlSanitizer`, `createZipBlob`, `ParserRegistry`, `ExporterRegistry`, `CacheStore`, `ImageProcessor`, `AdaptiveRateLimiter`, `TabRenderPool`, além de `EPUBCheck` quando disponível. |
| `npm run sync:website` | Apenas Node.js | Sincroniza tabelas e versões de `website/` a partir de `docs/` e `manifest.json` (`--check` verifica se está atualizado). |
| `REQUIRE_EPUBCHECK=1 npm run test:epubcheck` | Java 21+ e EPUBCheck | Valida EPUB 2 e EPUB 3 gerados (0 erros, 0 avisos). |
| `npm run test:e2e` | `npm install` + `npx playwright install chromium` | Abre o Chromium com a extensão carregada e testa extração, seleção, perfis, biblioteca, regras por domínio, download real e mesclagem de abas. |

> **Cobertura por Navegador:** O E2E automatizado roda no Chromium via Playwright (`--load-extension`). A compatibilidade MV3 do Firefox (`background.scripts` + `browser_specific_settings.gecko`) é validada estaticamente pelo `npm run lint` e testada manualmente em `about:debugging#/runtime/this-firefox`.

## Checklist de Pull Request & Release

### Versionamento (`MAJOR.MINOR.PATCH`)

- **`MAJOR` (`1.x.x` → `2.0.0`):** Apenas quando houver um grande marco após muita evolução.
- **`MINOR` (`1.6.0` → `1.7.0`):** Atualizações relevantes de recursos ou novos adaptadores.
- **`PATCH` (`1.6.0` → `1.6.1`):** Pequenas correções, ajustes leves ou manutenção pontual.
- **Quem lança releases é o mantenedor:** Contribuidores não precisam alterar versões nem criar tags nos Pull Requests.

### Checklist

- Execute `npm run check` sem erros antes de abrir um PR.
- Se alterar textos da UI ou HTML, mantenha paridade PT/EN em `src/workspace/locales/`, respeite a CSP (sem `<script>` inline nem `on*`) e confira os 4 temas (`light`, `dark`, `sepia`, `midnight`).
- Se alterar `docs/COMPATIBILITY.md`, `docs/READER_PRESETS*.md` ou a versão em `manifest.json`, rode `npm run sync:website`.
- Antes de criar uma tag de release (`v*`):
  1. Confirme todos os testes (unitários, lint, EPUBCheck e E2E) verdes no CI.
  2. Garanta que `version` em [manifest.json](../../manifest.json) e [package.json](../../package.json) bata com a tag (`vX.Y.Z`).
  3. Inclua a seção `## [X.Y.Z]` em [CHANGELOG.md](../../CHANGELOG.md) (usada automaticamente por [extract-release-notes.mjs](../../scripts/extract-release-notes.mjs)).
  4. Confira o `.zip` gerado (`manifest.json`, `_locales/`, `icons/`, `src/`, `LICENSE`, `README.md`, `README.pt.md`, excluindo `docs/`, `website/`, `tests/` e `node_modules/`) + arquivo `.sha256`.
