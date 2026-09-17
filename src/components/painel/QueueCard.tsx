import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  listQueue,
  setQueueConfig,
  setSongFlags,
  setSongPlayed,
  type QueueRow,
  type ShowRow,
} from '@/lib/painel/queries';

const STATUS_LABEL: Partial<Record<QueueRow['status'], string>> = {
  queued: 'Escolhida na rodada',
  candidate: 'Na rodada agora',
};

/**
 * A fila do repertório no painel.
 *
 * O artista não opera nada durante a música: olha a de cima e toca. O único
 * toque obrigatório é "tocada", que tira a música da fila e devolve os apoios
 * de quem a apoiou. Fixar e esconder são curadoria — um repertório é uma lista
 * escolhida, não uma urna.
 */
export function QueueCard({ show, onChanged }: { show: ShowRow; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const live = show.status === 'live';

  const queue = useQuery({
    queryKey: ['queue', show.id],
    queryFn: () => listQueue(show.id),
    enabled: show.queue_enabled,
    refetchInterval: live ? 5_000 : false,
  });

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['queue', show.id] });
    onChanged();
  };
  const fail = (err: Error) => toast.error(err.message);

  const played = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setSongPlayed(id, value),
    onSuccess: done,
    onError: fail,
  });
  const flags = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { pinned?: boolean; hidden?: boolean } }) =>
      setSongFlags(id, patch),
    onSuccess: done,
    onError: fail,
  });
  const config = useMutation({
    mutationFn: (patch: { queue_enabled?: boolean; queue_votes_per_session?: number }) =>
      setQueueConfig(show.id, patch),
    onSuccess: done,
    onError: fail,
  });

  const rows = queue.data ?? [];
  const active = rows.filter((r) => !r.hidden && ['available', 'candidate', 'queued'].includes(r.status));
  const hidden = rows.filter((r) => r.hidden && r.status !== 'played');
  const playedRows = rows
    .filter((r) => r.status === 'played')
    .sort((a, b) => (b.played_at ?? '').localeCompare(a.played_at ?? ''));
  const maxWeight = Math.max(1, ...active.map((r) => r.queue_weight));
  const pixMode = show.vote_mode === 'pix';

  return (
    <section className="vp-surface mt-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-semibold">Fila do repertório</h2>
        {show.queue_enabled && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Apoios por pessoa
            <select
              aria-label="Apoios por pessoa"
              value={show.queue_votes_per_session}
              onChange={(e) => config.mutate({ queue_votes_per_session: Number(e.target.value) })}
              className="vp-focus h-11 rounded-lg border border-border bg-card px-3 text-foreground"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          className="min-h-11"
          variant={show.queue_enabled ? 'ghost' : 'secondary'}
          onClick={() => config.mutate({ queue_enabled: !show.queue_enabled })}
        >
          {show.queue_enabled ? 'Fechar fila' : 'Abrir fila'}
        </Button>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {pixMode
          ? 'No modo Pix o apoio é pago e chega com a Fase 7. Até lá a plateia não vê a fila.'
          : 'A plateia apoia músicas e a mais apoiada é a próxima. Toque em "Tocada" quando tocar — os apoios voltam para quem apoiou.'}
      </p>

      {show.queue_enabled && (
        <>
          {queue.isLoading && <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>}
          {active.length === 0 && !queue.isLoading && (
            <p className="mt-4 text-sm text-muted-foreground">
              Nenhuma música na fila. Inclua músicas em "Repertório deste show".
            </p>
          )}

          <ol className="mt-4 space-y-2">
            {active.map((row, i) => (
              <li key={row.id} className="relative overflow-hidden rounded-xl border border-border p-3">
                <div
                  aria-hidden
                  className={cn('absolute inset-y-0 left-0', i === 0 ? 'bg-primary/15' : 'bg-muted/30')}
                  style={{ width: `${Math.round((row.queue_weight / maxWeight) * 100)}%` }}
                />
                {/*
                  Título em cima, ações embaixo. Na mesma linha, os três botões
                  comiam a largura do celular e o título virava "W…" — no palco,
                  que é onde esta tela é usada (auditoria 9.4, U1).
                */}
                <div className="relative flex items-start gap-3">
                  <span
                    className={cn(
                      'tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{row.songs?.title}</span>
                    <span className="block break-words text-sm text-muted-foreground">
                      {row.songs?.artist_name}
                      {' · '}
                      <span className="tabular">
                        {row.queue_votes} {row.queue_votes === 1 ? 'apoio' : 'apoios'}
                      </span>
                      {STATUS_LABEL[row.status] && ` · ${STATUS_LABEL[row.status]}`}
                      {row.pinned && ' · fixada'}
                    </span>
                  </span>
                </div>
                <div className="relative mt-3 flex flex-wrap items-center gap-2 pl-11">
                  {row.status === 'candidate' ? (
                    // desabilitado com cara de desabilitado, e o motivo escrito (U7)
                    <span className="inline-flex min-h-11 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
                      Na rodada — apure antes de marcar
                    </span>
                  ) : (
                    <Button
                      className="min-h-11"
                      disabled={played.isPending}
                      onClick={() => played.mutate({ id: row.id, value: true })}
                    >
                      Tocada
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => flags.mutate({ id: row.id, patch: { pinned: !row.pinned } })}
                  >
                    {row.pinned ? 'Soltar' : 'Fixar'}
                  </Button>
                  {row.status !== 'candidate' && (
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => flags.mutate({ id: row.id, patch: { hidden: true } })}
                    >
                      Esconder
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {(hidden.length > 0 || playedRows.length > 0) && (
            <div className="mt-5 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
              {playedRows.length > 0 && (
                <div>
                  <h3 className="font-medium">Tocadas ({playedRows.length})</h3>
                  <ul className="mt-2 space-y-1">
                    {playedRows.map((row) => (
                      <li key={row.id} className="flex items-center gap-2 text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{row.songs?.title}</span>
                        <button
                          type="button"
                          className="vp-focus inline-flex min-h-11 shrink-0 items-center px-2 text-primary underline underline-offset-4"
                          onClick={() => played.mutate({ id: row.id, value: false })}
                        >
                          desfazer
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hidden.length > 0 && (
                <div>
                  <h3 className="font-medium">Escondidas ({hidden.length})</h3>
                  <ul className="mt-2 space-y-1">
                    {hidden.map((row) => (
                      <li key={row.id} className="flex items-center gap-2 text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{row.songs?.title}</span>
                        <button
                          type="button"
                          className="vp-focus inline-flex min-h-11 shrink-0 items-center px-2 text-primary underline underline-offset-4"
                          onClick={() => flags.mutate({ id: row.id, patch: { hidden: false } })}
                        >
                          mostrar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
