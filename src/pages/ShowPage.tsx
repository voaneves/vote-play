import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ShowProvider } from '@/features/show/ShowProvider';
import { useShow } from '@/features/show/context';
import { useCountdown } from '@/hooks/useCountdown';
import { api, ApiError } from '@/lib/api';
import { isValidJoinCode, normalizeJoinCode } from '@/lib/joinCode';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import { env } from '@/config/env';
import { Button } from '@/components/ui/button';
import { CandidateCard } from '@/components/show/CandidateCard';
import { RoundTimer } from '@/components/show/RoundTimer';
import { AmountPicker } from '@/components/show/AmountPicker';
import { QueueList } from '@/components/show/QueueList';
import { InstagramGate } from '@/components/show/InstagramGate';
import { ConnectionBanner } from '@/components/show/ConnectionBanner';
import { RepertoireList } from '@/components/show/RepertoireList';
import { useRepertoire } from '@/features/show/useRepertoire';
import { ListMusic, ListOrdered, Music4 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RepertoireSong, RoundCandidate } from '@/types/domain';

type Tab = 'voting' | 'repertoire' | 'request';

export default function ShowPage() {
  const { code } = useParams<{ code: string }>();
  if (!code || !isValidJoinCode(code)) return <Navigate to="/" replace />;
  return (
    <ShowProvider key={normalizeJoinCode(code)} joinCode={normalizeJoinCode(code)}>
      <ShowScreen />
    </ShowProvider>
  );
}

function ShowScreen() {
  const { status, busy, error, show, session, state, health, lastSyncedAt, clockOffsetMs, retry, refresh } =
    useShow();
  // null = a pessoa ainda não escolheu aba: segue o momento do show (abaixo)
  const [chosenTab, setTab] = useState<Tab | null>(null);
  // o @ declarado nesta visita; o join já traz o de visitas anteriores
  const [handle, setHandle] = useState<string | null>(null);

  if (status === 'loading') {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-6">
        <div className="text-center" role="status" aria-live="polite">
          <p className="animate-pulse text-muted-foreground">Entrando no show…</p>
          {busy && (
            <p className="mt-2 text-sm text-muted-foreground">
              Muita gente chegando ao mesmo tempo. Já, já você entra — não precisa fazer nada.
            </p>
          )}
        </div>
      </main>
    );
  }

  if (status === 'error' || !show || !session) {
    // Duas saídas, sempre: o erro pode ser de rede (tentar de novo resolve) ou
    // do código (não existe, já terminou) — e aí repetir o mesmo código é um
    // beco sem saída. A pessoa não sabe qual dos dois é, então as duas ficam.
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-semibold">{error}</h1>
          <Button asChild size="lg" className="mt-8 h-12 w-full font-semibold">
            <Link to="/">Digitar outro código</Link>
          </Button>
          <Button onClick={retry} variant="secondary" className="mt-3 h-12 w-full">
            Tentar de novo
          </Button>
        </div>
      </main>
    );
  }

  // Fila no modo pix só com apoio pago (Fase 7): até lá a aba não aparece.
  const queueAvailable = show.queueEnabled && show.voteMode !== 'pix';

  // Sem escolha da pessoa, a aba acompanha o show: rodada aberta → votação;
  // sem rodada e com fila → fila. Assim quem escaneia no intervalo entre
  // rodadas cai onde há o que fazer, e a rodada nova puxa todo mundo para ela.
  const tab: Tab =
    chosenTab ??
    (queueAvailable && state !== null && state.round?.status !== 'open' ? 'repertoire' : 'voting');

  // O portão só aparece no modo instagram e só até a pessoa declarar o @.
  const needsGate =
    show.voteMode === 'instagram' &&
    show.instagramHandle !== null &&
    (handle ?? session.instagramHandle) === null;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <ConnectionBanner health={health} lastSyncedAt={lastSyncedAt} />

      <header className="px-4 pb-2 pt-6">
        <div className="mx-auto flex max-w-md items-baseline justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">{show.title}</h1>
            {show.venue && (
              <p className="truncate text-sm text-muted-foreground">{show.venue}</p>
            )}
          </div>
          <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
            <span className="tabular rounded-full border border-border px-2.5 py-1 font-mono text-xs tracking-widest text-muted-foreground">
              {show.joinCode}
            </span>
            <Link
              to="/"
              className="vp-focus -mr-2 inline-flex min-h-11 items-center rounded-lg px-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Trocar de show
            </Link>
            {health === 'degraded' && (
              <span className="text-[0.6875rem] leading-none text-muted-foreground">
                reconectando
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-28">
        {tab !== 'request' && needsGate ? (
          <InstagramGate
            profileHandle={show.instagramHandle!}
            sessionId={session.id}
            alreadyClicked={session.followClickedAt !== null}
            onDone={(declared) => {
              setHandle(declared);
              refresh();
            }}
          />
        ) : tab === 'voting' ? (
          <VotingTab
            clockOffsetMs={clockOffsetMs}
            onGoToQueue={queueAvailable ? () => setTab('repertoire') : undefined}
          />
        ) : tab === 'repertoire' ? (
          <RepertoireTab />
        ) : (
          <RequestTab />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-stretch px-4 pb-[env(safe-area-inset-bottom)]">
          <TabButton
            active={tab === 'voting'}
            onClick={() => setTab('voting')}
            Icon={ListMusic}
            label="Votação"
          />
          {queueAvailable && (
            <TabButton
              active={tab === 'repertoire'}
              onClick={() => setTab('repertoire')}
              Icon={ListOrdered}
              label="Fila"
            />
          )}
          {/* Pedido direto é pago (Fase 8): sem pagamento na build, a aba some
              em vez de mostrar um formulário que falha ao enviar. */}
          {show.directRequestEnabled && env.paymentsEnabled && (
            <TabButton
              active={tab === 'request'}
              onClick={() => setTab('request')}
              Icon={Music4}
              label="Pedir música"
            />
          )}
        </div>
      </nav>

      {state === null && (
        <p className="sr-only" aria-live="polite">
          Carregando o placar
        </p>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'vp-focus flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

function VotingTab({
  clockOffsetMs,
  onGoToQueue,
}: {
  clockOffsetMs: number;
  onGoToQueue?: () => void;
}) {
  const navigate = useNavigate();
  const { show, session, state, refresh } = useShow();
  const [picking, setPicking] = useState<RoundCandidate | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const round = state?.round ?? null;
  const { secondsLeft, isRunningOut, hasEnded } = useCountdown(
    round?.closesAt ?? null,
    clockOffsetMs,
  );

  if (!show || !session) return null;

  if (state?.showStatus === 'ended' || state?.showStatus === 'cancelled') {
    const lastWinner = round?.candidates.find((c) => c.id === round?.winnerCandidateId);
    return (
      <div className="vp-surface mt-10 p-8 text-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          {state.showStatus === 'ended' ? 'O show terminou' : 'Show cancelado'}
        </p>
        <p className="mt-3 text-2xl font-bold">
          {state.showStatus === 'ended' ? 'Valeu por votar!' : 'A votação foi encerrada.'}
        </p>
        {lastWinner && (
          <p className="mt-2 text-muted-foreground">
            Última escolhida: {lastWinner.title} · {lastWinner.artistName}
          </p>
        )}
      </div>
    );
  }

  if (state?.showStatus === 'paused') {
    return (
      <div className="vp-surface mt-10 p-8 text-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">Intervalo</p>
        <p className="mt-3 text-2xl font-bold">A votação volta já já</p>
      </div>
    );
  }

  if (!round || round.status !== 'open') {
    const winner = round?.candidates.find((c) => c.id === round?.winnerCandidateId);
    return (
      <div className="vp-surface mt-10 p-8 text-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          {winner ? 'Música escolhida' : 'Aguardando'}
        </p>
        <p className="mt-3 text-2xl font-bold">
          {winner ? winner.title : 'A próxima rodada começa já já'}
        </p>
        {winner && <p className="mt-1 text-muted-foreground">{winner.artistName}</p>}
        {onGoToQueue && (
          <Button onClick={onGoToQueue} variant="secondary" className="mt-6 h-12 w-full">
            Enquanto isso, apoie músicas na fila
          </Button>
        )}
      </div>
    );
  }

  // No modo pago o voto sempre passa pelo Pix. Nos modos gratuitos o toque já
  // registra o voto — abrir um seletor de valor ali seria pedir dinheiro por
  // algo que é de graça.
  const isPaid = show.voteMode === 'pix';
  const alreadyVoted = round.myVoteCandidateId !== null;
  const canVoteFree = !isPaid && round.freeVotesLeft > 0 && !alreadyVoted;
  // A lista fica na ORDEM DO ARTISTA e não pula conforme os votos chegam: no
  // voto grátis um toque já é o voto, e um card trocando de lugar debaixo do
  // dedo vira voto na música errada, sem desfazer. O ranking aparece no número.
  const rankOf = new Map(
    [...round.candidates]
      .sort((a, b) => b.weight - a.weight || a.position - b.position)
      .map((c, i) => [c.id, i + 1]),
  );

  const handlePaidConfirm = async (amountCents: number) => {
    if (!picking) return;
    setSubmitting(true);
    try {
      const { payment } = await api.createVoteIntent({
        showId: show.id,
        roundId: round.id,
        candidateId: picking.id,
        sessionId: session.id,
        amountCents,
      });
      setPicking(null);
      navigate(`/s/${show.joinCode}/pix/${payment.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível gerar o Pix.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFreeVote = async (candidate: RoundCandidate) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.castFreeVote({
        showId: show.id,
        roundId: round.id,
        candidateId: candidate.id,
        sessionId: session.id,
      });
      navigator.vibrate?.(12);
      toast.success(`Voto em "${candidate.title}" registrado.`);
      // sem esperar o próximo ciclo: a marcação "seu voto" aparece na hora
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível votar.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTap = (candidate: RoundCandidate) => {
    if (isPaid) {
      // Sem pagamento de verdade nesta build (Fase 7), o seletor levaria a um
      // erro depois de a pessoa escolher o valor. Melhor dizer antes.
      if (!env.paymentsEnabled) {
        return toast.info('O voto por Pix chega em breve neste show.');
      }
      return setPicking(candidate);
    }
    if (alreadyVoted) return toast.info('Você já votou nesta rodada.');
    void handleFreeVote(candidate);
  };

  return (
    <>
      <section className="vp-surface mb-4 mt-2 p-6">
        <RoundTimer
          secondsLeft={secondsLeft}
          isRunningOut={isRunningOut}
          totalVotes={round.totalVotes}
          roundSeq={round.seq}
        />
      </section>

      <p className="mb-4 text-center text-sm text-muted-foreground" aria-live="polite">
        {isPaid
          ? env.paymentsEnabled
            ? 'Escolha a música e quanto vale o seu voto.'
            : 'Neste show o voto é por Pix, que chega em breve. Acompanhe o placar.'
          : alreadyVoted
            ? 'Seu voto está computado. Aguarde a próxima rodada para votar de novo.'
            : 'Toque na música que você quer ouvir. Um voto por rodada.'}
      </p>

      <ul className="space-y-3">
        {round.candidates.map((candidate) => (
          <li key={candidate.id}>
            <CandidateCard
              candidate={candidate}
              rank={rankOf.get(candidate.id) ?? candidate.position}
              totalWeight={round.totalWeight}
              leading={rankOf.get(candidate.id) === 1 && candidate.weight > 0}
              disabled={hasEnded || (!isPaid && !canVoteFree && !alreadyVoted)}
              chosen={round.myVoteCandidateId === candidate.id}
              actionLabel={isPaid ? 'Votar' : 'Escolher'}
              onVote={handleTap}
            />
          </li>
        ))}
      </ul>

      {isPaid && (
        <AmountPicker
          show={show}
          candidate={picking}
          submitting={submitting}
          onClose={() => setPicking(null)}
          onConfirm={handlePaidConfirm}
        />
      )}
    </>
  );
}

function RepertoireTab() {
  const { show, session, state: showState } = useShow();
  const { state, health, refresh } = useRepertoire(show?.id ?? null, session?.id ?? null, true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (!show || !session) return null;

  if (showState?.showStatus === 'ended' || showState?.showStatus === 'cancelled') {
    return (
      <div className="vp-surface mt-10 p-8 text-center">
        <p className="text-2xl font-bold">O show terminou</p>
        <p className="mt-2 text-muted-foreground">A fila fecha junto. Valeu por participar!</p>
      </div>
    );
  }

  if (state === null) {
    return (
      <p className="mt-10 animate-pulse text-center text-muted-foreground">
        {health === 'offline' ? 'Sem conexão para carregar a fila…' : 'Carregando a fila…'}
      </p>
    );
  }

  if (!state.enabled) {
    return (
      <div className="vp-surface mt-10 p-8 text-center">
        <p className="font-medium">A fila está fechada agora</p>
        <p className="mt-1 text-sm text-muted-foreground">O artista pode abri-la a qualquer momento.</p>
      </div>
    );
  }

  const handleToggle = async (song: RepertoireSong) => {
    if (pendingId) return;
    setPendingId(song.id);
    try {
      await api.setSongSupport({
        showId: show.id,
        sessionId: session.id,
        showSongId: song.id,
        support: !song.mine,
      });
      navigator.vibrate?.(10);
      // Anúncio único (o toast é região viva): a lista em si não é mais
      // aria-live, senão o leitor de tela a relia inteira a cada consulta.
      toast.success(song.mine ? `Apoio retirado de "${song.title}".` : `Você apoiou "${song.title}".`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível registrar seu apoio.');
      refresh();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      {showState?.showStatus === 'paused' && (
        <p className="mb-2 mt-2 text-center text-sm text-muted-foreground">
          Intervalo: os apoios voltam a valer quando o show recomeçar.
        </p>
      )}
      <RepertoireList state={state} pendingId={pendingId} onToggle={(s) => void handleToggle(s)} />
    </>
  );
}

function RequestTab() {
  const navigate = useNavigate();
  const { show, session, state } = useShow();
  const [title, setTitle] = useState('');
  const [artistName, setArtistName] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!show || !session) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !artistName.trim()) return;
    setSubmitting(true);
    try {
      const { payment } = await api.createRequestIntent({
        showId: show.id,
        sessionId: session.id,
        title: title.trim(),
        artistName: artistName.trim(),
        message: message.trim() || undefined,
      });
      navigate(`/s/${show.joinCode}/pix/${payment.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Não foi possível gerar o Pix.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    'vp-focus w-full rounded-xl border border-border bg-card px-4 py-3.5 placeholder:text-muted-foreground/50';

  return (
    <>
      <section className="mt-2 text-center">
        <h2 className="text-2xl font-bold">Fure a fila</h2>
        <p className="mt-1 text-muted-foreground">
          Peça qualquer música por {formatCents(show.directRequestPriceCents)}, sem
          disputar a votação.
        </p>
      </section>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Nome da música"
          aria-label="Nome da música"
          className={field}
        />
        <input
          value={artistName}
          onChange={(e) => setArtistName(e.target.value)}
          required
          placeholder="Artista"
          aria-label="Artista"
          className={field}
        />
        <div>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 140))}
            placeholder="Dedicatória (opcional)"
            aria-label="Dedicatória"
            className={field}
          />
          <p className="mt-1 pr-1 text-right text-xs text-muted-foreground">
            {message.length}/140
          </p>
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={submitting}
          className="h-14 w-full text-base font-semibold"
        >
          {submitting
            ? 'Gerando Pix…'
            : `Pedir por ${formatCents(show.directRequestPriceCents)}`}
        </Button>
      </form>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        O artista tem a palavra final sobre tocar. Pedido recusado é estornado.
      </p>

      <section className="mt-10">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Fila de pedidos
        </h3>
        <QueueList requests={state?.queue ?? []} />
      </section>
    </>
  );
}
