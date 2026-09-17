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
  getShowState: async (showId, sessionId, knownVersion) =>
    (await provider()).getShowState(showId, sessionId, knownVersion),
  createVoteIntent: async (input) => (await provider()).createVoteIntent(input),
  castFreeVote: async (input) => (await provider()).castFreeVote(input),
  createRequestIntent: async (input) => (await provider()).createRequestIntent(input),
  getPaymentStatus: async (paymentId) => (await provider()).getPaymentStatus(paymentId),
  setSessionInstagram: async (sessionId, handle) =>
    (await provider()).setSessionInstagram(sessionId, handle),
  markInstagramFollowClick: async (sessionId) =>
    (await provider()).markInstagramFollowClick(sessionId),
  setSongSupport: async (input) => (await provider()).setSongSupport(input),

  subscribeRepertoire(showId, sessionId, observer) {
    let inner: ReturnType<VotePlayApi['subscribeRepertoire']> | null = null;
    let cancelled = false;

    void provider().then((p) => {
      if (cancelled) return;
      inner = p.subscribeRepertoire(showId, sessionId, observer);
    });

    return {
      unsubscribe: () => {
        cancelled = true;
        inner?.unsubscribe();
      },
      refresh: () => inner?.refresh(),
    };
  },

  subscribeShow(showId, sessionId, observer, options) {
    let inner: ReturnType<VotePlayApi['subscribeShow']> | null = null;
    let cancelled = false;

    void provider().then((p) => {
      if (cancelled) return;
      inner = p.subscribeShow(showId, sessionId, observer, options);
    });

    return {
      unsubscribe: () => {
        cancelled = true;
        inner?.unsubscribe();
      },
      refresh: () => inner?.refresh(),
    };
  },
};

export * from './types';

/**
 * Códigos dos shows de demonstração, um por modo de votação.
 *
 * Vivem aqui, e não em `mock.ts`, porque a landing os exibe mesmo quando o
 * provider é o Supabase — importá-los do mock arrastaria o provider inteiro
 * para o bundle de quem nunca vai usá-lo.
 *
 * `supabase/seed.sql` cria os mesmos três códigos no banco, então eles valem
 * nos dois providers.
 */
export const MOCK_DEMO_CODE = 'PAGAR1';
export const MOCK_FREE_CODE = 'FREE01';
export const MOCK_INSTAGRAM_CODE = 'GRAM99';
