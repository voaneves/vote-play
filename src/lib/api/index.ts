import { env } from '@/config/env';
import type { VotePlayApi } from './types';

/**
 * Seleção preguiçosa do backend.
 *
 * Os dois providers eram importados estaticamente, então o bundle da plateia
 * carregava o mock E o supabase-js — 205 kB gzip no caminho crítico de quem só
 * quer votar no wi-fi de um bar. Com import dinâmico, cada build leva só o
 * provider que vai usar, e o outro nem vira chunk baixado.
 *
 * O contrato público continua síncrono: quem chama não sabe que houve await.
 */
let cached: VotePlayApi | null = null;

async function provider(): Promise<VotePlayApi> {
  if (cached) return cached;
  cached =
    env.apiProvider === 'supabase'
      ? (await import('./supabase')).supabaseApi
      : (await import('./mock')).mockApi;
  return cached;
}

export const api: VotePlayApi = {
  join: async (code) => (await provider()).join(code),
  getShowState: async (showId, sessionId) => (await provider()).getShowState(showId, sessionId),
  createVoteIntent: async (input) => (await provider()).createVoteIntent(input),
  castFreeVote: async (input) => (await provider()).castFreeVote(input),
  createRequestIntent: async (input) => (await provider()).createRequestIntent(input),
  getPaymentStatus: async (paymentId) => (await provider()).getPaymentStatus(paymentId),
  setSessionInstagram: async (sessionId, handle) =>
    (await provider()).setSessionInstagram(sessionId, handle),

  subscribeShow(showId, sessionId, onState) {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void provider().then((p) => {
      if (cancelled) return;
      unsubscribe = p.subscribeShow(showId, sessionId, onState);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  },
};

export * from './types';

/** Códigos dos shows de demonstração — existem só no provider mock. */
export const MOCK_DEMO_CODE = 'TESTE1';
export const MOCK_FREE_CODE = 'FREE01';
export const MOCK_INSTAGRAM_CODE = 'GRAM99';
