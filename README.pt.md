# <img src="icons/icon.svg" width="32" height="32" align="absmiddle" alt="WebPullBook"> WebPullBook

[🇺🇸 English](README.md) | **🇧🇷 Português**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4338ca?style=flat-square)](manifest.json)
[![Chrome & Firefox](https://img.shields.io/badge/Navegadores-Chrome%20%7C%20Edge%20%7C%20Firefox%20128%2B-2563eb?style=flat-square)](#-primeiros-passos)
[![Versão](https://img.shields.io/badge/Vers%C3%A3o-1.3.0--beta-0ea5e9?style=flat-square)](https://github.com/WiltonGabriel/WebPullBook/releases)
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

- **Motor Universal Inteligente (`Universal Smart Extractor`) & Regras por Domínio:** Extrai séries automaticamente a partir de padrões universais (JSON-LD/Schema.org, Open Graph, listas semânticas, densidade de texto no estilo Readability e rastreamento automático de links *"Próximo Capítulo"* quando não há sumário). Nas **Opções Avançadas**, você conta com **assistente heurístico de seletores CSS**, **filtro de texto / Regex** para limpar assinaturas ou avisos repetitivos, e **regras reutilizáveis por domínio** (além da escolha manual de parser).
- **Pré-visualização de Capítulo (*Dry-Run*) & Capa Flexível:** Pré-visualize qualquer capítulo limpo antes de baixar toda a obra, envie uma **capa local** (`.jpg`/`.png`/`.webp`) ou use o **gerador automático de capa** em tela cheia quando o site não fornece imagem.
- **Perfis Rápidos de Leitor & Detecção Automática de Volumes:** Escolha com 1 clique perfis prontos (**Padrão Moderno**, **Kindle**, **Kobo e Leitores Digitais** com escala de cinza E-Ink, **Somente Texto** ou **Padrão Antigo** para aparelhos legados). Os volumes são detectados por seções recolhíveis, cabeçalhos, prefixos ou URLs (com botão **Tentar novamente** e editor manual por faixas/lotes).
- **Juntar Abas Abertas Interativo:** Ao clicar em **Juntar Abas**, um modal lista as abas HTTP/HTTPS detectadas já selecionadas, com **pré-visualização (👁️)**, reordenação, alternância entre janela atual ou todas as janelas e escolha entre **Mesmo livro**, **Mesmo livro dividido em Volumes** ou **Livros diferentes (1 EPUB separado por aba)**.
- **Velocidade Paralela, Cache Local (`IndexedDB`) & Modo Seguro:** Ajuste **downloads simultâneos (1x a 6x)** para sites rápidos ou ative/desative o **Modo Seguro** a qualquer momento (limite de RPM, *jitter* aleatório e pausa automática em `HTTP 429`/`503`). Capítulos baixados ficam em cache local (**7 dias** por padrão) para retomar downloads interrompidos.
- **Destino Personalizado & Organização de Pastas:** Salve na pasta **Downloads** ou escolha **qualquer pasta do computador** (`File System Access API`), defina o **nome da pasta principal**, escolha layouts prontos (`Pasta / Título`, `Pasta / Autor / Título`, `Autor / Título`, `Formato`, sem subpastas ou modelo personalizado com tokens como `%Root%/%Author%/%Title%`) e veja a **prévia ao vivo do caminho salvo**.
- **Tipografia ao Vivo & Backup Modular:** Personalize fonte base, alinhamento, entrelinha e recuo com **pré-visualização ao vivo** e editor completo de CSS, além de exportação/importação de backup JSON (`opções + regras de domínio`) e confirmação de restauração por seção (**Restaurar Padrão**) ou global (**Restaurar Tudo**).
- **Biblioteca & Checagem em Lote:** Salve obras na aba **Biblioteca** (`chrome.storage.local`), verifique todas de uma vez com **Verificar Todas** e use **Checar Novos** para selecionar apenas capítulos lançados desde o último pacote.
- **Multi-Navegador, Layout em 2 Colunas & 4 Temas:** Funciona em **Chrome/Chromium** e **Mozilla Firefox 128+** em Manifest V3 puro, com layout responsivo em 2 colunas, abas acessíveis via teclado, interface bilíngue (**pt-BR** / **en**) e seletor direto no topo (**Auto**, **Claro**, **Escuro**, **Sépia** e **Meia-noite**).

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
├── README.md                     # Documentação (English)
├── README.pt.md                  # Documentação (Português)
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

## Perguntas Frequentes (FAQ)

- **Funciona no Kindle e no Kobo?** Sim! Você pode selecionar o perfil **Kindle** (gera EPUB 2 clássico com JPEG otimizado, ideal para *Send to Kindle* e Calibre) ou **Kobo e Leitores Digitais** (converte capa e imagens internas para escala de cinza E-Ink).
- **Os dados passam por algum servidor externo?** Não. Todo o download, limpeza HTML e empacotamento ZIP/EPUB acontece 100% localmente dentro do seu navegador, usando cookies da sua própria sessão apenas quando necessário.
- **Um site específico não carregou os capítulos. O que fazer?** Clique em **Opções Avançadas → Auto-detectar seletores**, ative **Modo SPA / JavaScript** se o conteúdo carregar via script e salve uma **Regra por Domínio**. Você também pode abrir uma issue usando o template de suporte a sites!

---

## Mantenedores e Contribuições

O WebPullBook é um projeto open source mantido pelos **WebPullBook Contributors** sob a [Licença MIT](LICENSE) e segue nosso [Código de Conduta](.github/CODE_OF_CONDUCT.md).

### Como você pode ajudar (mesmo sem saber programar)

- **Testar sites e atualizar a compatibilidade:** Abra um PR adicionando sites testados na tabela de [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Reportar layouts ou bugs:** Abra uma issue em [Issues](https://github.com/WiltonGabriel/WebPullBook/issues) anexando o arquivo salvo em **Logs → Baixar Log**.
- **Desenvolver novos adaptadores e melhorias:** Leia [CONTRIBUTING.md](CONTRIBUTING.md) para criar parsers estruturais em [src/parsers/](src/parsers/index.js), aprimorar a heurística ou ajudar com traduções ([i18n.js](src/workspace/i18n.js)).
