import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { env } from '@/config/env';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6 text-center">
        <h1 className="text-2xl font-bold">Painel indisponível</h1>
        <p className="mt-3 text-muted-foreground">
          O painel precisa do Supabase configurado. Faltam variáveis de ambiente.
        </p>
        <ul className="mx-auto mt-4 space-y-1.5 text-left text-sm text-muted-foreground">
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5">VITE_API_PROVIDER</code> = supabase
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5">VITE_SUPABASE_URL</code>
          </li>
          <li>
            <code className="rounded bg-muted px-1.5 py-0.5">VITE_SUPABASE_PUBLISHABLE_KEY</code>
          </li>
        </ul>
        <p className="mt-5 text-sm text-muted-foreground">
          No <code className="rounded bg-muted px-1.5 py-0.5">.env</code> para rodar local. Em
          produção, nas variáveis do GitHub Actions — e lembre que o Vite embute isso no
          <strong className="text-foreground"> build</strong>: mudar a variável só tem efeito
          no próximo deploy.
        </p>
      </main>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    const { error: err } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}${env.basePath}painel` },
    });
    setSending(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  if (sent) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6 text-center">
        <h1 className="text-2xl font-bold">Confira seu e-mail</h1>
        <p className="mt-3 text-muted-foreground">
          Mandamos um link de acesso para <strong className="text-foreground">{email}</strong>.
          Ele abre o painel direto, sem senha.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="vp-focus mt-8 text-sm text-primary underline underline-offset-4"
        >
          Usar outro e-mail
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">Painel do artista</h1>
      <p className="mt-2 text-muted-foreground">
        Entre com seu e-mail. Enviamos um link de acesso — sem senha para lembrar.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@exemplo.com"
          aria-label="E-mail"
          className="vp-focus w-full rounded-xl border border-border bg-card px-4 py-3.5 placeholder:text-muted-foreground/50"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" disabled={sending} className="h-14 w-full text-base font-semibold">
          {sending ? 'Enviando…' : 'Enviar link de acesso'}
        </Button>
      </form>
    </main>
  );
}
