import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A rede de segurança que faltava.
 *
 * O `<Suspense>` do App cobre o carregamento das rotas lazy, mas **não cobre a
 * falha delas**. Com wi-fi ruim — ou logo depois de um deploy, quando o chunk
 * antigo deixou de existir no servidor — o `import()` rejeita, o Suspense não
 * tem o que mostrar, e a aba fica branca. Sem mensagem, sem botão, sem nada.
 *
 * Numa tela onde a pessoa acabou de pagar, tela branca é o pior resultado
 * possível: ela não sabe se o Pix foi, se deve pagar de novo, ou se o app
 * morreu.
 *
 * Erro de chunk é tratado à parte porque tem conserto de um clique: recarregar
 * busca o manifesto novo. Os outros só podem oferecer a saída para a entrada.
 */

interface Props {
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

/** Falha de carregamento de módulo, nos formatos que os navegadores usam. */
function ehFalhaDeChunk(erro: Error): boolean {
  const texto = `${erro.name} ${erro.message}`;
  return (
    /ChunkLoadError/i.test(texto) ||
    /Loading chunk/i.test(texto) ||
    /dynamically imported module/i.test(texto) ||
    /Importing a module script failed/i.test(texto) ||
    /Failed to fetch/i.test(texto)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Até a Fase 6 (Sentry) o console é o que existe. Melhor isso do que
    // engolir: quem estiver depurando no celular do artista precisa ver algo.
    console.error('[vote-play] erro não tratado', erro, info.componentStack);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    const chunk = ehFalhaDeChunk(erro);

    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="vp-surface w-full max-w-sm p-8">
          <h1 className="text-xl font-semibold">
            {chunk ? 'Não deu para carregar esta tela' : 'Algo deu errado'}
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            {chunk
              ? 'Pode ser a internet do local, ou o app acabou de ser atualizado. Recarregar costuma resolver.'
              : 'O erro foi registrado. Recarregar a página costuma resolver.'}
          </p>

          <Button
            onClick={() => window.location.reload()}
            size="lg"
            className="mt-6 h-12 w-full font-semibold"
          >
            Recarregar
          </Button>

          <a
            href={import.meta.env.BASE_URL || '/'}
            className="vp-focus mt-4 inline-block text-sm text-muted-foreground underline underline-offset-4"
          >
            Voltar para a entrada
          </a>
        </div>
      </main>
    );
  }
}
