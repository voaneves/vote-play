import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, ExternalLink, MonitorPlay, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showJoinUrl } from '@/config/env';
import { SHOW_STATUS_LABEL } from '@/lib/painel/labels';
import { useCountdown } from '@/hooks/useCountdown';
import { formatClock } from '@/lib/format';
import { downloadCsv, slugify, toCsv } from '@/lib/csv';
import { ShowSummaryCard } from '@/components/painel/ShowSummaryCard';
import { InstagramFunnelCard } from '@/components/painel/InstagramFunnelCard';
import { SuspiciousSessionsCard } from '@/components/painel/SuspiciousSessionsCard';
import { QueueCard } from '@/components/painel/QueueCard';
import { cn } from '@/lib/utils';
import {
  addSongsToShow,
  listParticipants,
  closeRoundVoting,
  currentRound,
  getShow,
  getShowSummary,
  listRoundCandidates,
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
  // Encerrar é definitivo (e apura a rodada aberta): pede um segundo toque.
  const [confirmEnd, setConfirmEnd] = useState(false);

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

  // placar da rodada no próprio painel (auditoria 9.4, U2)
  const candidates = useQuery({
    queryKey: ['round-candidates', round.data?.id],
    queryFn: () => listRoundCandidates(round.data!.id),
    enabled: active && !!round.data?.id,
    refetchInterval: active ? 3000 : false,
  });

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
          <Link
            to="/painel"
            className="vp-focus -ml-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Shows
          </Link>
          <h1 className="break-words text-2xl font-bold">{show.data.title}</h1>
          <p className="text-muted-foreground">{show.data.venue ?? 'sem local'}</p>
        </div>
        <span className="vp-surface px-4 py-3 text-center">
          <span className="tabular block font-mono text-lg font-bold tracking-widest">
            {show.data.join_code}
          </span>
          <span className="block text-xs text-muted-foreground">código do show</span>
        </span>
      </div>

      {/*
        As telas que o artista usa numa noite, a um toque: nada de URL decorada
        (plan.md, 9.1). Telão e visão da plateia abrem em outra aba para o
        painel continuar aberto.
      */}
      <nav aria-label="Telas deste show" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button asChild variant="secondary" className="min-h-11">
          <Link to={`/telao/${show.data.join_code}`} target="_blank" rel="noopener">
            <MonitorPlay className="h-4 w-4" aria-hidden /> Abrir telão
            <span className="sr-only"> (abre em nova aba)</span>
          </Link>
        </Button>
        <Button asChild variant="secondary" className="min-h-11">
          <Link to={`/s/${show.data.join_code}`} target="_blank" rel="noopener">
            <ExternalLink className="h-4 w-4" aria-hidden /> Ver como plateia
            <span className="sr-only"> (abre em nova aba)</span>
          </Link>
        </Button>
        <Button asChild variant="secondary" className="min-h-11">
          <Link to={`/painel/shows/${id}/qr`}>
            <QrCode className="h-4 w-4" aria-hidden /> QR para imprimir
          </Link>
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => {
            void navigator.clipboard.writeText(showJoinUrl(show.data!.join_code)).then(
              () => toast.success('Link do show copiado.'),
              () => toast.error('Não foi possível copiar.'),
            );
          }}
        >
          <Copy className="h-4 w-4" aria-hidden /> Copiar link
        </Button>
      </nav>

      {/*
        O show ao vivo dividido por assunto (auditoria 9.4, U9): no palco, o
        artista pula direto para a fila em vez de rolar três telas. Âncoras, não
        abas — tudo continua numa página só, e o rolar ainda funciona.
      */}
      <nav
        aria-label="Seções do show"
        className="sticky top-0 z-10 -mx-4 mt-4 border-b border-border bg-background/95 px-4 backdrop-blur"
      >
        <ul className="flex gap-1 overflow-x-auto py-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="vp-focus inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div id="ao-vivo" className="scroll-mt-16">
      {/* controle do show */}
      <section className="vp-surface mt-5 flex flex-wrap items-center gap-2 p-4">
        <span className="mr-auto text-sm text-muted-foreground">
          Status: <strong className="text-foreground">{SHOW_STATUS_LABEL[show.data.status]}</strong>
        </span>
        {!['live', 'ended', 'cancelled'].includes(show.data.status) && (
          <Button onClick={() => status.mutate('live')}>Colocar no ar</Button>
        )}
        {show.data.status === 'live' && (
          <Button variant="secondary" onClick={() => status.mutate('paused')}>
            Pausar
          </Button>
        )}
        {!['ended', 'cancelled'].includes(show.data.status) &&
          (confirmEnd ? (
            <>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmEnd(false);
                  status.mutate('ended');
                }}
              >
                Confirmar: encerrar
              </Button>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                Voltar
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmEnd(true)}>
              Encerrar show
            </Button>
          ))}
        {confirmEnd && (
          <p className="w-full text-xs text-muted-foreground">
            Não dá para voltar ao ar depois. Se houver rodada aberta, ela é apurada agora.
          </p>
        )}
      </section>

      {/* rodada */}
      <section className="vp-surface mt-4 border-primary/40 p-5">
        <h2 className="text-lg font-semibold">Rodada</h2>

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
              {round.data!.total_votes} {round.data!.total_votes === 1 ? 'voto' : 'votos'}
              {round.data!.total_weight !== round.data!.total_votes &&
                ` · ${round.data!.total_weight} pontos`}
            </p>

            {candidates.data && candidates.data.length > 0 && (
              <ol className="mt-4 space-y-2" aria-label="Placar da rodada">
                {candidates.data.map((c, i) => {
                  const max = Math.max(1, candidates.data![0]?.weight ?? 1);
                  return (
                    <li key={c.id} className="relative overflow-hidden rounded-xl border border-border p-3">
                      <div
                        aria-hidden
                        className={cn('absolute inset-y-0 left-0', i === 0 && c.weight > 0 ? 'bg-primary/15' : 'bg-muted/30')}
                        style={{ width: `${Math.round((c.weight / max) * 100)}%` }}
                      />
                      <div className="relative flex items-center gap-3">
                        <span className="tabular w-5 shrink-0 text-center font-bold text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium">{c.title}</span>
                          <span className="block break-words text-sm text-muted-foreground">{c.artist_name}</span>
                        </span>
                        <span className="tabular shrink-0 text-lg font-bold">{c.weight}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {/*
              Uma ação primária por estado (auditoria 9.4, U4). Com a votação
              aberta, a ação do momento é encerrar — apurar direto força o fim e
              anula Pix pendente, então fica disponível, mas pequena.
            */}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              {round.data!.status === 'open' ? (
                <>
                  <Button
                    className="h-14 text-base sm:min-w-64"
                    disabled={closeVoting.isPending}
                    onClick={() => closeVoting.mutate(round.data!.id)}
                  >
                    {closeVoting.isPending ? 'Encerrando…' : 'Encerrar votação'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={settle.isPending}
                    onClick={() => settle.mutate(round.data!.id)}
                  >
                    Apurar já, sem esperar
                  </Button>
                </>
              ) : (
                <Button
                  className="h-14 text-base sm:min-w-64"
                  disabled={settle.isPending}
                  onClick={() => settle.mutate(round.data!.id)}
                >
                  {settle.isPending ? 'Apurando…' : 'Apurar agora'}
                </Button>
              )}
            </div>
            {round.data!.status === 'closing' && (
              <p className="mt-3 text-xs text-muted-foreground">
                Aguardando os Pix pendentes resolverem. "Apurar agora" força o fechamento e anula
                os que não pagaram.
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
              className="mt-5 h-14 w-full text-base sm:w-auto sm:min-w-64"
              disabled={
                selected.length < 2 ||
                selected.length > 8 ||
                open.isPending ||
                show.data.status !== 'live'
              }
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

      </div>

      <div id="fila" className="scroll-mt-16">
        <QueueCard show={show.data} onChanged={refresh} />
      </div>

      <div id="metricas" className="scroll-mt-16">
      <SectionTitle>Métricas</SectionTitle>
      <ShowSummaryCard showId={id} live={show.data.status === 'live'} />
      <MetricsPlaceholder showId={id} voteMode={show.data.vote_mode} />
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
                  {p.apoios > 0 && ` · ${p.apoios} ${p.apoios === 1 ? 'apoio' : 'apoios'}`}
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
                      { header: 'apoios na fila', value: (p) => p.apoios },
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

      </div>

      <div id="configuracao" className="scroll-mt-16">
      <SectionTitle>Configuração</SectionTitle>
      {/* repertório do show */}
      <section className="vp-surface mt-4 p-5">
        <h2 className="font-semibold">Repertório deste show</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Marque o que pode entrar em votação hoje.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {songs.data?.filter((song) => song.is_active || inShow.has(song.id)).map((song) => (
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
      </div>
    </>
  );
}

const SECTIONS = [
  { id: 'ao-vivo', label: 'Ao vivo' },
  { id: 'fila', label: 'Fila' },
  { id: 'metricas', label: 'Métricas' },
  { id: 'configuracao', label: 'Configuração' },
] as const;

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * Os cartões de métricas só aparecem quando têm o que dizer (ver cada um). Sem
 * isto, a âncora "Métricas" levaria a um título solto sobre nada.
 */
function MetricsPlaceholder({ showId, voteMode }: { showId: string; voteMode: string }) {
  const summary = useQuery({ queryKey: ['summary', showId], queryFn: () => getShowSummary(showId) });
  if (summary.isLoading || (summary.data?.totals.rounds ?? 0) > 0) return null;
  return (
    <p className="vp-surface mt-4 p-5 text-sm text-muted-foreground">
      O resumo da noite aparece depois da primeira rodada apurada
      {voteMode === 'instagram' ? ', e o funil do Instagram quando alguém entrar.' : '.'}
    </p>
  );
}
