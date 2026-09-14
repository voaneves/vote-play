import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Trava de build contra vazamento da chave secreta do Supabase.
 *
 * A chave secreta (`sb_secret_…`, antiga service_role) ignora a RLS inteira, e
 * fica ao lado da publishable no painel — é fácil copiar errado. Qualquer
 * variável `VITE_*` é embutida LITERALMENTE no bundle, que aqui vai para o
 * GitHub Pages, público. Um aviso em runtime chegaria tarde: o arquivo já teria
 * sido gerado e publicado com o segredo dentro.
 *
 * Então o build morre antes de escrever qualquer coisa.
 */
function assertNoSecretKeys(env: Record<string, string>) {
  const offenders = Object.entries(env).filter(
    ([key, value]) =>
      key.startsWith('VITE_') && /^sb_secret_|service_role/.test(value ?? ''),
  );

  if (offenders.length > 0) {
    throw new Error(
      `\n\n  Chave SECRETA do Supabase encontrada em ${offenders
        .map(([k]) => k)
        .join(', ')}.\n` +
        '  Variáveis VITE_* vão literalmente para o bundle público.\n' +
        '  Use a chave publishable (sb_publishable_…) em VITE_SUPABASE_PUBLISHABLE_KEY.\n' +
        '  A chave secreta pertence apenas às Edge Functions.\n',
    );
  }
}

export default defineConfig(({ mode }) => {
  assertNoSecretKeys(loadEnv(mode, __dirname, 'VITE_'));

  return {
    /**
     * Subdiretório do GitHub Pages. Ao migrar para domínio próprio (Fase 7 do
     * plan.md), trocar por '/' — o basename do router lê este mesmo valor via
     * import.meta.env.BASE_URL.
     */
    base: '/vote-play/',

    server: {
      host: '::',
      port: 8080,
    },

    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    build: {
      target: 'es2020',
      sourcemap: false,
    },
  };
});
