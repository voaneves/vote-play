import { useState, type FormEvent } from 'react';
import { AtSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError, isValidInstagramHandle } from '@/lib/api';

interface Props {
  profileHandle: string;
  sessionId: string;
  onDone: (handle: string) => void;
}

/**
 * Portão do modo Instagram.
 *
 * ATENÇÃO ao que isto é e ao que não é: nenhuma API do Instagram informa se
 * alguém segue um perfil — a Basic Display foi desligada em setembro de 2025 e
 * não há substituta. Então aqui não existe verificação. O que existe é atrito
 * (um toque que leva ao perfil) e registro (o @ declarado).
 *
 * A tela NÃO anuncia essa limitação para a plateia — dizer "não dá para
 * conferir" convidaria a pular o passo. Mas também não afirma em momento algum
 * que conferiu: nenhuma frase aqui promete verificação. A ressalva explícita
 * fica no painel do artista, que é quem precisa saber o que está comprando.
 */
export function InstagramGate({ profileHandle, sessionId, onDone }: Props) {
  const [handle, setHandle] = useState('');
  const [visited, setVisited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileUrl = `https://instagram.com/${profileHandle}`;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidInstagramHandle(handle)) {
      setError('Esse @ não parece um perfil do Instagram.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { instagramHandle } = await api.setSessionInstagram(sessionId, handle);
      onDone(instagramHandle);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar seu @.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="vp-surface mt-4 p-6">
      <div className="flex items-center gap-3">
        <AtSign className="h-7 w-7 shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
        <div>
          <h2 className="text-lg font-bold leading-tight">Siga para votar</h2>
          <p className="text-sm text-muted-foreground">
            A votação deste show é aberta para quem acompanha o artista.
          </p>
        </div>
      </div>

      <a
        href={profileUrl}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => setVisited(true)}
        className="vp-focus mt-5 flex h-14 w-full items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground"
      >
        Abrir @{profileHandle}
      </a>

      <form onSubmit={handleSubmit} className="mt-5">
        <label htmlFor="meu-insta" className="block text-sm font-medium">
          Seu @ do Instagram
        </label>
        <p className="mb-2 mt-1 text-xs text-muted-foreground">
          É assim que o artista sabe quem participou da noite.
        </p>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
          <span aria-hidden className="text-muted-foreground">
            @
          </span>
          <input
            id="meu-insta"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="seu.perfil"
            aria-invalid={error !== null}
            aria-describedby={error ? 'insta-erro' : undefined}
            className="w-full bg-transparent py-3.5 outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        {error && (
          <p id="insta-erro" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={saving} className="mt-4 h-14 w-full text-base font-semibold">
          {saving ? 'Salvando…' : visited ? 'Já sigo, quero votar' : 'Entrar na votação'}
        </Button>
      </form>

    </section>
  );
}
