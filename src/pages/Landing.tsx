import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { env } from '@/config/env';
import { MOCK_DEMO_CODE, MOCK_FREE_CODE } from '@/lib/api';
import { isValidJoinCode, normalizeJoinCode, JOIN_CODE_LENGTH } from '@/lib/joinCode';
import { Ticket } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidJoinCode(code)) {
      setError(`O código tem ${JOIN_CODE_LENGTH} caracteres.`);
      return;
    }
    navigate(`/s/${normalizeJoinCode(code)}`);
  };

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Ticket className="mx-auto h-10 w-10 text-primary" strokeWidth={1.75} aria-hidden />
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Vote Play</h1>
          <p className="mt-2 text-muted-foreground">
            A próxima música do show é por sua conta.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-10 space-y-3">
          <label htmlFor="join-code" className="sr-only">
            Código do show
          </label>
          <input
            id="join-code"
            value={code}
            onChange={(event) => {
              setCode(normalizeJoinCode(event.target.value));
              setError(null);
            }}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={JOIN_CODE_LENGTH}
            placeholder="ABC123"
            aria-invalid={error !== null}
            aria-describedby={error ? 'join-code-error' : undefined}
            className="vp-focus tabular h-20 w-full rounded-2xl border border-border bg-card text-center font-mono text-4xl font-bold uppercase tracking-[0.35em] placeholder:text-muted-foreground/40"
          />

          {error && (
            <p id="join-code-error" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="h-14 w-full text-base font-semibold">
            Entrar no show
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Ou aponte a câmera para o QR Code do evento.
        </p>

        {env.apiProvider === 'mock' && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {[
              { code: MOCK_DEMO_CODE, label: 'voto por Pix' },
              { code: MOCK_FREE_CODE, label: 'voto grátis' },
            ].map(({ code: demo, label }) => (
              <button
                key={demo}
                type="button"
                onClick={() => setCode(demo)}
                className="vp-focus rounded-full border border-dashed border-border px-4 py-2 text-xs text-muted-foreground"
              >
                {demo} · {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
