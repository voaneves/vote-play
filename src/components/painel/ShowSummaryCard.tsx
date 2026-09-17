import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { downloadCsv, slugify, toCsv } from '@/lib/csv';
import { formatCents } from '@/lib/format';
import { getShowSummary, type SummaryRoundRow } from '@/lib/painel/queries';
import { VotesPerRoundChart } from '@/components/painel/VotesPerRoundChart';

/**
 * O que aconteceu na noite.
 *
 * Só aparece quando existe pelo menos uma rodada apurada: um resumo de show que
 * ainda não começou é uma tela de zeros, e tela de zeros ensina o artista a
 * ignorar a seção.
 *
 * Fora fechar o ciclo para ele, isto é a peça que vira story no dia seguinte —
 * por isso a vencedora aparece grande e as demais, pequenas: é a forma de quem
 * vai tirar print.
 */
export function ShowSummaryCard({ showId, live }: { showId: string; live: boolean }) {
  const summary = useQuery({
    queryKey: ['summary', showId],
    queryFn: () => getShowSummary(showId),
    refetchInterval: live ? 15_000 : false,
  });

  const data = summary.data;
  if (!data || data.totals.rounds === 0) return null;

  const { totals, rounds, show } = data;
  const settled = rounds.filter((r) => r.status === 'settled');
  const paid = show.voteMode === 'pix';

  const exportCsv = () => {
    downloadCsv(
      `resumo-${slugify(show.title)}.csv`,
      toCsv<SummaryRoundRow>(settled, [
        { header: 'rodada', value: (r) => r.seq },
        { header: 'titulo', value: (r) => r.label ?? '' },
        { header: 'vencedora', value: (r) => r.winner?.title ?? '(sem vencedora)' },
        { header: 'artista', value: (r) => r.winner?.artistName ?? '' },
        { header: 'votos', value: (r) => r.totalVotes },
        { header: 'peso', value: (r) => r.totalWeight },
        ...(paid
          ? [
              {
                header: 'arrecadado (R$)',
                // vírgula decimal: é assim que o Excel em pt-BR lê número
                value: (r: SummaryRoundRow) =>
                  (r.amountCents / 100).toFixed(2).replace('.', ','),
              },
            ]
          : []),
        {
          header: 'apurada em',
          value: (r) => (r.settledAt ? new Date(r.settledAt).toLocaleString('pt-BR') : ''),
        },
      ]),
    );
    toast.success(`${settled.length} rodadas exportadas.`);
  };

  return (
    <section className="vp-surface mt-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">A noite até agora</h2>
        <button
          type="button"
          onClick={exportCsv}
          className="vp-focus text-sm text-primary underline underline-offset-4"
        >
          Baixar CSV
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={totals.rounds === 1 ? 'rodada' : 'rodadas'} value={totals.rounds} />
        <Stat label="pessoas" value={totals.participants} />
        <Stat label="votos" value={totals.votes} />
        {paid ? (
          <Stat label="arrecadado" value={formatCents(totals.amountCents)} />
        ) : (
          <Stat label="com @" value={totals.withInstagram} />
        )}
      </dl>

      <VotesPerRoundChart rounds={settled} />

      <ol className="mt-5 space-y-3">
        {settled.map((round) => (
          <li
            key={round.id}
            className="border-t border-border/60 pt-3 first:border-0 first:pt-0"
          >
            <div className="flex items-baseline gap-3">
              <span className="tabular shrink-0 text-sm text-muted-foreground">
                {round.seq}ª
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {round.winner?.title ?? 'Sem vencedora'}
                </p>
                {round.winner && (
                  <p className="truncate text-sm text-muted-foreground">
                    {round.winner.artistName}
                  </p>
                )}
              </div>
              <span className="tabular shrink-0 text-sm text-muted-foreground">
                {round.totalVotes} {round.totalVotes === 1 ? 'voto' : 'votos'}
              </span>
            </div>

            {round.runnersUp.length > 0 && (
              <p className="mt-1 truncate pl-8 text-xs text-muted-foreground">
                disputou com {round.runnersUp.map((c) => c.title).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dd className="tabular text-2xl font-bold leading-tight">{value}</dd>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
    </div>
  );
}
