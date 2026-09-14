import { env } from '@/config/env';
import { mockApi } from './mock';
import type { VotePlayApi } from './types';

/**
 * Seleção do backend. Enquanto VITE_API_PROVIDER não for 'supabase',
 * a aplicação inteira roda contra o mock em memória.
 */
export const api: VotePlayApi = (() => {
  if (env.apiProvider === 'supabase') {
    throw new Error(
      'Provider Supabase ainda não implementado (Fase 1 do plan.md). Use VITE_API_PROVIDER=mock.',
    );
  }
  return mockApi;
})();

export * from './types';
export { MOCK_DEMO_CODE } from './mock';
