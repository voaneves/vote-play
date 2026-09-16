import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCountdown } from '@/hooks/useCountdown';
import { formatClock } from '@/lib/format';
import { downloadCsv, slugify, toCsv } from '@/lib/csv';
import { ShowSummaryCard } from '@/components/painel/ShowSummaryCard';
import { InstagramFunnelCard } from '@/components/painel/InstagramFunnelCard';
import { SuspiciousSessionsCard } from '@/components/painel/SuspiciousSessionsCard';
import { cn } from '@/lib/utils';
import {
  addSongsToShow,
  listParticipants,
  closeRoundVoting,
  currentRound,
  getShow,
  listShowSongs,
  listSongs,
  openRound,
  setShowStatus,
  settleRound,
  tickRounds,
} from '@/lib/painel/queries';

const ROUND_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  open: 'Votação aberta',
  closing: 'Apurando',
  settled: 'Apurada',
  cancelled: 'Cancelada',
};

export default function ShowLive() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);

  const show = useQuery({ queryKey: ['show', id], queryFn: () => getShow(id) });
  const songs = useQuery({ queryKey: ['songs'], queryFn: listSongs });
  const showSongs = useQuery({ queryKey: ['show-songs', id], queryFn: () => listShowSongs(id) });
  const participants = useQuery({
    queryKey: ['participants', id],
    queryFn: () => listParticipants(id),
    enabled: show.data?.vote_mode === 'instagram',
    // durante o show a lista cresce; parada, não há o que buscar
    refetchInterval: show.data?.status === 'live' ? 10_000 : false,
  });

  const round = useQuery({
    queryKey: ['round', id],
    queryFn: () => currentRound(id),
    // enquanto a rodada corre, o painel acompanha de perto
    refetchInterval: 3000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['round', id] });
    void queryClient.invalidateQueries({ queryKey: ['show', id] });
    void queryClient.invalidateQueries({ queryKey: ['show-songs', id] });
  };

  const fail = (err: Error) => toast.error(err.message);

  const status = useMutation({
    mutationFn: (next: 'live' | 'paused' | 'ended') => setShowStatus(id, next),
    onSuccess: refresh,
    onError: fail,
  });

  const addToShow = useMutation({
    mutationFn: (songIds: string[]) => addSongsToShow(id, songIds),
    onSuccess: refresh,
    onError: fail,
  });

  const open = useMutation({
    mutationFn: () => openRound(id, selected, show.data?.round_duration_seconds),
    onSuccess: () => {
      setSelected([]);
      refresh();
    },
    onError: fail,
  });

  const closeVoting = useMutation({
    mutationFn: (roundId: string) => closeRoundVoting(roundId),
    onSuccess: refresh,
    onError: fail,
  });

  const settle = useMutation({
    mutationFn: (roundId: string) => settleRound(roundId, true),
    onSuccess: refresh,
    onError: fail,
  });

  const active = round.data !== null && ['open', 'closing'].includes(round.data?.status ?? '');

  /**
   * Rede de segurança do cronômetro.
   *
   * Quem faz a rodada fechar no horário e apurar é `tick_rounds()`, agendada no
   * pg_cron a cada 10 segundos. Só que o pg_cron é uma extensão que precisa
   * estar ativa no projeto: se não estiver — e a migration que a agenda avisa e
   * segue de propósito, para não travar o `db push` —, a rodada fica aberta
   * para sempre e o show trava com o cronômetro em 00:00.
   *
   * O plano dizia desde a Fase 1 que "o painel chama tick_rounds() sozinho".
   * Dizia; não chamava. Agora chama, enquanto houver rodada ativa e só então.
   *
   * A função é idempotente e escopada ao dono (ver 20260915170000), então
   * chamá-la a mais não faz nada além de gastar uma consulta. Erro aqui é
   * engolido: é um reforço, e um toast a cada 5 segundos por causa do reforço
   * seria pior que o problema que ele cobre.
   */
  useQuery({
    queryKey: ['tick', id],
    queryFn: async () => {
      await tickRounds();
      return Date.now();
    },
    enabled: active,
    refetchInterval: 5000,
    retry: false,
  });

  const { secondsLeft, isRunningOut } = useCountdown(
    round.data?.status === 'open' ? round.data.closes_at : null,
  );

  const inShow = new Set(showSongs.data?.map((s) => s.song_id) ?? []);
  const available = showSongs.data?.filter((s) => s.status === 'available') ?? [];

  if (show.isLoading) return <p className="text-muted-foreground">Carregando…</p>;
  if (show.isError) return <p className="text-destructive">{(show.error as Error).message}</p>;
  if (!show.data) return null;

  const toggle = (songId: string) =>
    setSelected((prev) =>
      prev.includes(songId) ? prev.filter((x) => x !== songId) : [...prev, songId],
    );

  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link to="/painel" className="vp-focus text-sm text-muted-foreground hover:text-foreground">
            ← Shows
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold">{show.data.title}</h1>
          <p className="text-muted-foreground">{show.data.venue ?? 'sem local'}</p>
        </div>
        <Link
          to={`/painel/shows/${id}/qr`}
          className="vp-surface vp-focus px-4 py-3 text-center transition hover:border-primary/50"
        >
          <span className="tabular block font-mono text-lg font-bold tracking-widest">
            {show.data.join_code}
          </span>
          <span className="block text-xs text-muted-foreground">ver QR Code</span>
        </Link>
      </div>

      {/* controle do show */}
      <section className="vp-surface mt-5 flex flex-wrap items-center gap-2 p-4">
        <span className="mr-auto text-sm text-muted-foreground">
          Status: <strong className="text-foreground">{show.data.status}</strong>
        </span>
        {show.data.status !== 'live' && show.data.status !== 'ended' && (
          <Button onClick={() => status.mutate('live')}>Colocar no ar</Button>
        )}
        {show.data.status === 'live' && (
          <Button variant="secondary" onClick={() => status.mutate('paused')}>
            Pausar
          </Button>
        )}
        {show.data.status !== 'ended' && (
          <Button variant="ghost" onClick={() => status.mutate('ended')}>
            Encerrar show
          </Button>
        )}
      </section>

      {/* rodada */}
      <section className="vp-surface mt-4 p-5">
        <h2 className="font-semibold">Rodada</h2>

        {active ? (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              #{round.data!.seq} · {ROUND_LABEL[round.data!.status]}
            </p>
            {round.data!.status === 'open' && (
              <p className={cn('tabular mt-1 text-5xl font-bold', isRunningOut && 'text-primary')}>
                {formatClock(secondsLeft)}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {round.data!.total_votes} votos · {round.data!.total_weight} pontos
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {round.data!.status === 'open' && (
                <Button variant="secondary" onClick={() => closeVoting.mutate(round.data!.id)}>
                  Encerrar votação agora
                </Button>
              )}
              <Button onClick={() => settle.mutate(round.data!.id)}>Apurar e eleger</Button>
            </div>
            {round.data!.status === 'closing' && (
              <p className="mt-3 text-xs text-muted-foreground">
                Aguardando os Pix pendentes resolverem. "Apurar" força o fechamento e anula os
                que não pagaram.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">
              Escolha de 2 a 8 músicas do repertório deste show para a próxima rodada.
            </p>

            {available.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhuma música disponível. Adicione abaixo.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {available.map((item) => {
                  const on = selected.includes(item.song_id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggle(item.song_id)}
                        aria-pressed={on}
                        className={cn(
                          'vp-focus w-full rounded-xl border p-3 text-left transition',
                          on
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/40',
                        )}
                      >
                        <span className="block truncate font-medium">{item.songs?.title}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {item.songs?.artist_name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <Button
              className="mt-4"
              disabled={selected.length < 2 || selected.length > 8 || open.isPending}
              onClick={() => open.mutate()}
            >
              {open.isPending
                ? 'Abrindo…'
                : `Abrir rodada com ${selected.length} música${selected.length === 1 ? '' : 's'}`}
            </Button>
            {show.data.status !== 'live' && (
              <p className="mt-2 text-xs text-muted-foreground">
                O show precisa estar no ar para abrir uma rodada.
              </p>
            )}
          </div>
        )}
      </section>

      <ShowSummaryCard showId={id} live={show.data.status === 'live'} />
      <SuspiciousSessionsCard showId={id} />

      {/* funil e lista de participantes — só fazem sentido no modo Instagram */}
      {show.data.vote_mode === 'instagram' && (
        <InstagramFunnelCard showId={id} live={show.data.status === 'live'} />
      )}

      {show.data.vote_mode === 'instagram' && (
        <section className="vp-surface mt-4 p-5">
          <h2 className="font-semibold">
            Quem votou{' '}
            {participants.data && (
              <span className="text-muted-foreground">({participants.data.length})</span>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O @ que cada pessoa declarou ao entrar. Não é verificação — nenhuma API do
            Instagram informa se alguém segue um perfil. Cruze com seus seguidores se quiser.
          </p>

          {participants.data?.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Ninguém entrou ainda. Os @ aparecem aqui conforme a plateia chega.
            </p>
          )}

          <ul className="mt-4 space-y-1.5">
            {participants.data?.map((p) => (
              <li
                key={p.instagram_handle}
                className="flex items-center gap-3 border-b border-border/50 py-1.5 text-sm last:border-0"
              >
                <a
                  href={`https://instagram.com/${p.instagram_handle}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="vp-focus min-w-0 flex-1 truncate text-primary hover:underline"
                >
                  @{p.instagram_handle}
                </a>
                <span className="tabular shrink-0 text-muted-foreground">
                  {p.votos} {p.votos === 1 ? 'voto' : 'votos'}
                </span>
              </li>
            ))}
          </ul>

          {(participants.data?.length ?? 0) > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  const linhas = (participants.data ?? [])
                    .map((p) => `@${p.instagram_handle}`)
                    .join('\n');
                  void navigator.clipboard.writeText(linhas).then(
                    () => toast.success('Lista copiada.'),
                    () => toast.error('Não foi possível copiar.'),
                  );
                }}
                className="vp-focus text-primary underline underline-offset-4"
              >
                Copiar todos os @
              </button>

              <button
                type="button"
                onClick={() => {
                  const rows = participants.data ?? [];
                  downloadCsv(
                    `participantes-${slugify(show.data?.title ?? '')}.csv`,
                    toCsv(rows, [
                      { header: 'instagram', value: (p) => `@${p.instagram_handle}` },
                      { header: 'apelido', value: (p) => p.nickname ?? '' },
                      { header: 'votos', value: (p) => p.votos },
                      {
                        header: 'entrou em',
                        value: (p) => new Date(p.entrou_em).toLocaleString('pt-BR'),
                      },
                    ]),
                  );
                  toast.success(`${rows.length} participantes exportados.`);
                }}
                className="vp-focus text-primary underline underline-offset-4"
              >
                Baixar CSV
              </button>
            </div>
          )}
        </section>
      )}

      {/* repertório do show */}
      <section className="vp-surface mt-4 p-5">
        <h2 className="font-semibold">Repertório deste show</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Marque o que pode entrar em votação hoje.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {songs.data?.map((song) => (
            <li key={song.id}>
              <button
                type="button"
                onClick={() => addToShow.mutate([song.id])}
                disabled={inShow.has(song.id)}
                className={cn(
                  'vp-focus w-full rounded-xl border p-3 text-left transition',
                  inShow.has(song.id)
                    ? 'border-border/50 text-muted-foreground'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <span className="block truncate font-medium">{song.title}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {song.artist_name}
                  {inShow.has(song.id) && ' · já incluída'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
