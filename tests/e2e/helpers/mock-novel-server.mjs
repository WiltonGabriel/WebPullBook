import http from 'node:http';

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/**
 * Shared local mock server for Chromium & Firefox unpacked extension E2E tests.
 */
export function createMockNovelServer() {
  const serverState = {
    newChapterAdded: false,
    flakyAttempts: 0
  };

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const origin = `http://127.0.0.1:${server.address().port}`;

    if (reqUrl.pathname === '/series/e2e-book/') {
      const cap3Li = serverState.newChapterAdded
        ? `<li><a href="${origin}/series/e2e-book/cap-03/"><div class="epl-num">Cap. 3</div><div class="epl-title">Terceiro Ato</div></a></li>\n      `
        : '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>E2E Novel — Teste</title>
</head>
<body>
  <div class="thumbook"><div class="thumb"><img src="${origin}/cover.png" alt="Capa"></div></div>
  <div class="infox">
    <h1 class="entry-title">Crônica E2E</h1>
    <div class="spe"><span>Autor: Autora E2E</span><span>Status: Completo</span></div>
    <div class="genxed"><a href="#">Fantasia</a></div>
  </div>
  <div class="synp"><div class="entry-content" itemprop="description"><p>Sinopse E2E automatizada.</p></div></div>
  <div class="ts-chl-collapsible">Volume 1</div>
  <div class="ts-chl-collapsible-content">
    <div class="eplister"><ul>
      ${cap3Li}<li><a href="${origin}/series/e2e-book/cap-02/"><div class="epl-num">Cap. 2</div><div class="epl-title">Segundo Ato</div></a></li>
      <li><a href="${origin}/series/e2e-book/cap-01/"><div class="epl-num">Cap. 1</div><div class="epl-title">Primeiro Ato</div></a></li>
    </ul></div>
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/e2e-book/cap-01/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Cap. 1</title></head>
<body>
  <h1 class="entry-title">Capítulo 1 — Primeiro Ato</h1>
  <div class="epcontent">
    <p>Conteúdo principal do primeiro capítulo com <b>negrito</b>.</p>
    <img src="${origin}/art-ok.png" alt="Ilustração">
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/e2e-book/cap-02/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Cap. 2</title></head>
<body>
  <h1 class="entry-title">Capítulo 2 — Segundo Ato</h1>
  <div class="epcontent">
    <p>Conteúdo do segundo capítulo com imagem bloqueada.</p>
    <img src="${origin}/blocked-403.png" alt="Imagem 403">
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/e2e-book/cap-03/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Cap. 3</title></head>
<body>
  <h1 class="entry-title">Capítulo 3 — Terceiro Ato</h1>
  <div class="epcontent">
    <p>Novo capítulo publicado para testar atualização e imagem protegida por Referer.</p>
    <img src="${origin}/hotlink-pic.png" alt="Hotlink">
  </div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/flaky-book/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Livro Instável E2E</title></head>
<body>
  <div class="thumbook"><div class="thumb"><img src="${origin}/cover.png" alt="Capa"></div></div>
  <div class="infox">
    <h1 class="entry-title">Livro Instável E2E</h1>
    <div class="spe"><span>Autor: Teste Resiliência</span></div>
  </div>
  <div class="eplister"><ul>
    <li><a href="${origin}/series/flaky-book/c2"><div class="epl-num">Cap. 2</div><div class="epl-title">Recuperável</div></a></li>
    <li><a href="${origin}/series/flaky-book/c1"><div class="epl-num">Cap. 1</div><div class="epl-title">Saudável</div></a></li>
  </ul></div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/flaky-book/c1') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1 class="entry-title">Capítulo 1</h1><div class="epcontent"><p>Parágrafo estável do capítulo inicial.</p></div></body></html>');
      return;
    }

    if (reqUrl.pathname === '/series/flaky-book/c2') {
      serverState.flakyAttempts++;
      if (serverState.flakyAttempts === 1) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Temporary error');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1 class="entry-title">Capítulo 2</h1><div class="epcontent"><p>Capítulo recuperado após retentativa bem-sucedida.</p><img src="' + origin + '/hotlink-pic.png" alt="Hotlink"></div></body></html>');
      return;
    }

    if (reqUrl.pathname === '/series/slow-book/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Livro Lento E2E</title></head>
<body>
  <div class="infox"><h1 class="entry-title">Livro Lento E2E</h1><div class="spe"><span>Autor: Teste Controle</span></div></div>
  <div class="eplister"><ul>
    <li><a href="${origin}/series/slow-book/c2"><div class="epl-num">Cap. 2</div><div class="epl-title">Lento</div></a></li>
    <li><a href="${origin}/series/slow-book/c1"><div class="epl-num">Cap. 1</div><div class="epl-title">Inicial</div></a></li>
  </ul></div>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/series/slow-book/c1') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1 class="entry-title">Capítulo 1</h1><div class="epcontent"><p>Primeiro capítulo rápido antes da pausa.</p></div></body></html>');
      return;
    }

    if (reqUrl.pathname === '/series/slow-book/c2') {
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body><h1 class="entry-title">Capítulo 2</h1><div class="epcontent"><p>Segundo capítulo entregue após retomada.</p></div></body></html>');
        }
      }, 2500);
      return;
    }

    if (reqUrl.pathname === '/generic-novel/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Generic Auto Detect Novel</title></head>
<body>
  <main>
    <h1>Obra Genérica Auto-Detectada</h1>
    <ul class="novel-toc">
      <li><a href="${origin}/generic-novel/c1">Capítulo 1 — Início</a></li>
      <li><a href="${origin}/generic-novel/c2">Capítulo 2 — Meio</a></li>
    </ul>
  </main>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/generic-novel/c1') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Capítulo 1</title></head>
<body>
  <article class="prose-story">
    <h2>Capítulo 1 — Início</h2>
    <p>Este é um parágrafo suficientemente longo de ficção para acionar a heurística automática de conteúdo principal sem configuração manual.</p>
    <p>Outro parágrafo narrativo completo para confirmar o extrator universal inteligente no navegador.</p>
  </article>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/generic-novel/c2') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Capítulo 2</title></head>
<body>
  <article class="prose-story">
    <h2>Capítulo 2 — Meio</h2>
    <p>Segundo capítulo da obra genérica carregada automaticamente pelo detector inteligente de seletores.</p>
  </article>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/spa-novel/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>SPA Shell</title>
  <script type="module" src="/spa-app.js"></script>
</head>
<body>
  <div id="root">
    <div class="skeleton"></div>
    <div class="skeleton"></div>
  </div>
  <script>
    setTimeout(() => {
      const root = document.getElementById('root');
      root.innerHTML = '<h1>Livro SPA E2E</h1><ul class="spa-toc"><li><a href="${origin}/spa-novel/ch-1">Capítulo 1 SPA</a></li></ul>';
    }, 150);
  </script>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/spa-novel/ch-1') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>SPA Chapter</title>
  <script type="module" src="/spa-app.js"></script>
</head>
<body>
  <div id="root">
    <div class="skeleton"></div>
  </div>
  <script>
    setTimeout(() => {
      const root = document.getElementById('root');
      root.innerHTML = '<article class="spa-chapter"><h2>Capítulo 1 SPA</h2><p>Prosa hidratada via JavaScript para validar o TabRenderPool e executeScript em E2E real.</p><p>Segundo parágrafo narrativo hidratado dinamicamente no navegador.</p></article>';
    }, 120);
  </script>
</body>
</html>`);
      return;
    }

    if (reqUrl.pathname === '/spa-app.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end('/* mock spa entry */');
      return;
    }

    if (reqUrl.pathname === '/cover.png' || reqUrl.pathname === '/art-ok.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_1X1);
      return;
    }

    if (reqUrl.pathname === '/hotlink-pic.png') {
      const ref = String(req.headers.referer || '');
      if (ref.startsWith(origin)) {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(PNG_1X1);
      } else {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Hotlink blocked');
      }
      return;
    }

    if (reqUrl.pathname === '/blocked-403.png') {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return { server, serverState };
}
