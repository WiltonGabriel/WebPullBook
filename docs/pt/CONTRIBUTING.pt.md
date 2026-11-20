# Como Contribuir com o WebPullBook

[English](../../CONTRIBUTING.md) | **Português**

Este documento é a versão em português do guia oficial de contribuição ([CONTRIBUTING.md](../../CONTRIBUTING.md)). Para instruções específicas destinadas a agentes de programação com IA, consulte [AGENTS.md](../../AGENTS.md).

> **Área de Maior Impacto — Desenvolvimento de Parsers:** Ajudar a desenvolver, aprimorar e adicionar **parsers** (tanto na camada genérica `BaseParser` / `GenericHtmlParser` quanto em adaptadores estruturais em `src/parsers/`) é a principal forma de expandir a compatibilidade do WebPullBook. Veja a seção [Como Adicionar um Adaptador de Parser](#como-adicionar-um-adaptador-de-parser) abaixo.

## Configuração para Desenvolvimento

O WebPullBook utiliza módulos ES nativos e APIs padrão do navegador, **sem etapa de compilação e sem dependências de execução (`dependencies: {}`)**.

1. Clone o repositório:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   cd WebPullBook
   ```
2. **Chrome / Chromium / Edge / Brave:** Acesse `chrome://extensions/`, ative o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione a pasta raiz `WebPullBook/`.
3. **Firefox (128+):** Acesse `about:debugging#/runtime/this-firefox`, clique em **Carregar extensão temporária...** e selecione [manifest.json](../../manifest.json).
4. Após editar qualquer arquivo em `src/`, recarregue a extensão na respectiva página de extensões.

## Arquitetura Resumida

- [manifest.json](../../manifest.json) — Manifesto MV3 (Chrome + Firefox Gecko).
- [src/background/service-worker.js](../../src/background/service-worker.js) — Abertura do workspace e regra `Origin` no Firefox.
- [src/core/](../../src/core/parser-engine.js) — Módulos coesos de extração, rede, sanitização, imagens, cache `IndexedDB` e geração EPUB/ZIP.
- [src/exporters/](../../src/exporters/index.js) — Exportadores `epub`, `html`, `md` e `txt`.
- [src/parsers/](../../src/parsers/index.js) — Registro de parsers e adaptadores estruturais.
- [src/workspace/](../../src/workspace/workspace.html) — Interface modular do workspace e traduções (`locales/pt.js` e `locales/en.js`).
- `website/` — Site estático bilíngue publicado no GitHub Pages (excluído do pacote `.zip` da extensão).

## Como Adicionar um Adaptador de Parser

### Filosofia: Compatibilidade Genérica Primeiro
1. **Priorize melhorias na camada genérica (`BaseParser`, `GenericHtmlParser`, `HtmlSanitizer`)** quando o padrão HTML existir em diversos sites.
2. **Crie um adaptador dedicado apenas quando a heurística genérica não bastar** (APIs JSON paginadas, AJAX específico ou hidratação SPA incomum).
3. **Detecte por sinais estruturais de DOM** (`matchScore`), evitando prender o adaptador a nomes de domínio específicos sempre que possível.

Exemplo mínimo em `src/parsers/<nome-do-adaptador>.js`:

```js
import { BaseParser } from '../../core/parser-engine.js';

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

Registre a instância em `parserRegistry` ([src/parsers/index.js](../../src/parsers/index.js)) **antes** de `genericHtmlParser`.

## Checklist de Pull Request & Testes

- Execute `npm run lint` e `npm test` sem erros (`npm run check` roda os dois sem `npm install`).
- Valide `EPUBCheck` (`REQUIRE_EPUBCHECK=1 npm run test:epubcheck`) e E2E Playwright (`npm run test:e2e`) quando aplicável.
- Não adicione `<script>` inline nem atributos `on*` no HTML (restrição CSP do Manifest V3).
- Para adicionar fixtures de regressão de parsers, salve HTMLs anonimizados (com domínios fictícios como `example.org`) em `tests/fixtures/` e atualize [snapshots.json](../../tests/fixtures/snapshots.json) e [COMPATIBILITY.md](../COMPATIBILITY.md).
