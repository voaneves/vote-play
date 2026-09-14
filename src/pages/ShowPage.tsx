import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ShowProvider } from '@/features/show/ShowProvider';
import { useShow } from '@/features/show/context';
import { useCountdown } from '@/hooks/useCountdown';
import { api, ApiError } from '@/lib/api';
import { isValidJoinCode, normalizeJoinCode } from '@/lib/joinCode';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CandidateCard } from '@/components/show/CandidateCard';
import { RoundTimer } from '@/components/show/RoundTimer';
import { AmountPicker } from '@/components/show/AmountPicker';
import { QueueList } from '@/components/show/QueueList';
import { ListMusic, Music4 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RoundCandidate } from '@/types/domain';

type Tab = 'voting' | 'request';

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
  const { status, error, show, session, state, clockOffsetMs, retry } = useShow();
  const [tab, setTab] = useState<Tab>('voting');

  if (status === 'loading') {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-6">
        <p className="animate-pulse text-muted-foreground">Entrando no show…</p>
      </main>
    );
  }

  if (status === 'error' || !show || !session) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-medium">{error}</p>
        <Button onClick={retry} variant="secondary">
          Tentar de novo
        </Button>
      </main>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="px-4 pb-2 pt-6">
        <div className="mx-auto flex max-w-md items-baseline justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">{show.title}</h1>
            {show.venue && (
              <p className="truncate text-sm text-muted-foreground">{show.venue}</p>
            )}
          </div>
          <span className="tabular ml-3 shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-xs tracking-widest text-muted-foreground">
            {show.joinCode}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-28">
        {tab === 'voting' ? (
          <VotingTab clockOffsetMs={clockOffsetMs} />
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
          {show.directRequestEnabled && (
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

function VotingTab({ clockOffsetMs }: { clockOffsetMs: number }) {
  const navigate = useNavigate();
  const { show, session, state } = useShow();
  const [picking, setPicking] = useState<RoundCandidate | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const round = state?.round ?? null;
  const { secondsLeft, isRunningOut, hasEnded } = useCountdown(
    round?.closesAt ?? null,
    clockOffsetMs,
  );

  if (!show || !session) return null;

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
      </div>
    );
  }

  const ranked = [...round.candidates].sort((a, b) => b.weight - a.weight);

  const handleConfirm = async (amountCents: number) => {
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
      toast.error(
        err instanceof ApiError ? err.message : 'Não foi possível gerar o Pix.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="vp-surface mb-5 mt-2 p-6">
        <RoundTimer
          secondsLeft={secondsLeft}
          isRunningOut={isRunningOut}
          totalVotes={round.totalVotes}
          roundSeq={round.seq}
        />
      </section>

      <ul className="space-y-3">
        {ranked.map((candidate, index) => (
          <li key={candidate.id}>
            <CandidateCard
              candidate={candidate}
              rank={index + 1}
              totalWeight={round.totalWeight}
              leading={index === 0}
              disabled={hasEnded}
              onVote={setPicking}
            />
          </li>
        ))}
      </ul>

      <AmountPicker
        show={show}
        candidate={picking}
        submitting={submitting}
        onClose={() => setPicking(null)}
        onConfirm={handleConfirm}
      />
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
