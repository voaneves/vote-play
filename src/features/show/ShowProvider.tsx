import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import type { ConnectionHealth, ShowTransport } from '@/lib/api/types';
import { ShowContext, type ShowContextValue } from './context';
import type { AudienceSession, ShowPublic, ShowState } from '@/types/domain';

/**
 * Tentativas automáticas quando o banco recusa a entrada por rate limit.
 *
 * No começo do show a casa inteira escaneia o QR ao mesmo tempo, atrás do mesmo
 * IP. Se o teto de proteção for tocado, a pessoa NÃO pode ver uma tela de erro
 * com botão — ela desiste, e a rodada dura 5 minutos. A tela continua em
 * "entrando" e o app tenta de novo sozinho, com espera aleatória para que as
 * tentativas não voltem todas no mesmo instante e toquem o teto de novo.
 */
const JOIN_RETRY_BASE_MS = 1_000;
const JOIN_RETRY_MAX_MS = 15_000;
const JOIN_RETRY_LIMIT = 12; // ≈ 2 minutos no pior caso

type Connection =
  | { status: 'loading'; busy: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; show: ShowPublic; session: AudienceSession };

export function ShowProvider({
  joinCode,
  transport = 'poll',
  children,
}: {
  joinCode: string;
  /** `poll` para a plateia, `realtime` para o telão. Ver ShowTransport. */
  transport?: ShowTransport;
  children: ReactNode;
}) {
  const [connection, setConnection] = useState<Connection>({ status: 'loading', busy: false });
  const [state, setState] = useState<ShowState | null>(null);
  const [health, setHealth] = useState<ConnectionHealth>('connecting');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [settledAttempt, setSettledAttempt] = useState(0);
  const refreshRef = useRef<() => void>(() => {});

  // Ajuste de estado em render (padrão do React para reagir a uma mudança de entrada).
  // Fazer isso dentro do efeito dispararia um render em cascata a cada nova tentativa.
  if (attempt !== settledAttempt) {
    setSettledAttempt(attempt);
    setConnection({ status: 'loading', busy: false });
    setState(null);
    setHealth('connecting');
    setLastSyncedAt(null);
  }

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let wait: ReturnType<typeof setTimeout> | null = null;

    const enter = async (tries: number): Promise<void> => {
      try {
        // A sessão que vale é SEMPRE a do servidor. `join_show` é idempotente
        // por aparelho, então devolve a mesma sessão de antes — já com o @ e o
        // toque em "Seguir" atualizados. A cópia antiga no localStorage
        // preferida aqui fazia o portão do Instagram reaparecer ao recarregar.
        const { show, session } = await api.join(joinCode);
        if (cancelled) return;

        setConnection({ status: 'ready', show, session });

        const sub = api.subscribeShow(
          show.id,
          session.id,
          {
            onState: (next) => {
              if (cancelled) return;
              setState(next);
              setLastSyncedAt(Date.now());
              setClockOffsetMs(new Date(next.serverTime).getTime() - Date.now());
            },
            onHealth: (next) => {
              if (!cancelled) setHealth(next);
            },
          },
          { transport },
        );
        unsubscribe = sub.unsubscribe;
        refreshRef.current = sub.refresh;
      } catch (err) {
        if (cancelled) return;

        if (err instanceof ApiError && err.code === 'rate_limited' && tries < JOIN_RETRY_LIMIT) {
          setConnection({ status: 'loading', busy: true });
          const ceiling = Math.min(JOIN_RETRY_MAX_MS, JOIN_RETRY_BASE_MS * 2 ** tries);
          // "full jitter": espera sorteada entre 0,5 s e o teto da vez
          wait = setTimeout(() => void enter(tries + 1), 500 + Math.random() * ceiling);
          return;
        }

        setConnection({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'Não foi possível conectar ao show. Verifique sua internet.',
        });
      }
    };

    void enter(0);

    return () => {
      cancelled = true;
      if (wait) clearTimeout(wait);
      unsubscribe?.();
      refreshRef.current = () => {};
    };
  }, [joinCode, attempt, transport]);

  const value = useMemo<ShowContextValue>(
    () => ({
      status: connection.status,
      busy: connection.status === 'loading' && connection.busy,
      error: connection.status === 'error' ? connection.message : null,
      show: connection.status === 'ready' ? connection.show : null,
      session: connection.status === 'ready' ? connection.session : null,
      state,
      health,
      lastSyncedAt,
      clockOffsetMs,
      retry,
      refresh,
    }),
    [connection, state, health, lastSyncedAt, clockOffsetMs, retry, refresh],
  );

  return <ShowContext.Provider value={value}>{children}</ShowContext.Provider>;
}
