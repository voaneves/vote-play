import { useState } from 'react';
import type { SummaryRoundRow } from '@/lib/painel/queries';

/**
 * Votos por rodada, na ordem da noite (plan.md, 5.3).
 *
 * Responde uma pergunta só: o show engajou no começo e morreu, ou cresceu?
 * Colunas, não linha — rodadas são eventos discretos, e uma linha sugeriria
 * votos "entre" rodadas que não existiram.
 *
 * Especificação do gráfico (skill de dataviz do projeto): série única, então
 * sem legenda — o título diz o que é; coluna ≤ 24 px com ponta arredondada e
 * base reta; rótulo só no pico e na última rodada, nunca em todas; texto nunca
 * na cor da série; cada coluna é alvo de toque/foco com o valor; e a tabela
 * por trás fica a um toque, porque leitor de tela não lê barra.
 */
export function VotesPerRoundChart({ rounds }: { rounds: SummaryRoundRow[] }) {
  const [focus, setFocus] = useState<string | null>(null);
  if (rounds.length < 2) return null; // uma coluna sozinha não mostra tendência nenhuma

  const max = Math.max(1, ...rounds.map((r) => r.totalVotes));
  const peakId = rounds.reduce((a, b) => (b.totalVotes > a.totalVotes ? b : a)).id;
  const lastId = rounds[rounds.length - 1].id;

  return (
    <figure className="mt-6">
      <figcaption className="text-sm font-medium">Votos por rodada</figcaption>

      <div className="relative mt-3 flex h-40 items-end gap-0.5 border-b border-border pt-6">
        {rounds.map((round) => {
          const height = (round.totalVotes / max) * 100;
          const labeled = round.id === peakId || round.id === lastId;
          const active = focus === round.id;
          return (
            <button
              key={round.id}
              type="button"
              aria-label={`${round.seq}ª rodada: ${round.totalVotes} ${round.totalVotes === 1 ? 'voto' : 'votos'}${round.winner ? `, venceu ${round.winner.title}` : ''}`}
              onPointerEnter={() => setFocus(round.id)}
              onPointerLeave={() => setFocus((f) => (f === round.id ? null : f))}
              onFocus={() => setFocus(round.id)}
              onBlur={() => setFocus((f) => (f === round.id ? null : f))}
              // o alvo é a faixa inteira da rodada, não só a coluna pintada
              className="vp-focus group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-sm"
            >
              {labeled && !active && (
                <span className="tabular mb-1 text-xs font-semibold text-foreground">
                  {round.totalVotes}
                </span>
              )}
              <span
                aria-hidden
                className="block w-full max-w-6 rounded-t bg-primary transition-[height,opacity] duration-500 ease-out group-hover:opacity-80"
                style={{ height: `${Math.max(height, round.totalVotes > 0 ? 2 : 0)}%` }}
              />
              {active && (
                <span
                  role="presentation"
                  className="pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-48 rounded-md border border-border bg-popover px-2.5 py-1.5 text-left shadow-lg"
                >
                  <span className="tabular block text-sm font-bold text-popover-foreground">
                    {round.totalVotes} {round.totalVotes === 1 ? 'voto' : 'votos'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {round.seq}ª rodada{round.winner ? ` · ${round.winner.title}` : ''}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex gap-0.5" aria-hidden>
        {rounds.map((round) => (
          <span key={round.id} className="tabular min-w-0 flex-1 text-center text-[11px] text-muted-foreground">
            {rounds.length <= 12 || round.seq % 5 === 0 || round.id === lastId ? `${round.seq}ª` : ''}
          </span>
        ))}
      </div>

      <details className="mt-3 text-sm">
        <summary className="vp-focus inline-flex min-h-11 cursor-pointer items-center rounded-lg text-primary underline underline-offset-4">
          Ver em tabela
        </summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-medium">Rodada</th>
              <th scope="col" className="py-1 font-medium">Vencedora</th>
              <th scope="col" className="py-1 text-right font-medium">Votos</th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => (
              <tr key={round.id} className="border-t border-border/60">
                <td className="tabular py-1.5">{round.seq}ª</td>
                <td className="py-1.5">{round.winner?.title ?? 'Sem vencedora'}</td>
                <td className="tabular py-1.5 text-right">{round.totalVotes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
