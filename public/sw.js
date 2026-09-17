/**
 * Vote Play — service worker.
 *
 * O problema real que ele resolve: wi-fi de bar. A pessoa escaneia o QR, a
 * página carrega, e no meio do show a rede some por 20 segundos. Sem service
 * worker, um toque na tela nesse intervalo pode pedir um chunk que nunca chega
 * e a aba morre em branco — depois de ela já ter pago.
 *
 * REGRA CENTRAL: nada de dado ao vivo entra em cache. O placar, o snapshot do
 * show e qualquer chamada ao Supabase vão SEMPRE à rede. Um placar velho servido
 * como se fosse atual é pior que um erro honesto — é a mesma regra que o
 * ConnectionBanner aplica na interface.
 *
 * O que entra em cache é só a casca: HTML, JS, CSS e ícones.
 */

// Trocar a versão invalida tudo. O `activate` apaga as versões anteriores.
const VERSAO = 'vote-play-v2'; // v2: ícones novos (brand/gerar_icones.py)
const ESCOPO = new URL(self.registration.scope).pathname;

/**
 * Só o mínimo que não muda de nome entre builds.
 *
 * Os bundles têm hash no nome (index-BMBLy6R3.js), que só existe depois do
 * build — um arquivo estático em public/ não tem como saber. Então eles entram
 * no cache em tempo de execução, na primeira visita bem-sucedida.
 */
const CASCA = [
  ESCOPO,
  `${ESCOPO}index.html`,
  `${ESCOPO}favicon.svg?v=2`,
  `${ESCOPO}favicon.ico?v=2`,
  `${ESCOPO}icon-180.png?v=2`,
  `${ESCOPO}site.webmanifest?v=2`,
];

/** Último recurso: a primeira visita foi offline e não há nem index.html. */
const PAGINA_OFFLINE = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vote Play — sem conexão</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;
    background:#160A0E;color:#F7F4F3;font-family:system-ui,sans-serif;padding:24px}
  .c{max-width:22rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{color:#B6ABA5;line-height:1.5;margin:0 0 1.5rem}
  button{width:100%;padding:14px;border:0;border-radius:12px;
    background:#F24333;color:#1A0B10;font:inherit;font-weight:600}
</style></head>
<body><div class="c">
  <h1>Sem conexão</h1>
  <p>Não deu para carregar o Vote Play. Confira sua internet e tente de novo.</p>
  <button onclick="location.reload()">Tentar de novo</button>
</div></body></html>`;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) =>
      // addAll é tudo-ou-nada: um 404 em qualquer item aborta a instalação
      // inteira e o app fica sem service worker. Individualmente, o que falhar
      // simplesmente não entra.
      Promise.all(CASCA.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
  // Sem skipWaiting de propósito: trocar o worker com a aba aberta faria a
  // página pedir chunks de um build que o cache novo não tem. A versão nova
  // assume quando a pessoa fechar as abas — num show, o próximo que escanear.
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só GET. POST para RPC do Supabase nunca passa por aqui.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Outra origem = Supabase (REST, Realtime, Auth). Rede, sempre. Sem exceção:
  // é aqui que mora a diferença entre "o placar está atrasado" e "o placar é
  // mentira".
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro, para que um deploy novo chegue na hora. Sem rede,
  // devolve o index.html do cache e deixa o app se virar (ele tem tela para
  // offline). Sem nem isso, a página mínima acima.
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(`${ESCOPO}index.html`, copia));
          return resposta;
        })
        .catch(async () => {
          const cache = await caches.open(VERSAO);
          return (
            (await cache.match(`${ESCOPO}index.html`)) ??
            new Response(PAGINA_OFFLINE, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }),
    );
    return;
  }

  // Bundles com hash no nome são imutáveis: se está no cache, é o arquivo certo.
  // Cache primeiro economiza a rede exatamente quando ela está ruim.
  const imutavel = url.pathname.includes('/assets/');

  evento.respondWith(
    caches.open(VERSAO).then(async (cache) => {
      const guardado = await cache.match(req);
      if (guardado && imutavel) return guardado;

      const daRede = fetch(req)
        .then((resposta) => {
          if (resposta.ok && resposta.type === 'basic') cache.put(req, resposta.clone());
          return resposta;
        })
        .catch(() => guardado);

      // Para o que não é imutável (ícones, manifest): devolve o cache na hora e
      // atualiza por baixo.
      return guardado ?? daRede;
    }),
  );
});
