# Histórico de Mudanças (Changelog)

[English](../../CHANGELOG.md) | **Português**

Todas as mudanças notáveis do **WebPullBook** estão documentadas neste arquivo (espelho de referência de [CHANGELOG.md](../../CHANGELOG.md)).

## [1.5.0] - 2026-11-20 (Beta)

### Novidades & Correções
- **Capa Padrão Automática com Logo (`src/workspace/cover-ui.js`):** quando a página de origem não possui imagem de capa detectável (ou ao criar livros via **Juntar Abas** / falha de carregamento remoto), o WebPullBook gera e aplica automaticamente uma capa padrão com o emblema oficial do projeto, título da obra e autor (também disponível manualmente no botão **Gerar Capa**).
- **Página Final do Livro (`OEBPS/text/end.xhtml` — Encerramento / Colofão):** página final configurável em **Opções Avançadas → Arquivos & Padrão EPUB** (título, mensagem em múltiplas linhas, resumo da obra, link da fonte e data de geração); o Sumário (`nav.xhtml` / `text/toc.xhtml`) fica sempre no início do livro quando ativado.
- **Seleção de Volumes e Capítulos (`Ctrl+Clique` e `Shift+Clique`):** alternância no botão **Selecionar Todos**, seleção individual com `Ctrl+Clique` e intervalo contínuo com `Shift+Clique` nos chips de volumes e na tabela de capítulos, além da normalização de cabeçalhos genéricos (`"Capítulos"`, `"Chapters"`, `"Sumário"`) para **`Volume 01`**.
- **Isolamento de Seletores CSS por Domínio:** seletores CSS e filtros regex (`customListSelector`, `customContentSelector`, `customExcludeSelector`, `customStripPatterns`) não ficam mais persistidos globalmente em `wpbOptions` (restritos à sessão do site ou às **Regras por Domínio** salvas), com fallback automático no `BaseParser` para o adaptador nativo quando um seletor retorna `0` capítulos.
- **Latência Manual centralizada em Opções Avançadas:** controle de intervalo manual entre capítulos (`0–30000 ms`, ajustável ao vivo e independente do Modo Seguro) em **Opções Avançadas → Rede, SPA & Resiliência**.
- **Site Oficial (GitHub Pages), Documentação e Segurança:** site bilíngue em `website/` sincronizado automaticamente com os documentos do repositório, `AGENTS.md`, `CHROMEWEBSTORE.md`, workflow de deploy no GitHub Pages (`pages.yml`), análise CodeQL (`security-and-quality` em `codeql.yml`), Dependabot (`dependabot.yml`), endurecimento de protocolos URL (`resolveSafeHttpUrl`, `assertSafeHttpUrl`, `sanitizeCoverPreviewUrl`) e geração de UUID via Web Crypto.

## [1.4.0] - 2026-11-20 (Beta)

### Novidades
- **Perfis de Leitor reformulados:** novos perfis **Kindle (Antigo)** (EPUB 2 para *Send to Kindle*) e **Kindle (Moderno)** (EPUB 3 para Calibre/KFX), além de Padrão Moderno, Kobo, Somente Texto e Padrão Antigo. Todos preservam cores originais. Guia completo em [READER_PRESETS.pt.md](../READER_PRESETS.pt.md).
- **Seletor de perfil em Opções Avançadas:** perfis funcionam como predefinições fixas e alteram imediatamente todos os campos avançados correspondentes; editar qualquer campo muda para **Personalizado** automaticamente.
- **Sumário no início do livro & Página de Informações customizável:** Sumário no início por padrão (com opção de desativar, mover para o fim ou editar o título) e controles individuais na Página de Informações.
- **Tela de Loading & Captura Direta da Aba Ativa:** overlay de carregamento instantâneo e captura do DOM vivo da aba ativa (`sourceTabId`) via `service-worker.js` + `PageDomCache`.
- **Pipeline de Imagens Resiliente & Logs `[IMG]`:** detecção por *magic bytes*, fallback para bytes originais se canvas falhar, retry anônimo (`credentials: 'omit'`) em erros HTTP, deduplicação por hash de conteúdo, preservação de GIF/APNG/WebP animados e suporte a `srcset`/`<picture>`.
- **Melhorias no `GenericHtmlParser` & Sanitizador XHTML:** capítulos com `<br>`, classificação Índice vs. Capítulo, ordenação ascendente, remoção exata de `nextPrevUrls`, decodificação de `__cf_email__`, `wp-block-spacer` → `<hr>`, remoção de título duplicado e reescrita de links internos entre capítulos.
- **Modo Seguro Adaptativo, Latência Manual & Segurança SPA:** `AdaptiveRateLimiter` com backoff por latência/erros, respeito a `Retry-After`, espera cooperativa, `TabRenderPool` (1 aba reutilizável), *circuit breaker* anti-bot por domínio e botão **"Abrir página para verificar ↗"**.
- **Biblioteca & Atualizações em Lote:** botão **Baixar Todas as Atualizações** e visualização unificada vs. separada por site.
- **Seletor Visual (`🎯 Apontar`)**, edição rápida e mesclagem de capítulos na prévia e **Notas de rodapé pop-up EPUB 3**.

### Arquitetura & Qualidade
- Refatoração completa seguindo o princípio de **Responsabilidade Única (SRP)** em `src/core/` e `src/workspace/`.
- Resolução de parser por domínio do capítulo (`resolveParserForChapterUrl`) para obras multi-domínio e *Juntar Abas*.
- Suíte de testes expandida + E2E Playwright Chromium + validação W3C `EPUBCheck` no CI.

## [1.3.0] - 2026-11-15 (Beta)

- **Suporte ao Mozilla Firefox (128+):** Manifest V3 cross-browser e remoção automática do cabeçalho `Origin: moz-extension://` via `declarativeNetRequest`.
- **Assistente Heurístico de Seletores CSS (`Auto-detectar seletores`)** e regra *"Innermost Node Wins"* em `GenericHtmlParser`.
- **Adaptadores Verificados:** Royal Road, Novel Mania e Scribble Hub com fixtures/snapshots completos.
- **Layout em 2 Colunas & 4 Temas:** Claro, Escuro, Sépia e Meia-noite.

## [1.2.1] - 2026-11-11 (Beta)

- Links clicáveis na aba **Logs**, botões diretos no relatório pós-empacotamento e automação de releases.

## [1.2.0] - 2026-11-11 (Beta)

- Relatório pós-empacotamento com severidade, badges na tabela de capítulos, fallback anônimo em imagens CDN, hardening do sanitizador e suíte `node:test` + `EPUBCheck` + E2E Playwright.

## [1.1.0] - 2026-11-11 (Beta)

- **Modo Seguro (Anti-Bloqueio)** opcional, proteção `HTTP 429`/`503`, cache persistente `IndexedDB` e fallback `i0.wp.com`.

## [1.0.2] - 2026-11-11 (Beta)

- Metadados EPUB 3 (`belongs-to-collection` / `group-position`) e `docs/COMPATIBILITY.md`.

## [1.0.1] - 2026-11-11 (Beta)

- Correção de `META-INF/container.xml`, `dc:subject` e `landmarks` em `nav.xhtml`.

## [1.0.0] - 2026-11-11 (Beta)

- Lançamento inicial open source do WebPullBook (MV3, EPUB 2/3, HTML, Markdown, TXT, SPA tab mode, Juntar Abas e Biblioteca).
