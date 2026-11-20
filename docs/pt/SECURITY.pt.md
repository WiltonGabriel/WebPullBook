# Política de Segurança

[English](../../.github/SECURITY.md) | **Português**

Espelho em português de [.github/SECURITY.md](../../.github/SECURITY.md).

## Versões Suportadas

Apenas a versão mais recente do **WebPullBook** publicada na branch `main` recebe correções ativas e atualizações de segurança.

| Versão | Suportada |
| :--- | :--- |
| Release `1.x` mais recente (`1.6.0-beta`) | ✅ Sim |
| Releases `1.x` anteriores | ❌ Não (atualize para a versão mais recente) |

## Modelo de Segurança & Proteções

O **WebPullBook** é uma extensão de navegador Manifest V3 executada localmente dentro do navegador do usuário, sem servidores externos próprios:

- **Sanitização de HTML Externo e XHTML:** todo HTML de capítulos extraídos é tratado como conteúdo não confiável, sanitizado pelo [`HtmlSanitizer`](../../src/core/sanitizer.js) e serializado em XML/XHTML estrito por [`serializeChapterXhtml`](../../src/core/xhtml-serializer.js) antes de empacotar EPUBs ou HTML offline (`<script>`, `<iframe>`, `<object>`, `<embed>`, atributos `on*` e URIs inseguros são removidos).
- **Validação Estrita de Protocolos & Redirecionamentos:** links de capítulos, botões de banner, prévias de capa e abas auxiliares SPA passam por listas positivas HTTP/HTTPS (`assertSafeHttpUrl`, `resolveSafeHttpUrl`, `sanitizeCoverPreviewUrl` e `data:image/*` raster validado para capas locais/geradas), bloqueando `javascript:`, `data:text/html`, `vbscript:` e `file:`.
- **CSP do Manifest V3:** as páginas da extensão (`src/workspace/workspace.html`) seguem a Content Security Policy do Manifest V3, sem blocos `<script>` inline nem atributos `on*` (validado em todo CI pelo `scripts/check.mjs`).
- **Proteções SPA & Anti-Bot:** a renderização em aba auxiliar (`TabRenderPool`) utiliza *circuit breaker* por domínio e pausa automaticamente em desafios Cloudflare/CAPTCHA ou limites HTTP 429. O WebPullBook não contorna DRM, paywalls fechados nem CAPTCHAs.
- **Sem Telemetria nem Servidores Externos:** não há analytics, envio de erros remoto nem carregamento de código externo. Preferências, Biblioteca, regras por domínio e cache de capítulos permanecem no dispositivo (`chrome.storage.local`, `IndexedDB` `WebPullBookCache` e pasta opcional escolhida via `showDirectoryPicker`). As requisições HTTP/HTTPS partem diretamente do navegador apenas para os sites escolhidos pelo usuário.
- **Política de Privacidade:** detalhes completos na [Política de Privacidade](https://wiltongabriel.github.io/WebPullBook/pt/privacy.html).

## Escopo dos Relatos

- **Dentro do escopo:** XSS na interface da extensão ou no site oficial, falhas de contorno no sanitizador HTML/XHTML de arquivos exportados, execução/aceitação de protocolos inseguros (`javascript:`, `data:text/html`), uso inseguro de `chrome.tabs`/`chrome.scripting` ou violações da CSP do Manifest V3.
- **Comportamento esperado (fora do escopo):** como o WebPullBook é um extrator Web-to-EPUB client-side, buscar páginas ou imagens HTTP/HTTPS explicitamente solicitadas pelo usuário na sessão do navegador faz parte do funcionamento intencional da extensão.

## Como Reportar uma Vulnerabilidade

Se encontrar uma vulnerabilidade de segurança no **WebPullBook**:

1. **Não abra uma issue pública** com detalhes do exploit ou payloads de ataque.
2. Envie o relato de forma privada pelo **Private Vulnerability Reporting** do GitHub neste repositório (**Security → Advisories → Report a vulnerability**).
3. Inclua passos claros de reprodução, o trecho HTML ou módulo afetado (`src/...` ou `website/...`) e a versão do navegador testada.

Responderemos o mais rápido possível para coordenar a correção antes de qualquer divulgação pública.
