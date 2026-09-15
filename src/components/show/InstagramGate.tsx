import { useState, type FormEvent } from 'react';
import { AtSign, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError, isValidInstagramHandle } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  profileHandle: string;
  sessionId: string;
  /** Se esta sessão já tocou no botão em uma visita anterior. */
  alreadyClicked: boolean;
  onDone: (handle: string) => void;
}

/**
 * Portão do modo Instagram, em dois passos travados na ordem.
 *
 * ATENÇÃO ao que isto é e ao que não é: nenhuma API do Instagram informa se
 * alguém segue um perfil — a Basic Display foi desligada em setembro de 2025 e
 * não há substituta. Então aqui não existe verificação. O que existe é atrito
 * (um toque que leva ao perfil) e registro (o @ declarado).
 *
 * A tela NÃO anuncia essa limitação para a plateia — dizer "não dá para
 * conferir" convidaria a pular o passo. Mas também não afirma em momento algum
 * que conferiu: nenhuma frase aqui promete verificação, e não há selo nem
 * "verificado". A ressalva explícita fica no painel do artista, que é quem
 * precisa saber o que está comprando.
 *
 * O passo 2 nasce desabilitado. A trava é de interface, não de servidor: uma
 * falha de rede no momento do toque não pode prender a pessoa do lado de fora
 * do show — num bar com wi-fi ruim isso custa mais do que vale.
 */
export function InstagramGate({ profileHandle, sessionId, alreadyClicked, onDone }: Props) {
  const [handle, setHandle] = useState('');
  const [visited, setVisited] = useState(alreadyClicked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileUrl = `https://instagram.com/${profileHandle}`;

  /**
   * Marca no clique, não no retorno: o navegador não avisa quando a pessoa
   * volta do Instagram, e em celular o app abre por cima sem disparar evento
   * nenhum na nossa página. Esperar por um sinal que não existe deixaria o
   * passo 2 trancado para sempre.
   */
  const handleVisit = () => {
    setVisited(true);
    // Sem await e sem toast: é registro, não ação da pessoa. Se falhar, o
    // portão continua funcionando e só o funil do painel perde um ponto.
    void api.markInstagramFollowClick(sessionId).catch(() => {});
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!visited) return;
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

      <ol className="mt-6 space-y-6">
        <li>
          <StepLabel n={1} done={visited}>
            Abrir o perfil e seguir
          </StepLabel>

          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={handleVisit}
            className={cn(
              'vp-focus mt-3 flex h-14 w-full items-center justify-center rounded-xl text-base font-semibold transition',
              visited
                ? 'border border-border bg-card text-foreground'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {visited ? `Abrir @${profileHandle} de novo` : `Abrir @${profileHandle}`}
          </a>
        </li>

        {/*
          Sem cortina de opacidade no bloco todo: ela apagaria justamente a
          frase que explica como destravar. O estado "ainda não" é dito pelo
          número do passo, pela frase e pelo campo desabilitado — cada um
          legível por conta própria.
        */}
        <li aria-disabled={!visited}>
          <StepLabel n={2} done={false}>
            Dizer quem é você
          </StepLabel>

          <form onSubmit={handleSubmit} className="mt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {visited
                ? 'É assim que o artista sabe quem participou da noite.'
                : 'Toque no botão acima para liberar o voto.'}
            </p>

            <div
              className={cn(
                'flex items-center gap-2 rounded-xl border px-4 transition-colors',
                visited
                  ? 'border-border bg-card focus-within:ring-2 focus-within:ring-ring'
                  : 'border-dashed border-border/60 bg-card/40',
              )}
            >
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
                disabled={!visited}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="seu.perfil"
                aria-label="Seu @ do Instagram"
                aria-invalid={error !== null}
                aria-describedby={error ? 'insta-erro' : undefined}
                className="w-full bg-transparent py-3.5 outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed"
              />
            </div>
            {error && (
              <p id="insta-erro" role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={!visited || saving}
              className={cn(
                'mt-4 h-14 w-full text-base font-semibold',
                !visited && 'border border-border bg-card text-foreground',
              )}
              /*
                Opacidade por estilo inline, não por classe.
                O botão base traz `disabled:opacity-50`; com o rótulo quase
                preto sobre coral, meia opacidade derruba o contraste para ~2:1
                e a instrução some justamente para quem precisa dela. Uma
                classe `disabled:opacity-100` deveria vencer no tailwind-merge
                e, medido, não vence. Estilo inline vence sempre — e aqui o
                contraste é requisito, não preferência.
              */
              style={!visited ? { opacity: 1 } : undefined}
            >
              {saving
                ? 'Salvando…'
                : visited
                  ? 'Já sigo, quero votar'
                  : 'Toque no Instagram para liberar'}
            </Button>
          </form>
        </li>
      </ol>
    </section>
  );
}

function StepLabel({
  n,
  done,
  children,
}: {
  n: number;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold">
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs',
          done ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : n}
      </span>
      {children}
      {done && <span className="sr-only">(concluído)</span>}
    </p>
  );
}
