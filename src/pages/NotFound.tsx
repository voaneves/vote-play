import { Link } from 'react-router-dom';

/**
 * Página inexistente. Sai para as duas portas do site, porque quem chega aqui
 * pode ser tanto a plateia com um link quebrado quanto o artista com um favorito
 * antigo — e nenhum dos dois deveria precisar adivinhar a URL certa.
 */
export default function NotFound() {
  const link =
    'vp-focus inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm underline underline-offset-4';
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <p className="text-6xl font-bold text-muted-foreground/40" aria-hidden>
        404
      </p>
      <h1 className="mt-4 text-xl font-semibold">Essa página não existe</h1>
      <div className="mt-6 flex flex-col items-center gap-1">
        <Link to="/" className={`${link} text-primary`}>
          Entrar em um show
        </Link>
        <Link to="/painel" className={`${link} text-muted-foreground hover:text-foreground`}>
          Painel do artista
        </Link>
      </div>
    </main>
  );
}
