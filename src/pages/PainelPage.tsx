import { Link } from 'react-router-dom';

/** Painel do artista — implementação na Fase 1 (ver plan.md §12). */
export default function PainelPage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold">Painel do artista</h1>
      <p className="mt-3 text-muted-foreground">
        Criação de show, repertório, controle de rodadas e fila de pedidos chegam na
        Fase 1.
      </p>
      <Link
        to="/"
        className="vp-focus mt-8 text-sm text-primary underline underline-offset-4"
      >
        Voltar ao início
      </Link>
    </main>
  );
}
