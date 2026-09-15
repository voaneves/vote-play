import { Navigate, useParams } from 'react-router-dom';
import { ShowProvider } from '@/features/show/ShowProvider';
import { CloudOff } from 'lucide-react';
import { useShow } from '@/features/show/context';
import { useCountdown } from '@/hooks/useCountdown';
import { VotePlayQr } from '@/components/brand/VotePlayQr';
import { isValidJoinCode, normalizeJoinCode } from '@/lib/joinCode';
import { formatClock, percent } from '@/lib/format';
import { showJoinUrl } from '@/config/env';
import { cn } from '@/lib/utils';

/**
 * Modo telão: projetado no palco ou na TV do bar.
 * É ele que faz a plateia entender o jogo sem o artista explicar no microfone.
 * Somente leitura — nenhuma interação.
 */
export default function TelaoPage() {
  const { code } = useParams<{ code: string }>();
  if (!code || !isValidJoinCode(code)) return <Navigate to="/" replace />;
  return (
    <ShowProvider key={normalizeJoinCode(code)} joinCode={normalizeJoinCode(code)}>
      <TelaoScreen />
    </ShowProvider>
  );
}

function TelaoScreen() {
  const { show, state, clockOffsetMs, status, health } = useShow();
  const round = state?.round ?? null;
  const { secondsLeft, isRunningOut } = useCountdown(
    round?.closesAt ?? null,
    clockOffsetMs,
  );

  if (status !== 'ready' || !show) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center">
        <p className="animate-pulse text-2xl text-muted-foreground">Conectando…</p>
      </main>
    );
  }

  const ranked = [...(round?.candidates ?? [])].sort((a, b) => b.weight - a.weight);

  return (
    <main className="grid min-h-[100dvh] gap-8 p-8 lg:grid-cols-[420px_1fr] lg:p-12">
      {/*
        No telão o aviso é ainda mais necessário que no celular: ninguém está
        olhando para a tela esperando erro, e um placar congelado num projetor
        passa por placar real a noite inteira. Fica num canto, grande o bastante
        para o artista ver do palco e discreto o bastante para não roubar a cena.
      */}
      {health === 'offline' && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-6 top-6 z-20 flex items-center gap-3 rounded-full bg-destructive px-5 py-2.5 text-xl font-semibold text-destructive-foreground"
        >
          <CloudOff className="h-6 w-6" aria-hidden />
          Sem conexão
        </div>
      )}

      <aside className="flex flex-col items-center justify-center text-center">
        <p className="text-xl text-muted-foreground">Vote pelo celular</p>
        {/*
          Fundo branco explícito mesmo no tema escuro: projetor perde contraste,
          e QR escuro sobre parede escura não lê de lugar nenhum da casa.
        */}
        <VotePlayQr
          value={showJoinUrl(show.joinCode)}
          title="QR Code para entrar no show"
          className="mt-6 w-[420px] max-w-full rounded-2xl bg-white p-4"
        />
        <p className="mt-6 text-lg text-muted-foreground">ou use o código</p>
        <p className="tabular mt-1 font-mono text-6xl font-bold tracking-[0.2em]">
          {show.joinCode}
        </p>
      </aside>

      <section className="flex flex-col justify-center">
        <header className="mb-8">
          <h1 className="text-4xl font-bold">{show.title}</h1>
          {round?.status === 'open' ? (
            <p
              className={cn(
                'tabular mt-2 text-7xl font-bold',
                isRunningOut && 'text-primary',
              )}
            >
              {formatClock(secondsLeft)}
            </p>
          ) : (
            <p className="mt-2 text-3xl text-muted-foreground">
              Próxima rodada em instantes
            </p>
          )}
        </header>

        <ol className="space-y-4">
          {ranked.map((candidate, index) => {
            const share = percent(candidate.weight, round?.totalWeight ?? 0);
            return (
              <li
                key={candidate.id}
                className="vp-surface relative overflow-hidden px-6 py-5"
              >
                <div
                  aria-hidden
                  className={cn(
                    'absolute inset-y-0 left-0 transition-[width] duration-700 ease-out',
                    index === 0 ? 'bg-primary/25' : 'bg-muted/40',
                  )}
                  style={{ width: `${share}%` }}
                />
                <div className="relative flex items-center gap-6">
                  <span className="tabular text-4xl font-bold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-3xl font-semibold">
                      {candidate.title}
                    </span>
                    <span className="block truncate text-xl text-muted-foreground">
                      {candidate.artistName}
                    </span>
                  </span>
                  <span className="tabular text-4xl font-bold">{share}%</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
