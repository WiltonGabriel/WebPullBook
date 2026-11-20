# Política de Segurança

[English](../../.github/SECURITY.md) | **Português**

Espelho em português de [.github/SECURITY.md](../../.github/SECURITY.md).

## Versões Suportadas

Apenas a versão mais recente do **WebPullBook** publicada na branch `main` recebe correções ativas e atualizações de segurança.

| Versão | Suportada |
| :--- | :--- |
| `1.x` | Sim |

## Modelo de Segurança

O WebPullBook é executado localmente dentro do navegador do usuário, sem servidores externos próprios:

- Todo HTML externo extraído passa pelo sanitizador [`HtmlSanitizer`](../../src/core/sanitizer.js) e é serializado em XHTML estrito antes de empacotar EPUBs ou HTML offline (`<script>`, `<iframe>`, `<object>` e atributos `on*` são removidos).
- Não há analytics remotos, telemetria nem carregamento de código externo.
- Preferências locais e Biblioteca permanecem em `chrome.storage.local` e `IndexedDB` (`WebPullBookCache`); requisições de rede vão diretamente do navegador para os sites escolhidos pelo usuário.
- Detalhes completos de privacidade estão em `https://wiltongabriel.github.io/WebPullBook/pt/privacy.html`.

## Reportando Vulnerabilidades

Se descobrir qualquer falha de segurança (como contorno do sanitizador HTML/XHTML, XSS no workspace ou problema de CSP):

1. **Não abra uma issue pública** com detalhes do exploit.
2. Envie o relato de forma privada via **GitHub Security Advisories** (**Security → Report a vulnerability**) no repositório.
3. Inclua passos de reprodução, trecho HTML ou componente afetado e versão do navegador testada.
