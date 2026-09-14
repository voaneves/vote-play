import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <p className="text-6xl font-bold text-muted-foreground/40">404</p>
      <h1 className="mt-4 text-xl font-semibold">Essa página não existe</h1>
      <Link
        to="/"
        className="vp-focus mt-6 text-sm text-primary underline underline-offset-4"
      >
        Entrar em um show
      </Link>
    </main>
  );
}
