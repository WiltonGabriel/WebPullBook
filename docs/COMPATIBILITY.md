# Matriz de Compatibilidade — WebPullBook

**🇧🇷 Português** | [🇺🇸 English](COMPATIBILITY.en.md)

Esta página documenta o status de compatibilidade do **WebPullBook** com sites de leitura seriada, motores de temas e fluxos de leitura em e-readers.

Como o WebPullBook utiliza uma arquitetura orientada a objetos baseada em padrões de estrutura DOM (`ParserRegistry`), ele não depende de URLs fixas no código-fonte e consegue extrair obras tanto de sites com suporte dedicado quanto de páginas HTML genéricas ou renderizadas via JavaScript (SPA).

---

## 1. Compatíveis Verificados

Locais e fluxos testados de ponta a ponta (extração de metadados, capa em alta resolução, detecção e separação de volumes, fidelidade linha por linha do texto nos capítulos e validação estrutural do arquivo final):

| Origem / Fluxo | Adaptador / Módulo | Detalhes da Verificação |
| :--- | :--- | :--- |
| **Central Novel** | `wp-lightnovel` | Testado de ponta a ponta no Google Chrome: índice com mais de 300 capítulos, detecção automática de 13 volumes, extração limpa de sinopse e gêneros, conversão de capa para JPEG, preservação de formatação inline (negrito, itálico, centralização, cartões de status) e geração tanto de **1 EPUB por Volume** quanto de **EPUB Único**. |
| **Kindle via Calibre (`AZW3` / `KFX` por Cabo USB)** | `epub-builder` | Os arquivos `.epub` gerados incluem metadados `calibre:series`, `calibre:series_index`, `belongs-to-collection` e `toc.ncx` híbrido, convertendo sem erros no Calibre (`ebook-convert`) para leitura via cabo USB no Kindle Paperwhite e outros modelos. |
| **Amazon Send to Kindle (Wi-Fi / Nuvem)** | `epub-builder` | Arquivos EPUB 3 validados com XHTML estrito (`application/xhtml+xml`) e CSS adaptativo compatível com a conversão automática da nuvem da Amazon. |

---

## 2. Possíveis Compatíveis

Estruturas de sites e modos de extração suportados nativamente pelos adaptadores heurísticos e ferramentas do WebPullBook:

| Categoria / Estrutura | Adaptador / Recurso | Como Funciona |
| :--- | :--- | :--- |
| **Temas WordPress de Novels (LightNovel / Tsundoku / Bilibili-style)** | `wp-lightnovel` | Detecta automaticamente blocos de volumes recolhíveis (`.ts-chl-collapsible`), listas de capítulos (`.eplister`), corpo de texto (`.epcontent`) e resolve a página de índice a partir de qualquer capítulo via breadcrumbs. |
| **Temas WordPress Madara (Novels e Webfics)** | `madara-theme` | Detecta automaticamente listas `.wp-manga-chapter`, divisões de volumes `.parent.has-child` e contêineres de leitura `.reading-content` / `.text-left`. |
| **Sites de Ficção Seriada, Blogs e Documentações em HTML** | `generic-html` | Analisa clusters de links repetidos no índice, segue paginação automática (`a[rel="next"]`, `.pagination a.next`) e extrai o corpo de texto por densidade de prosa (inspirado no Readability), além de ler metadados JSON-LD (`schema.org/Book`) e OpenGraph. |
| **Páginas Dinâmicas em JavaScript / SPA (React, Vue, Next.js)** | Modo Renderização via Aba (`renderWithTab`) | Quando ativado (ou via fallback automático), abre a página em uma aba em segundo plano para aguardar a hidratação do DOM via JavaScript antes de extrair o índice ou o capítulo. |
| **Layouts Personalizados via Seletores CSS** | Seletores Customizados (`Opções Avançadas`) | Permite informar manualmente o seletor CSS dos links de capítulos, do contêiner de texto e de elementos a excluir (anúncios/notas) sem precisar alterar código. |
| **Artigos e Capítulos em Abas Abertas** | Modo **Juntar Abas** (estilo EpubPress) | Captura todas as abas abertas da janela atual do navegador e compila o texto principal de cada página em um único ebook organizado. |

---

## 3. Não Compatíveis (Limitações Conhecidas)

Cenários que atualmente **não** são suportados pelo WebPullBook:

| Cenário | Motivo Técnico |
| :--- | :--- |
| **Plataformas com DRM Proprietário** | Serviços que entregam o texto criptografado em pacotes binários proprietários ou exigem aplicativos fechados para descriptografia. |
| **Texto Renderizado em `<canvas>` ou Imagens Embaralhadas** | Sites que desenham as letras como pixels em elementos `<canvas>` ou fatiam o texto em imagens sem nós de texto no DOM HTML (exigiria OCR). |
| **Paywalls Fechados sem Sessão no Navegador** | Capítulos bloqueados que não estão acessíveis na sessão atual do navegador do usuário. |
| **CAPTCHAs Interativos por Capítulo sem Sessão Prévia** | Se o servidor exigir resolução manual de desafio visual a cada requisição individual, é necessário abrir o site no navegador primeiro e utilizar um delay maior entre capítulos ou o modo de extração via aba. |

---

[← Voltar para o README principal](../README.md)
