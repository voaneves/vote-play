import { useSyncExternalStore } from 'react';

/**
 * O que o NAVEGADOR acha da conexão.
 *
 * Note o "acha": `navigator.onLine` só sabe se existe uma interface de rede
 * ativa. Wi-fi de bar que aceita a associação e não entrega pacote nenhum
 * reporta `true` alegremente. Por isso este hook nunca decide sozinho se o
 * placar está atualizado — quem sabe disso é o `ConnectionHealth`, que mede se
 * o dado realmente chegou.
 *
 * O valor dele está no negativo: quando diz `false`, está certo. Aparelho em
 * modo avião ou fora do alcance é informação confiável e vale avisar na hora,
 * em qualquer tela — inclusive nas que não falam com o servidor.
 *
 * Implementado com `useSyncExternalStore`, e não com `useState` + `useEffect`,
 * porque `navigator.onLine` é exatamente o que essa API existe para ler: uma
 * fonte mutável fora do React. A versão com efeito precisava de um `setState`
 * dentro do efeito para cobrir a janela entre render e assinatura — e é
 * justamente esse padrão que o `eslint-plugin-react-hooks` 7 reprova, com razão:
 * ele rende render em cascata. Aqui o React lê o valor no momento certo sozinho.
 */

function assinar(aoMudar: () => void): () => void {
  window.addEventListener('online', aoMudar);
  window.addEventListener('offline', aoMudar);
  return () => {
    window.removeEventListener('online', aoMudar);
    window.removeEventListener('offline', aoMudar);
  };
}

function lerDoNavegador(): boolean {
  return navigator.onLine !== false;
}

/** Sem DOM (build, teste) assume online: não há o que avisar. */
function lerNoServidor(): boolean {
  return true;
}

export function useOnline(): boolean {
  return useSyncExternalStore(assinar, lerDoNavegador, lerNoServidor);
}
