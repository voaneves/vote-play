import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ConnectionHealth } from '@/lib/api/types';
import type { RepertoireState } from '@/types/domain';

/**
 * Acompanha a fila do repertório enquanto `active` for verdadeiro.
 *
 * `active` existe por causa do plano Free: cada assinatura é uma consulta a
 * cada ~10 s. A aba fechada, ou o telão com rodada aberta, não precisa dela —
 * então nem consulta. Ao reativar, a última fila conhecida continua na tela
 * até a leitura nova chegar, em vez de piscar vazia.
 */
export function useRepertoire(
  showId: string | null,
  sessionId: string | null,
  active: boolean,
) {
  const [state, setState] = useState<RepertoireState | null>(null);
  const [health, setHealth] = useState<ConnectionHealth>('connecting');
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || !showId || !sessionId) return;
    const sub = api.subscribeRepertoire(showId, sessionId, {
      onState: setState,
      onHealth: setHealth,
    });
    refreshRef.current = sub.refresh;
    return () => {
      sub.unsubscribe();
      refreshRef.current = () => {};
    };
  }, [active, showId, sessionId]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { state, health, refresh };
}
