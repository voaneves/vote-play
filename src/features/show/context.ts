import { createContext, useContext } from 'react';
import type { ConnectionHealth } from '@/lib/api/types';
import type { AudienceSession, ShowPublic, ShowState } from '@/types/domain';

export interface ShowContextValue {
  status: 'loading' | 'error' | 'ready';
  /** Entrando, mas o banco pediu calma (pico de entrada): o app tenta de novo sozinho. */
  busy: boolean;
  error: string | null;
  show: ShowPublic | null;
  session: AudienceSession | null;
  state: ShowState | null;
  /** Saúde da conexão em tempo real. Ver ConnectionHealth. */
  health: ConnectionHealth;
  /** Quando o último snapshot bom chegou (epoch ms), ou null se nenhum chegou. */
  lastSyncedAt: number | null;
  /** Diferença relógio-do-servidor − relógio-local, em ms. Corrige o cronômetro. */
  clockOffsetMs: number;
  retry: () => void;
  /** Leitura imediata do estado — depois do próprio voto, por exemplo. */
  refresh: () => void;
}

export const ShowContext = createContext<ShowContextValue | null>(null);

export function useShow(): ShowContextValue {
  const ctx = useContext(ShowContext);
  if (!ctx) throw new Error('useShow precisa estar dentro de <ShowProvider>');
  return ctx;
}
