type ApiProvider = 'mock' | 'supabase';

const raw = import.meta.env;

/**
 * Chave pública do Supabase.
 *
 * Aceita a nova `sb_publishable_…` e, por transição, a `anon` legada — que o
 * Supabase deprecia até o fim de 2026. As duas têm exatamente os mesmos
 * privilégios baixos: quem decide o que pode ser lido é a RLS, não a chave.
 */
const publishableKey =
  raw.VITE_SUPABASE_PUBLISHABLE_KEY ?? raw.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Trava de segurança. A chave secreta (`sb_secret_…`, antiga `service_role`)
 * ignora a RLS inteira. Ela fica ao lado da publishable no painel do Supabase e
 * é fácil de copiar errado — e num bundle estático servido pelo GitHub Pages
 * isso significa publicar acesso irrestrito ao banco para qualquer pessoa.
 * Melhor quebrar o build alto e cedo do que descobrir depois.
 */
if (/^sb_secret_/.test(publishableKey) || /service_role/.test(publishableKey)) {
  throw new Error(
    'A chave secreta do Supabase foi colocada no .env do front-end. ' +
      'Ela ignora a RLS e NUNCA pode ir para o bundle. ' +
      'Use a chave publishable (sb_publishable_…), em Project Settings → API Keys.',
  );
}

export const env = {
  /** 'mock' enquanto o backend não existe (Fase 0/1). Ver plan.md seção 12. */
  apiProvider: (raw.VITE_API_PROVIDER ?? 'mock') as ApiProvider,
  supabaseUrl: raw.VITE_SUPABASE_URL ?? '',
  supabasePublishableKey: publishableKey,
  /** '/vote-play/' no GitHub Pages, '/' em hospedagem com domínio próprio. */
  basePath: raw.BASE_URL || '/',
  isDev: raw.DEV,
} as const;

/** URL absoluta de entrada no show — é isso que vira QR Code. */
export function showJoinUrl(joinCode: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${env.basePath}s/${joinCode.toUpperCase()}`;
}
