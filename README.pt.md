# <img src="icons/icon.svg" width="32" height="32" align="absmiddle" alt="WebPullBook"> WebPullBook

[🇺🇸 English](README.md) | **🇧🇷 Português**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Chrome & Firefox](https://img.shields.io/badge/Navegadores-Chrome%20%7C%20Edge%20%7C%20Firefox%20128%2B-2563eb?style=flat-square)](#-primeiros-passos)
[![Versão](https://img.shields.io/badge/Vers%C3%A3o-1.4.0--beta-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
[![Dependências](https://img.shields.io/badge/Depend%C3%AAncias-Zero-16a34a?style=flat-square)](src/core/zip.js)
[![Licença: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-f59e0b?style=flat-square)](LICENSE)
[![CI Validation](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml/badge.svg)](https://github.com/WiltonGabriel/WebPullBook/actions/workflows/ci.yml)

**WebPullBook** é uma extensão de navegador open source (Chrome, Edge, Brave e Firefox 128+) e sem dependências externas para **converter páginas web em EPUB** (**Web-to-EPUB**): extrai webnovels, light novels, ficções seriadas, fanfics, blogs, documentações e abas abertas diretamente para **EPUB 2 / EPUB 3** (além de **HTML**, **Markdown** e **TXT**) limpos e organizados por volume para leitura offline no **Kindle**, **Kobo**, **Calibre** e celulares.

[Funcionalidades](#-principais-funcionalidades) • [Instalação](#-primeiros-passos) • [Compatibilidade](#-compatibilidade) • [Perguntas Frequentes](#-perguntas-frequentes-faq) • [Como Ajudar](#-mantenedores-e-contribuições)

---

## Por que usar o WebPullBook?

Ler obras longas, artigos ou séries com centenas de capítulos no navegador dificulta a leitura offline e em leitores E-Ink, enquanto imprimir ou converter PDFs individuais de capítulos costuma gerar quebras de linha erradas e sujeira de paginação. O WebPullBook extrai o HTML limpo diretamente das páginas no seu próprio navegador (sem servidores intermediários) e empacota ebooks fluídos, com capa, sumário navegável e metadados completos de série e volume no padrão EPUB.

### Casos de Uso Populares

- **Webnovels, Light Novels & Fanfics:** Baixe capítulos seriados agrupados por volume em EPUB 3 ou EPUB 2 compatível com Kindle (*Send to Kindle*), Kobo e Calibre.
- **Artigos, Blogs & Documentações:** Abra várias abas no navegador e use **Juntar Abas** para pré-visualizar, reordenar e gerar um único compilado ou vários ebooks independentes.
- **Sites Dinâmicos / Sem Índice Único:** Ative o rastreamento automático de **"Próximo Capítulo"** ou o **Modo SPA / JavaScript** quando páginas exigirem renderização no navegador ou não possuírem página de índice.

### Principais Funcionalidades

- **Extração Automática & Modo SPA:** Captura o DOM direto da aba ativa, detecta capítulos e volumes automaticamente em sites dedicados ou páginas HTML genéricas, suporta **Modo SPA / JavaScript** com proteção anti-bot e oferece seletor visual **`🎯 Apontar`** com regras salvas por domínio.
- **Perfis de Leitor & Estrutura Completa do Livro:** Predefinições em 1 clique para **Kindle (Moderno / Antigo)**, **Kobo**, **Padrão Moderno**, **Somente Texto** e **Padrão Antigo** ([guia](docs/READER_PRESETS.pt.md)), com **Sumário** no início do livro, **Página de Informações**, **Página Final do Livro (Colofão)** personalizável e **Notas Pop-up EPUB 3**.
- **Pré-visualização, Edição, Mesclagem & Imagens Resilientes:** Pré-visualize e edite capítulos antes de baixar, mescle capítulos selecionados, envie ou gere capas automaticamente e empacote imagens com detecção por *magic bytes*, deduplicação e fallback automático.
- **Seleção Ágil & Juntar Abas:** Marque ou desmarque todos os volumes em 1 clique, use **`Ctrl+Clique`** e **`Shift+Clique`** para selecionar volumes e capítulos em intervalo, ou junte várias abas abertas (**Juntar Abas**) em um único livro ou livros separados.
- **Modo Seguro Adaptativo, Latência Manual & Cache Local:** Ative o **Modo Seguro** ao vivo (adapta o ritmo ao servidor e respeita `Retry-After`), ajuste a **latência manual entre capítulos (0–30.000 ms)** em Opções Avançadas sem precisar do Modo Seguro e retome downloads pelo cache em **IndexedDB (7 dias)**.
- **Biblioteca & Atualizações em Lote:** Acompanhe obras salvas (unificadas ou separadas por site) e baixe todas as novidades em 1 clique (**Baixar Novidades**).
- **Pastas Personalizadas, Logs & 4 Temas:** Escolha qualquer pasta do PC e estrutura de subpastas (`%Root%/%Author%/%Title%`), consulte logs detalhados com filtros e alterne entre os temas **Claro**, **Escuro**, **Sépia** e **Meia-noite** no Chrome e Firefox 128+.

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
4. Clique em **Empacotar EPUB**. Por padrão, os arquivos são salvos em `Downloads/WebPullBook/<Título>/` — ou em qualquer pasta do PC e estrutura de subpastas configurada em **Opções Avançadas → Arquivos & Padrão EPUB**.
5. Para acompanhar lançamentos futuros, clique em **Salvar na Biblioteca**.

### Configurando Qualquer Site sem Programar

Ao abrir um site desconhecido, o WebPullBook detecta automaticamente quando precisa ativar o **Modo SPA / JavaScript** e tenta preencher os seletores CSS sugeridos sem você precisar configurar nada. Se quiser ajustar manualmente em **Opções Avançadas**, use **🎯 Apontar** na página ou clique em **Auto-detectar seletores**:

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
├── README.md                     # Documentação (English)
├── README.pt.md                  # Documentação (Português)
├── docs/
│   ├── COMPATIBILITY.md          # Tabela de compatibilidade (editável via PR)
│   └── READER_PRESETS.pt.md      # Guia de perfis de leitor (PT / EN)
├── icons/                        # Ícones da extensão
└── src/
    ├── background/
    │   └── service-worker.js     # Abre o workspace ao clicar no ícone da barra
    ├── core/
    │   ├── base-parser.js        # BaseParser (OOP) e pipeline de capítulos
    │   ├── cache-store.js        # Cache persistente em IndexedDB com expiração (TTL)
    │   ├── dnr-rules.js          # Regras temporárias declarativeNetRequest de navegação
    │   ├── epub-builder.js       # Orquestração EPUB 2/3 e reescrita de links internos
    │   ├── epub-css.js           # Gerador de CSS otimizado para e-readers
    │   ├── epub-templates.js     # Templates OPF, NCX, NAV, Capa, Info e Sumário
    │   ├── image-processor.js    # Sniffing por magic bytes, hash dedup e fallback canvas
    │   ├── net-fetcher.js        # HTTP com charset, captura da aba ativa, TabRenderPool e segurança SPA
    │   ├── parser-engine.js      # Fachada de re-export dos módulos centrais
    │   ├── rate-limiter.js       # AdaptiveRateLimiter (Modo Seguro adaptativo e Retry-After)
    │   ├── sanitizer.js          # HtmlSanitizer -> XHTML válido, __cf_email__, nextPrevUrls
    │   ├── selector-utils.js     # Gerador de seletores CSS para captura visual
    │   ├── text-utils.js         # Normalização, volumes, caminhos e capas
    │   ├── xhtml-serializer.js   # Serializador XHTML estrito e notas pop-up EPUB 3
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
        ├── chapters-ui.js        # Tabela de capítulos, volumes, edição na prévia e mesclagem
        ├── export-runner.js      # Fila de exportação, Pausar/Cancelar, Modo Seguro e saída
        ├── i18n.js               # Dicionários e tradução da interface (PT / EN)
        ├── library-ui.js         # Biblioteca salva, sessões de cache e lote de atualizações
        ├── logger.js             # Logs de diagnóstico, filtros e relatório pós-exportação
        ├── options-storage.js    # Opções persistentes, regras de domínio, perfis e prévia
        ├── series-loader.js      # Carregamento da obra, auto-SPA e auto-seletores CSS
        ├── state.js              # Estado centralizado, perfis e utilitários compartilhados
        ├── tab-picker.js         # Modal de juntar abas e seletor visual ponto-a-ponto
        ├── theme-init.js         # Inicialização de tema sem FOUC
        ├── workspace.css         # Estilos adaptativos claro/escuro/sépia/meia-noite
        ├── workspace.html        # Interface principal, Biblioteca e modais nativos
        └── workspace.js          # Orquestrador enxuto ligando eventos e ciclo de vida
```

---

## Onde Obter Ajuda

- **Logs de execução:** Acesse a aba **Logs** dentro da própria extensão e clique em **Baixar Log** para salvar o registro detalhado de rede ou extração.
- **Matriz de compatibilidade:** Veja [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) para consultar os sites e temas suportados.
- **Reportar bugs ou sugerir suporte a layouts:** Abra uma issue na aba **Issues** do repositório no GitHub descrevendo a estrutura HTML (seletores da lista de capítulos e do texto) junto com o log correspondente.
- **Documentação para desenvolvedores & testes:** Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes da arquitetura, suíte de testes (`node:test`, `EPUBCheck`, Playwright E2E) e instruções para criar novos adaptadores de parser.
- **Segurança:** Leia [SECURITY.md](.github/SECURITY.md) para reportar vulnerabilidades de forma privada.

---

## Perguntas Frequentes (FAQ)

- **Funciona no Kindle e no Kobo?** Sim! Escolha **Kindle (Antigo)** (EPUB 2 clássico para envio sem erros pela Amazon), **Kindle (Moderno)** (EPUB 3 completo a 1200px para conversão via Calibre/USB) ou **Kobo e Leitores Digitais** (EPUB 3 a 1080px mantendo cores nativas). Veja detalhes em [docs/READER_PRESETS.pt.md](docs/READER_PRESETS.pt.md).
- **Os dados passam por algum servidor externo?** Não. Todo o download, limpeza HTML e empacotamento ZIP/EPUB acontece 100% localmente dentro do seu navegador, usando cookies da sua própria sessão apenas quando necessário.
- **Um site específico não carregou os capítulos. O que fazer?** O WebPullBook já tenta SPA automático e heurística na hora do carregamento; para ajustes finos em sites exóticos, use **🎯 Apontar** nas **Opções Avançadas**, clique em **Auto-detectar seletores** e salve uma **Regra por Domínio** — ou abra uma issue!

---

## Mantenedores e Contribuições

O WebPullBook é um projeto open source mantido pelos **WebPullBook Contributors** sob a [Licença MIT](LICENSE) e segue nosso [Código de Conduta](.github/CODE_OF_CONDUCT.md).

### Como você pode ajudar (mesmo sem saber programar)

- **Testar sites e atualizar a compatibilidade:** Abra um PR adicionando sites testados na tabela de [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Reportar layouts ou bugs:** Abra uma issue em [Issues](https://github.com/WiltonGabriel/WebPullBook/issues) anexando o arquivo salvo em **Logs → Baixar Log**.
- **Desenvolver novos adaptadores e melhorias:** Leia [CONTRIBUTING.md](CONTRIBUTING.md) para criar parsers estruturais em [src/parsers/](src/parsers/index.js), aprimorar a heurística ou ajudar com traduções ([i18n.js](src/workspace/i18n.js)).
