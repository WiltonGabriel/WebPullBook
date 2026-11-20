# Changelog

Todas as mudanças notáveis do **WebPullBook** serão documentadas neste arquivo.

## [Não lançado / Unreleased]

### Novidades / New Features
- **Perfis de Leitor reformulados:** novos perfis **Kindle (Antigo)** (EPUB 2, ideal para *Send to Kindle*) e **Kindle (Moderno)** (EPUB 3 para Calibre/KFX), além de Padrão Moderno, Kobo, Somente Texto e Padrão Antigo. Todos preservam as cores (removida a conversão forçada para escala de cinza e o selo E-Ink). Ordem do seletor atualizada (`Padrão Antigo` acima de `Personalizado`, sem emoji no nome). Guia completo em `docs/READER_PRESETS.md` / `docs/READER_PRESETS.pt.md`.
- **Seletor de perfil também em Opções Avançadas:** perfis são predefinições fixas e completas: escolher um perfil atualiza na hora todas as opções avançadas correspondentes e alterar qualquer opção avançada muda o perfil para **Personalizado** automaticamente.
- **Sumário no início do livro & Página de Informações customizável:** Sumário (`nav.xhtml` / `text/toc.xhtml`) movido para o início do livro por padrão, com opção de desativar, mover para o fim ou editar o título; Página de Informações agora permite ativar/desativar título, autor/idioma/capítulos, gêneros, fonte e sinopse.
- **Tela de Loading & Captura Direta da Aba Ativa:** overlay de carregamento instantâneo ao abrir a extensão (`#loading-overlay`) e captura do DOM vivo diretamente da aba de origem (`sourceTabId`) via `service-worker.js` + `PageDomCache`, evitando `fetch()` frio em SPAs e páginas já autenticadas.
- **Pipeline de Imagens Resiliente & Logs `[IMG]`:** detecção de MIME por *magic bytes* (corrige `octet-stream` e bloqueia HTML 200 disfarçado), fallback automático para bytes originais se a conversão via canvas falhar, retry anônimo em qualquer erro HTTP, deduplicação por hash de conteúdo entre URLs diferentes, preservação de GIF/APNG/WebP animados, suporte a `srcset`/`<picture>`/`data-orig-file` e logs detalhados `[IMG]`.
- **Upgrade do `UniversalSmartExtractor` & Limpeza XHTML:** suporte a capítulos com `<br>` sem `<p>`, detecção Índice vs. Capítulo (`isTableOfContents`), busca automática de link de Índice/Sumário, ordenação ascendente automática, remoção exata de links adjacentes por URL (`nextPrevUrls`), decodificação de `__cf_email__`, `wp-block-spacer` → `<hr>`, correção de blocos em tags inline, deduplicação de título repetido e reescrita de links internos entre capítulos do mesmo EPUB.
- **Modo Seguro Adaptativo, Latência Rápida & Segurança SPA:** novo controle rápido de **Latência entre capítulos (`0–30000 ms`)** na aba principal sem precisar do Modo Seguro; `AdaptiveRateLimiter` com ajuste dinâmico por latência/erros, `Retry-After` e espera cooperativa (desmarcar libera na hora); `TabRenderPool` reutilizável (1 aba por fila), espera inteligente por estabilização do DOM, *circuit breaker* anti-bot por domínio, validação estrita `http(s):` e botão **"Abrir página para verificar ↗"** no banner.
- **Biblioteca & Histórico:** botão **Baixar Todas as Atualizações** para checar e exportar em lote as obras com capítulos novos, além de modo opcional **Unificado (todos os sites)** vs **Separado por site** com filtro por domínio e selo de origem em cada item.
- **Seletor Visual (`🎯 Apontar`)**, edição rápida e mesclagem de capítulos na prévia (selo `Editado`), **Notas de rodapé pop-up EPUB 3**, e `COMPATIBILITY.md` reorganizado em 4 categorias.
- **Pausar / Cancelar sempre visíveis**; **Cancelar** pede confirmação e fechar a aba durante exportação exibe aviso do navegador (Chrome e Firefox).
- **Logs de diagnóstico:** telemetria `[NET]`, `[TAB]`, `[SPA]`, `[IMG]`, `[SAFE]`, `[PARSER]`, `[BUILD]`, `[AUTO]`, `[CFG]`, `[DONE]` com filtros Todos/Avisos/Erros e botão **Copiar Log**.

### Arquitetura / Architecture
- Refatoração completa seguindo o princípio de **Responsabilidade Única (SRP)**:
  - `src/core/` dividido em módulos coesos (`base-parser.js`, `net-fetcher.js`, `rate-limiter.js`, `dnr-rules.js`, `image-processor.js`, `epub-templates.js`, `epub-css.js`, `text-utils.js`, `selector-utils.js`, `xhtml-serializer.js`, mantendo `parser-engine.js` como fachada compatível).
  - `src/workspace/` dividido em módulos focados (`state.js`, `i18n.js` + `locales/`, `logger.js`, `options-storage.js`, `directory-handle.js`, `domain-rules-ui.js`, `chapters-ui.js`, `cover-ui.js`, `chapter-modals.js`, `volume-modals.js`, `series-loader.js`, `export-runner.js`, `download-storage.js`, `library-ui.js`, `library-view.js`, `cache-sessions-ui.js`, `settings-io.js`, `tab-picker.js`, `workspace.js`).
- Suporte a resolução de parser por domínio do capítulo (`resolveParserForChapterUrl`) para obras multi-domínio e *Juntar Abas*.

## [1.3.0] - 2026-11-15 (Beta)

### Novidades & Compatibilidade / New Features & Compatibility
- **Suporte ao Mozilla Firefox (128+):** Manifest V3 cross-browser (`background.scripts` + `browser_specific_settings.gecko`) e remoção automática do cabeçalho `Origin: moz-extension://` via `declarativeNetRequest` em `service-worker.js`, evitando bloqueios CORS ao buscar capítulos e capas no Firefox.
- **Assistente Heurístico de Seletores CSS:** novo botão **Auto-detectar seletores** em **Opções Avançadas** que analisa o DOM do índice e de um capítulo de amostra (com fallback para Modo SPA) para sugerir automaticamente os seletores de lista, conteúdo e exclusões.
- **Melhorias no Núcleo Genérico & Sanitizador:**
  - Regra *"Innermost Node Wins"* em `GenericHtmlParser.findChapterContentRoot()` para priorizar o bloco real de prosa sobre containers externos com menus/notas.
  - Detecção expandida em `BaseParser` para metadados JSON-LD (`genre`, `creativeWorkStatus`), listas `<dl>` (`Autor`, `Status`), sinopses (`[data-testid*="synopsis"]`, `[itemprop="description"]`), remoção de `<time>` dos títulos de capítulos, limpeza de `.sr-only` em `<h1>` e inferência de volumes a partir de cabeçalhos ancestrais.
  - Preservação seletiva de âncoras intra-capítulo (`#id`) para notas de rodapé no `HtmlSanitizer` e remoção de classes *decoy* ocultas declaradas em `<style>` top-level.
- **Novos Adaptadores Verificados:**
  - **Royal Road** (`royalroad.js`), **Novel Mania** (`novelmania.js`) e **Scribble Hub** (`scribblehub.js`), incluindo paginação, ordenação cronológica, detecção de desafio anti-bot e fixtures/snapshots completos.

### Interface & Experiência / UI & Accessibility
- **Layout em 2 Colunas & Abas Acessíveis:** painel principal reorganizado em sidebar lateral (capa, metadados e configurações) e coluna de capítulos para eliminar espaços vazios, com abas renomeadas (`Obra`, `Biblioteca`, `Opções Avançadas`, `Logs`), navegação via teclado (`role="tablist"`/`tabpanel`) e responsividade aprimorada.
- **Seletor Rápido com 4 Temas:** novos temas **Sépia** e **Meia-noite** somados a **Claro** e **Escuro** diretamente na barra superior ao lado do seletor de idioma.

### Documentação & Qualidade / Docs & Testing
- Documentação atualizada para incluir instalação no Firefox, novo layout/temas, lista completa de adaptadores e a filosofia **General Compatibility First** no `CONTRIBUTING.md` e `docs/COMPATIBILITY.md`.
- Suíte ampliada para `30` testes passando (lint, sintaxe, CSP MV3, paridade i18n de 228 chaves, regressões de todos os adaptadores e validação real em Chromium e Mozilla Firefox 160).

## [1.2.1] - 2026-11-11 (Beta)

### Novidades & Melhorias / Improvements
- **Links clicáveis nos Logs:** URLs `http(s)://` dentro das linhas na aba **Logs** agora abrem diretamente em nova aba (`rel="noopener noreferrer"`), facilitando inspecionar páginas de capítulos ou mídias que falharam.
- **Botões diretos no Relatório & Tabela:** o relatório pós-empacotamento exibe **`Abrir capítulo ↗`** e **`Abrir imagem ↗`** por ocorrência (além de `Ver no log`), e a tabela de capítulos mostra **`Abrir página ↗`** ao lado de erros/avisos.
- **Contexto completo em avisos de imagem:** os logs de falha de mídia passam a registrar tanto a URL da página do capítulo quanto a URL da imagem.
- **Pipeline de Release automatizado:** notas da release geradas automaticamente a partir do `CHANGELOG.md` com validação completa (`lint`, `23` testes + `EPUBCheck v5.4.0` e E2E Playwright) antes de publicar o pacote `.zip`.

## [1.2.0] - 2026-11-11 (Beta)

### Novidades / New Features
- **Relatório Pós-Empacotamento & Severidade:** painel resumo abaixo do banner separando **Erros graves (capítulos)** e **Avisos leves (imagens/capa)** com explicação de impacto, lista numerada e salto clicável para o log correspondente.
- **Status Clicáveis e Badges de Log:** capítulos mostram `Baixado ✓` / `Em Cache ✓`, avisos de imagem (`⚠ N`) e erros clicáveis que levam direto à linha destacada na aba **Logs** (que agora exibe badge vermelho de erros e badge de avisos).
- **Resiliência em Imagens & EPUBCheck 100% Verde:** fallback anônimo (`credentials: 'omit'`) em `HTTP 401/403` para CDNs/buckets S3, rejeição de respostas HTML disfarçadas de imagem, conversão automática de WebP/AVIF em EPUB 2, correção de declaração `<?xml ...?>` no Chromium, `toc.ncx` (`playOrder`/DOCTYPE) e propriedade `svg` no `content.opf`.
- **Segurança no Sanitizador:** bloqueio estrito de protocolos inseguros em `<img>` (`javascript:`, `data:text/html`).
- **Qualidade & CI (P0/P1/P2):** suíte nativa `node:test` (23 testes sem dependências externas), fixtures + snapshots de regressão (`wp-lightnovel`, `madara-theme`, `generic-html`), validação W3C `EPUBCheck` e teste E2E real da extensão no Chromium via Playwright.

## [1.1.0] - 2026-11-11 (Beta)

- **Modo Seguro (Anti-Bloqueio) opcional** + proteção automática contra rate-limit (`HTTP 429`/`503`).
- **Cache Persistente Auto-Expirável (`IndexedDB`)** e retomada na aba **Biblioteca**.
- **Fallback de Imagens CDN Proxy (`i0.wp.com`)**.

## [1.0.2] - 2026-11-11 (Beta)

- Especificação EPUB 3 pura (`belongs-to-collection` / `group-position`) e `docs/COMPATIBILITY.md`.

## [1.0.1] - 2026-11-11 (Beta)

- Correção de `META-INF/container.xml` (`application/oebps-package+xml`), `dc:subject` e `landmarks` em `nav.xhtml`.

## [1.0.0] - 2026-11-11 (Beta)

- Lançamento inicial open source do WebPullBook (MV3, EPUB 2/3, HTML, Markdown, TXT, SPA tab mode, Juntar Abas e Biblioteca).
