type ApiProvider = 'mock' | 'supabase';

const raw = import.meta.env;

export const env = {
  /** 'mock' enquanto o backend não existe (Fase 0/1). Ver plan.md seção 12. */
  apiProvider: (raw.VITE_API_PROVIDER ?? 'mock') as ApiProvider,
  supabaseUrl: raw.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: raw.VITE_SUPABASE_ANON_KEY ?? '',
  /** '/vote-play/' no GitHub Pages, '/' em hospedagem com domínio próprio. */
  basePath: raw.BASE_URL || '/',
  isDev: raw.DEV,
} as const;

/** URL absoluta de entrada no show — é isso que vira QR Code. */
export function showJoinUrl(joinCode: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${env.basePath}s/${joinCode.toUpperCase()}`;
}
