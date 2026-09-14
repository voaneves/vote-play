import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

let client: SupabaseClient | null = null;

/**
 * Cliente único do Supabase.
 *
 * A chave publishable vive no bundle e é PÚBLICA por design — o GitHub Pages
 * serve arquivos estáticos, então não existe lugar secreto no front. A segurança
 * está na RLS e nos GRANTs do banco (ver …_rls.sql e …_grants.sql).
 * A chave secreta nunca entra aqui: ela existe só nas Edge Functions.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error(
      'VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY não estão definidos. ' +
        'Copie .env.example para .env e preencha, ou use VITE_API_PROVIDER=mock.',
    );
  }

  client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'vp:auth',
    },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabasePublishableKey);
}
