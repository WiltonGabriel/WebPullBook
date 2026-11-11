# WebPullBook

**🇧🇷 Português** | [🇺🇸 English](README.en.md)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Versão](https://img.shields.io/badge/Vers%C3%A3o-1.0.0-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependências](https://img.shields.io/badge/Depend%C3%AAncias-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![Licença: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** é uma extensão de navegador open source e sem dependências externas que extrai obras seriadas, webnovels, páginas com múltiplos capítulos e abas abertas diretamente para arquivos **EPUB 2 / EPUB 3** (além de **HTML**, **Markdown** e **TXT**) limpos e organizados por volume no próprio navegador.

---

## Por que usar o WebPullBook?

Ler obras longas com centenas de capítulos no navegador dificulta a leitura offline e em leitores digitais, enquanto converter PDFs individuais de capítulos costuma gerar quebras de linha erradas e sujeira de paginação. O WebPullBook extrai o HTML limpo diretamente das páginas e empacota ebooks fluídos, com sumário navegável e metadados prontos para Kindle e Calibre.

### Principais Funcionalidades

- **Detecção Automática e Divisão por Volumes:** Identifica volumes por seções recolhíveis, prefixos de capítulo ou slugs de URL, permitindo gerar **1 Arquivo por Volume** (com metadados `calibre:series` e `calibre:series_index`) ou um **Arquivo Único** com sumário aninhado por volume e capítulo.
- **Editor Manual de Volumes:** Divida automaticamente a cada *N* capítulos, defina faixas (`do # ao #`), atribua aos capítulos selecionados, edite direto na tabela ou aplique regras em lote (ex.: `1-24: Volume 01`).
- **Resiliência a Falhas Parciais & Cache de Capítulos:** Se 1 capítulo falhar no meio de um lote grande, o download continua sem perder o progresso. Os capítulos já baixados ficam em cache na sessão e o botão **Tentar Falhos** baixa apenas os que faltaram antes de reempacotar o livro.
- **Modo SPA / JavaScript (Renderização via Aba):** Suporta páginas dinâmicas em React/Vue/Next.js abrindo uma aba em segundo plano (`chrome.tabs` + `chrome.scripting`) para hidratar o DOM automaticamente quando o `fetch` estático não encontra o texto.
- **Modo Juntar Abas Abertas (Estilo EpubPress):** Capture todas as abas abertas na janela atual do navegador e compile os artigos ou capítulos abertos em um único ebook com 1 clique.
- **Biblioteca & Lista de Leitura Integrada:** Salve obras acompanhadas na aba **Biblioteca** (`chrome.storage.local`) e use **Carregar & Marcar Novos** para detectar e selecionar automaticamente apenas os capítulos lançados desde o seu último download.
- **Arquitetura Modular Orientada a Objetos:** O `ParserRegistry` ([src/parsers/](src/parsers/index.js)) ranqueia adaptadores que herdam de `BaseParser` por pontuação de estrutura DOM, enquanto o `ExporterRegistry` ([src/exporters/](src/exporters/index.js)) exporta em **EPUB 2/3**, **HTML Único offline**, **Markdown (.md)** e **Texto Puro (.txt)**.
- **Sanitização XHTML & Tipografia Inteligente:** O `HtmlSanitizer` ([src/core/sanitizer.js](src/core/sanitizer.js)) preserva negrito, itálico, sublinhado, tachado, alinhamentos (`wpb-center`, `wpb-right`), escalas relativas (`<big>`, `<small>`) e blocos de citação sem travar fontes fixas em `px` ou cores que quebram o modo noturno do Kindle.
- **Interface Bilíngue e Adaptativa:** Interface completa em **Português (pt-BR)** e **Inglês (en)**, com tema claro, escuro e automático do sistema.

---

## Compatibilidade

A lista completa de **Compatíveis Verificados**, **Possíveis Compatíveis** e **Não Compatíveis** está disponível na documentação dedicada:

- 📄 **[Matriz de Compatibilidade (Português)](docs/COMPATIBILITY.md)**
- 📄 **[Compatibility Matrix (English)](docs/COMPATIBILITY.en.md)**

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

### Uso Rápido

1. Abra no navegador a página de índice de capítulos (ou qualquer capítulo) da obra desejada.
2. Clique no ícone do **WebPullBook** na barra do navegador para abrir a aba de trabalho — os metadados e capítulos são carregados automaticamente.
3. Escolha **1 Arquivo por Volume** ou **Arquivo Único**, selecione o formato de saída (**EPUB**, **HTML**, **MD** ou **TXT**) e ajuste o intervalo de capítulos se desejar.
4. Clique em **Empacotar EPUB**. Os arquivos gerados serão salvos em `Downloads/WebPullBook/<Título>/`.
5. Para acompanhar lançamentos futuros, clique em **Salvar na Biblioteca**.

### Configurando Qualquer Site sem Programar

Caso um site utilize um layout HTML diferente ou renderize via JavaScript, abra **Opções Avançadas** e ajuste os seletores CSS ou ative o **Modo SPA / JavaScript**:

```text
Seleção de Parser:                   Genérico (Qualquer página HTML)
Seletor CSS da lista de capítulos:   .chapter-list a
Seletor CSS do conteúdo:             article .chapter-body
Seletor CSS de elementos a excluir:  .ads, .translator-note
```

### Enviando para o Kindle

- **Send to Kindle (Wi-Fi / Nuvem):** Envie os arquivos `.epub` gerados diretamente pelo serviço Send to Kindle da Amazon.
- **Transferência via Cabo USB (Kindle Paperwhite e outros):** O sistema do Kindle não lê `.epub` copiado direto por USB. Importe os `.epub` no **Calibre** e converta para **`.azw3`** ou **`.kfx`** (o nome da série e o número do volume já vão preenchidos automaticamente).

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
│   ├── COMPATIBILITY.md          # Matriz de compatibilidade (Português)
│   └── COMPATIBILITY.en.md       # Matriz de compatibilidade (English)
├── icons/                        # Ícones da extensão
└── src/
    ├── background/
    │   └── service-worker.js     # Abre o workspace ao clicar no ícone da barra
    ├── core/
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
    │   ├── wp-lightnovel.js      # Adaptador para temas WordPress de ficção seriada
    │   ├── madara-theme.js       # Adaptador para temas estilo Madara
    │   └── generic-html.js       # Extrator heurístico estilo Readability + paginação
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
- **Documentação para desenvolvedores:** Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes da arquitetura e instruções para criar novos adaptadores de parser.
- **Segurança:** Leia [SECURITY.md](.github/SECURITY.md) para reportar vulnerabilidades de forma privada.

---

## Mantenedores e Contribuições

O WebPullBook é um projeto open source mantido pelos **WebPullBook Contributors** sob a [Licença MIT](LICENSE) e segue nosso [Código de Conduta](.github/CODE_OF_CONDUCT.md).

Contribuições são muito bem-vindas — especialmente novos adaptadores estruturais em [src/parsers/](src/parsers/index.js), melhorias na interface e expansão da matriz em [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md). Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir um pull request.
