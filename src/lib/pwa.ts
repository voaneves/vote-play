/**
 * Registro do service worker.
 *
 * Fica fora do caminho de render de propósito: é chamado depois do `load`, para
 * não competir por rede com o primeiro desenho da tela. A plateia escaneia o QR
 * e quer ver a votação; o cache pode esperar dois segundos.
 *
 * Em desenvolvimento não registra nada. Service worker em dev é a receita
 * clássica de "por que minha alteração não aparece".
 */
export function registrarServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const base = import.meta.env.BASE_URL || '/';

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // Falhar aqui é aceitável: sem service worker o app funciona igual, só
      // perde o cache offline. Não vale incomodar a plateia com isso.
    });
  });
}

/**
 * `true` enquanto o navegador se diz offline.
 *
 * `navigator.onLine` mente com frequência — diz "online" para wi-fi de bar que
 * aceita a conexão e não entrega pacote. Por isso ele NÃO decide nada sozinho na
 * tela do show: lá quem manda é o `ConnectionHealth`, que sabe se o dado
 * realmente chegou. Este aqui serve para as telas que não têm essa informação.
 */
export function estaOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
