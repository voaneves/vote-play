import { createContext, useContext } from 'react';
import type { AudienceSession, ShowPublic, ShowState } from '@/types/domain';

export interface ShowContextValue {
  status: 'loading' | 'error' | 'ready';
  error: string | null;
  show: ShowPublic | null;
  session: AudienceSession | null;
  state: ShowState | null;
  /** Diferença relógio-do-servidor − relógio-local, em ms. Corrige o cronômetro. */
  clockOffsetMs: number;
  retry: () => void;
}

export const ShowContext = createContext<ShowContextValue | null>(null);

export function useShow(): ShowContextValue {
  const ctx = useContext(ShowContext);
  if (!ctx) throw new Error('useShow precisa estar dentro de <ShowProvider>');
  return ctx;
}
