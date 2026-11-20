# Guia de Perfis de Leitor

[English](READER_PRESETS.md) | **Português**

O **WebPullBook** inclui **Perfis de Leitor** (disponíveis tanto na aba principal **Obra** quanto no topo de **Opções Avançadas**). Cada perfil ajusta várias configurações técnicas de uma vez — tudo o que um perfil altera também pode ser conferido e modificado individualmente nas **Opções Avançadas**.

Os perfis são **predefinições fixas** e não podem ser editados. Sempre que você altera **qualquer** opção em **Opções Avançadas** (mesmo uma que o perfil não controla, como o atraso entre requisições), o seletor muda para **Personalizado** e permanece assim até você escolher um perfil novamente. Ao escolher um perfil, todas as opções dele são preenchidas de uma vez.

Cada perfil define o mesmo conjunto de Opções Avançadas: padrão EPUB, notas pop-up, capa JPEG, otimização e resolução de imagens, formato/qualidade das imagens, ignorar imagens, fonte, alinhamento, espaçamento entre linhas e recuo de parágrafo. Ao escolher um perfil (na aba **Obra** ou em **Opções Avançadas**), todos esses campos são atualizados na tela. O seletor lista os perfis nesta ordem: Padrão Moderno, Kobo e Leitores Digitais, Kindle (Moderno), Kindle (Antigo), Somente Texto, Padrão Antigo, Personalizado.

---

## Tabela Comparativa dos Perfis

| Perfil | Padrão EPUB | Notas Pop-up | Capa JPEG | Otimização de Imagens | Resolução Máx. | Alinhamento | Indicado para |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Padrão Moderno** (`modern`) | EPUB 3 | Sim | Sim | Original (sem compressão) | Original | Justificado | Celulares, tablets, Apple Books, Thorium, Calibre Viewer |
| **Kobo e Leitores Digitais** (`kobo`) | EPUB 3 | Sim | Sim | JPEG comprimido | 1080px | Justificado | Kobo (inclusive Clara/Libra Colour), Tolino, PocketBook |
| **Kindle (Moderno)** (`kindle-modern`) | EPUB 3 | Sim | Sim | JPEG comprimido | 1200px | Justificado | Conversão via Calibre (KFX/AZW3 por USB), Kindle Colorsoft |
| **Kindle (Antigo)** (`kindle`) | EPUB 2 | Não | Sim | JPEG comprimido | 1200px | Justificado | Envio por *Send to Kindle* (e-mail/web/app) compatível com conversor Amazon |
| **Somente Texto** (`textonly`) | EPUB 3 | Sim | Sim | Ignora imagens | — | Justificado | Livros compostos apenas por texto sem imagens internas |
| **Padrão Antigo** (`legacy`) | EPUB 2 | Não | Sim | JPEG comprimido | 1080px | Justificado | Aparelhos antigos (Sony Reader, Nook antigo, CoolReader) |
| **Personalizado** (`custom`) | Manual | Manual | Manual | Manual | Manual | Manual | Ativado automaticamente ao editar qualquer opção avançada |

---

## Qual Perfil Escolher?

1. **Vai enviar para a Amazon pelo *Send to Kindle* (e-mail, site ou app)?**
   Use **Kindle (Antigo)**. O conversor em nuvem da Amazon pode rejeitar certas tags de EPUB 3 por e-mail; o **EPUB 2** clássico evita rejeições na conversão, mantendo imagens em 1200px para telas de 300 PPI (Paperwhite / Colorsoft).
2. **Vai transferir para o Kindle pelo Calibre (cabo USB → KFX/AZW3)?**
   Use **Kindle (Moderno)** para entregar ao Calibre um **EPUB 3** completo com sumário semântico e **Notas Pop-up EPUB 3**.
3. **Usa Kobo, Tolino ou PocketBook?**
   Use **Kobo e Leitores Digitais** — saída EPUB 3 com otimização de imagens em 1080px e cores preservadas para telas E-Ink coloridas.
4. **Lê no celular, tablet ou computador?**
   Use **Padrão Moderno** para manter a resolução original das imagens e os recursos do EPUB 3.
5. **Usa um e-reader antigo que não abre arquivos EPUB 3?**
   Use **Padrão Antigo** (EPUB 2.0.1 com `toc.ncx`, sem SVG de capa e imagens JPEG a 1080px para respeitar limites baixos de memória RAM).
