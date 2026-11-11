# Changelog

Todas as mudanças notáveis do **WebPullBook** serão documentadas neste arquivo.

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
