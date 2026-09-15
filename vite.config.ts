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

/**
 * Trava de build contra publicar o backend errado.
 *
 * O `src/config/env.ts` também valida isso, mas ele é código de APLICAÇÃO: só
 * roda no navegador de quem abre a página. Num deploy de CI isso chega tarde
 * demais — o workflow fica verde, o site vai para o ar e o erro só aparece como
 * tela branca para a plateia. A checagem precisa estar aqui, onde o build morre
 * antes de gerar arquivo.
 *
 * O caso real que originou isto: o workflow mandava `VITE_API_PROVIDER: mock`
 * como valor padrão. O deploy passava, o painel do artista falava com o Supabase
 * (ele não consulta o provider) e a plateia ficava no mock, que só conhece os
 * códigos de demonstração. Resultado: "Código do show não encontrado" para um
 * código que existia.
 */
function assertProviderConfig(env: Record<string, string>) {
  const provider = (env.VITE_API_PROVIDER ?? '').trim().toLowerCase();
  const configured = Boolean(
    env.VITE_SUPABASE_URL &&
      (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY),
  );

  if (provider !== '' && provider !== 'mock' && provider !== 'supabase') {
    throw new Error(
      `\n\n  VITE_API_PROVIDER="${provider}" não é um provider válido.\n` +
        '  Use "mock", "supabase", ou não defina a variável — sem ela, a presença\n' +
        '  de VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY é que decide.\n',
    );
  }

  if (provider === 'supabase' && !configured) {
    throw new Error(
      '\n\n  VITE_API_PROVIDER=supabase, mas falta VITE_SUPABASE_URL e/ou\n' +
        '  VITE_SUPABASE_PUBLISHABLE_KEY. O build pararia aqui de qualquer forma:\n' +
        '  publicar assim geraria um site que não fala com backend nenhum.\n' +
        '  No GitHub: Settings → Secrets and variables → Actions → Variables.\n',
    );
  }

  const destino = provider === 'mock' || (provider === '' && !configured)
    ? 'mock (em memória — só os shows de demonstração)'
    : `supabase (${env.VITE_SUPABASE_URL})`;
  console.log(`\n  vote-play: build usando o provider ${destino}\n`);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  assertNoSecretKeys(env);
  assertProviderConfig(env);

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
