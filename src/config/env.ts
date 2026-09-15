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

const supabaseUrl = raw.VITE_SUPABASE_URL ?? '';

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

const isConfigured = Boolean(supabaseUrl && publishableKey);
const explicitProvider = raw.VITE_API_PROVIDER as ApiProvider | undefined;

/**
 * Qual backend a aplicação usa.
 *
 * A configuração MANDA: havendo URL e chave, tudo fala com o Supabase. Antes
 * isso dependia de uma segunda variável (`VITE_API_PROVIDER`), e esquecê-la
 * produzia um estado meio conectado — o painel lia o Supabase enquanto a
 * plateia continuava no mock, que só conhece os shows de demonstração. O
 * sintoma era "Código do show não encontrado" num código que existia de verdade.
 *
 * `VITE_API_PROVIDER` agora serve só para FORÇAR: `mock` com o Supabase
 * configurado (útil para demonstrar sem tocar no banco), ou `supabase` como
 * afirmação explícita — que falha alto se faltar configuração, em vez de cair
 * no mock em silêncio.
 */
if (explicitProvider === 'supabase' && !isConfigured) {
  throw new Error(
    'VITE_API_PROVIDER=supabase, mas faltam VITE_SUPABASE_URL e/ou ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY. Lembre que o Vite embute essas variáveis ' +
      'no build: alterá-las só tem efeito no próximo deploy.',
  );
}

const apiProvider: ApiProvider = explicitProvider ?? (isConfigured ? 'supabase' : 'mock');

if (raw.DEV && explicitProvider === 'mock' && isConfigured) {
  console.warn(
    '[vote-play] Supabase está configurado, mas VITE_API_PROVIDER=mock força o ' +
      'provider em memória. O painel continuará lendo o Supabase.',
  );
}

export const env = {
  apiProvider,
  supabaseUrl,
  supabasePublishableKey: publishableKey,
  /** true quando há URL e chave — o painel do artista depende disso. */
  isSupabaseConfigured: isConfigured,
  /** '/vote-play/' no GitHub Pages, '/' em hospedagem com domínio próprio. */
  basePath: raw.BASE_URL || '/',
  isDev: raw.DEV,
} as const;

/** URL absoluta de entrada no show — é isso que vira QR Code. */
export function showJoinUrl(joinCode: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${env.basePath}s/${joinCode.toUpperCase()}`;
}
