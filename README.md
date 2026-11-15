# WebPullBook

**🇧🇷 Português** | [🇺🇸 English](README.en.md)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Versão](https://img.shields.io/badge/Vers%C3%A3o-1.2.1--beta-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependências](https://img.shields.io/badge/Depend%C3%AAncias-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![Licença: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** é uma extensão de navegador open source e sem dependências externas que extrai obras seriadas, webnovels, páginas com múltiplos capítulos e abas abertas diretamente para arquivos **EPUB 2 / EPUB 3** (além de **HTML**, **Markdown** e **TXT**) limpos e organizados por volume no próprio navegador.

---

## Por que usar o WebPullBook?

Ler obras longas com centenas de capítulos no navegador dificulta a leitura offline e em leitores digitais, enquanto converter PDFs individuais de capítulos costuma gerar quebras de linha erradas e sujeira de paginação. O WebPullBook extrai o HTML limpo diretamente das páginas e empacota ebooks fluídos, com capa, sumário navegável e metadados completos de série e volume no padrão EPUB.

### Principais Funcionalidades

- **Compatibilidade Geral com Heurística DOM:** Extrai séries automaticamente a partir de padrões universais (JSON-LD/Schema.org, Open Graph, listas semânticas e densidade de texto no estilo Readability) em vez de depender apenas de regras por domínio. Quando um layout foge do padrão, um **assistente heurístico** nas Opções Avançadas sugere seletores CSS automaticamente (com edição manual opcional).
- **Detecção Automática de Volumes:** Identifica volumes por seções recolhíveis, cabeçalhos, prefixos de capítulo ou URLs para gerar **1 Arquivo por Volume** ou **Arquivo Único** com sumário aninhado. Caso o site não agrupe os volumes, você pode ajustá-los manualmente (divisão a cada *N* capítulos, faixas ou regras em lote).
- **Modo SPA / JavaScript (Renderização via Aba):** Páginas dinâmicas em React/Vue/Next.js que chegam vazias no `fetch` estático são renderizadas automaticamente via aba em segundo plano (`chrome.tabs` + `chrome.scripting`).
- **Cache Local (`IndexedDB`), Retomada & Guarda Anti-Bloqueio:** Capítulos baixados ficam salvos temporariamente no navegador (expiração padrão de **7 dias**) para retomar downloads interrompidos sem desperdiçar requisições, além de **Modo Seguro** (limite de RPM e *jitter*) e pausa automática em `HTTP 429`/`503`.
- **Biblioteca & Detecção de Novos Capítulos:** Salve obras na aba **Biblioteca** (`chrome.storage.local`) e use **Carregar & Marcar Novos** para baixar apenas os capítulos lançados desde o último pacote.
- **Modo Juntar Abas Abertas:** Capture abas HTTP/HTTPS abertas na janela atual e compile artigos ou capítulos em um único ebook.
- **EPUB Limpo para Leitores Digitais:** Sanitização XHTML estrita ([sanitizer.js](src/core/sanitizer.js)) que preserva negrito, itálico, citações, alinhamentos e âncoras internas (como notas de rodapé) sem travar tamanhos em `px` ou cores que quebram o modo escuro, além de capa e otimização opcional de imagens.
- **Multi-Navegador & Sem Dependências:** Funciona em **Chrome/Chromium** e **Mozilla Firefox 128+** em Manifest V3 puro, bilíngue (**pt-BR** / **en**) e com tema claro/escuro adaptativo.

---

## Compatibilidade

A lista simples de sites verificados, possíveis compatíveis e incompatíveis fica em [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) (qualquer pessoa pode editar a tabela via Pull Request conforme testar novos sites).

---

## Primeiros Passos

### Instalação (Chrome / Chromium)

Não é necessário compilar código nem instalar pacotes.

1. Baixe o pacote `WebPullBook-v*.zip` na página de [Releases](https://github.com/WiltonGabriel/WebPullBook/releases) e extraia a pasta, **ou** clone este repositório:
   ```bash
   git clone https://github.com/WiltonGabriel/WebPullBook.git
   ```
2. Abra `chrome://extensions/` no Google Chrome (ou navegador baseado em Chromium).
3. Ative o **Modo do desenvolvedor** no canto superior direito.
4. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a pasta `WebPullBook/` contendo o [manifest.json](manifest.json).

### Instalação (Mozilla Firefox)

Compatível com **Firefox 128+** (Manifest V3):

1. Baixe e extraia o pacote `WebPullBook-v*.zip` (ou clone este repositório).
2. Abra `about:debugging#/runtime/this-firefox` no Firefox.
3. Clique em **Carregar extensão temporária...** (*Load Temporary Add-on...*) e selecione o arquivo [manifest.json](manifest.json) (ou diretamente o `.zip`).

### Uso Rápido

1. Abra no navegador a página de índice de capítulos (ou qualquer capítulo) da obra desejada.
2. Clique no ícone do **WebPullBook** na barra do navegador para abrir a aba de trabalho — os metadados e capítulos são carregados automaticamente.
3. Escolha **1 Arquivo por Volume** ou **Arquivo Único**, selecione o formato de saída (**EPUB**, **HTML**, **MD** ou **TXT**) e ajuste o intervalo de capítulos se desejar.
4. Clique em **Empacotar EPUB**. Os arquivos gerados serão salvos em `Downloads/WebPullBook/<Título>/`.
5. Para acompanhar lançamentos futuros, clique em **Salvar na Biblioteca**.

### Configurando Qualquer Site sem Programar

Caso um site utilize um layout HTML incomum ou renderize via JavaScript, abra **Opções Avançadas**, ative o **Modo SPA / JavaScript** se necessário e clique em **Auto-detectar seletores** para a heurística preencher os campos automaticamente (ou edite os seletores CSS manualmente se precisar refinar):

```text
Seleção de Parser:                   Genérico (Qualquer página HTML)
Seletor CSS da lista de capítulos:   .chapter-list a
Seletor CSS do conteúdo:             article .chapter-body
Seletor CSS de elementos a excluir:  .ads, .translator-note
```

### Formatos de Saída

- **EPUB 2 / EPUB 3 (`.epub`):** Empacotamento OCF completo (`META-INF/container.xml`, `content.opf`, `toc.ncx`, `nav.xhtml` e capítulos em XHTML estrito) com capa e metadados de série/volume para uso em leitores digitais, celulares ou computadores.
- **HTML Único (`.html`), Markdown (`.md`) e Texto Puro (`.txt`):** Alternativas leves para leitura offline direta no navegador, editores de texto ou arquivamento.

---

## Estrutura do Projeto

```text
WebPullBook/
├── .github/                      # Templates de Issue/PR, Segurança, Conduta e CI/Release
├── manifest.json                 # Manifesto da extensão (MV3)
├── LICENSE                       # Licença MIT
├── CONTRIBUTING.md               # Guia de desenvolvimento e criação de parsers
├── README.md                     # Documentação (Português)
├── README.en.md                  # Documentação (English)
├── docs/
│   └── COMPATIBILITY.md          # Tabela de compatibilidade (editável via PR)
├── icons/                        # Ícones da extensão
└── src/
    ├── background/
    │   └── service-worker.js     # Abre o workspace ao clicar no ícone da barra
    ├── core/
    │   ├── cache-store.js        # Cache persistente em IndexedDB com expiração (TTL)
    │   ├── epub-builder.js       # Geração de OPF, NCX, NAV, capa e capítulos XHTML
    │   ├── parser-engine.js      # BaseParser (OOP), modo SPA em aba, CSS e retries
    │   ├── sanitizer.js          # HtmlSanitizer -> XHTML válido com estilos semânticos
    │   └── zip.js                # Empacotador ZIP nativo via CompressionStream
    ├── exporters/
    │   ├── index.js              # ExporterRegistry (EPUB, HTML, Markdown, TXT)
    │   ├── base-exporter.js      # BaseExporter com conversão DOM -> Markdown/TXT
    │   ├── epub-exporter.js      # Exportador EPUB 2/3
    │   ├── html-exporter.js      # Exportador HTML único offline
    │   ├── markdown-exporter.js  # Exportador Markdown (.md)
    │   └── txt-exporter.js       # Exportador Texto Puro (.txt)
    ├── parsers/
    │   ├── index.js              # ParserRegistry com ranking por pontuação DOM
    │   ├── generic-html.js       # Extrator heurístico, detecção de seletores e paginação
    │   ├── wp-lightnovel.js      # Adaptador estrutural para temas WordPress de ficção
    │   ├── madara-theme.js       # Adaptador estrutural para temas estilo Madara
    │   ├── royalroad.js          # Adaptador para fictions, volumes e notas ocultas
    │   ├── scribblehub.js        # Adaptador com paginação/AJAX e detecção anti-bot
    │   └── novelmania.js         # Adaptador para índice paginado via API e volumes
    └── workspace/
        ├── i18n.js               # Dicionários e tradução da interface (PT / EN)
        ├── theme-init.js         # Inicialização de tema sem FOUC
        ├── workspace.html        # Interface principal, Biblioteca e modais nativos
        ├── workspace.css         # Estilos adaptativos claro/escuro
        └── workspace.js          # Estado, cache, resiliência parcial e fila de download
```

---

## Onde Obter Ajuda

- **Logs de execução:** Acesse a aba **Logs** dentro da própria extensão e clique em **Baixar Log** para salvar o registro detalhado de rede ou extração.
- **Matriz de compatibilidade:** Veja [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) para consultar os sites e temas suportados.
- **Reportar bugs ou sugerir suporte a layouts:** Abra uma issue na aba **Issues** do repositório no GitHub descrevendo a estrutura HTML (seletores da lista de capítulos e do texto) junto com o log correspondente.
- **Documentação para desenvolvedores & testes:** Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes da arquitetura, suíte de testes (`node:test`, `EPUBCheck`, Playwright E2E) e instruções para criar novos adaptadores de parser.
- **Segurança:** Leia [SECURITY.md](.github/SECURITY.md) para reportar vulnerabilidades de forma privada.

---

## Mantenedores e Contribuições

O WebPullBook é um projeto open source mantido pelos **WebPullBook Contributors** sob a [Licença MIT](LICENSE) e segue nosso [Código de Conduta](.github/CODE_OF_CONDUCT.md).

Contribuições são muito bem-vindas — especialmente novos adaptadores estruturais em [src/parsers/](src/parsers/index.js), melhorias na interface e expansão da matriz em [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md). Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um pull request.
