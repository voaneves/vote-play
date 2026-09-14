import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { ShowContext, type ShowContextValue } from './context';
import type { AudienceSession, ShowPublic, ShowState } from '@/types/domain';

const SESSION_KEY = (code: string) => `vp:session:${code.toUpperCase()}`;

function loadSession(code: string): AudienceSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY(code));
    return raw ? (JSON.parse(raw) as AudienceSession) : null;
  } catch {
    return null;
  }
}

function saveSession(code: string, session: AudienceSession) {
  try {
    localStorage.setItem(SESSION_KEY(code), JSON.stringify(session));
  } catch {
    /* modo privado / storage cheio: a sessão vira efêmera, o app segue funcionando */
  }
}

type Connection =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; show: ShowPublic; session: AudienceSession };

export function ShowProvider({
  joinCode,
  children,
}: {
  joinCode: string;
  children: ReactNode;
}) {
  const [connection, setConnection] = useState<Connection>({ status: 'loading' });
  const [state, setState] = useState<ShowState | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [settledAttempt, setSettledAttempt] = useState(0);

  // Ajuste de estado em render (padrão do React para reagir a uma mudança de entrada).
  // Fazer isso dentro do efeito dispararia um render em cascata a cada nova tentativa.
  if (attempt !== settledAttempt) {
    setSettledAttempt(attempt);
    setConnection({ status: 'loading' });
    setState(null);
  }

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        const { show, session } = await api.join(joinCode);
        if (cancelled) return;

        const cached = loadSession(joinCode);
        const activeSession = cached && cached.showId === show.id ? cached : session;
        saveSession(joinCode, activeSession);

        setConnection({ status: 'ready', show, session: activeSession });

        unsubscribe = api.subscribeShow(show.id, activeSession.id, (next) => {
          if (cancelled) return;
          setState(next);
          setClockOffsetMs(new Date(next.serverTime).getTime() - Date.now());
        });
      } catch (err) {
        if (cancelled) return;
        setConnection({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : 'Não foi possível conectar ao show. Verifique sua internet.',
        });
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [joinCode, attempt]);

  const value = useMemo<ShowContextValue>(
    () => ({
      status: connection.status,
      error: connection.status === 'error' ? connection.message : null,
      show: connection.status === 'ready' ? connection.show : null,
      session: connection.status === 'ready' ? connection.session : null,
      state,
      clockOffsetMs,
      retry,
    }),
    [connection, state, clockOffsetMs, retry],
  );

  return <ShowContext.Provider value={value}>{children}</ShowContext.Provider>;
}
