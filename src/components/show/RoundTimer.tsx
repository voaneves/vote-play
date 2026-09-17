import { cn } from '@/lib/utils';
import { formatClock } from '@/lib/format';

interface Props {
  secondsLeft: number;
  isRunningOut: boolean;
  totalVotes: number;
  roundSeq: number;
}

/**
 * O que o leitor de tela ouve do cronômetro.
 *
 * O relógio visível muda a cada segundo; se ele fosse região viva, o leitor
 * anunciaria "4:59, 4:58…" sem parar e atropelaria qualquer outra informação
 * (auditoria 9.4, A1). A região viva recebe só marcos: o texto abaixo muda
 * poucas vezes por rodada, e é só quando ele muda que o leitor fala.
 */
function milestone(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Votação encerrada.';
  if (secondsLeft <= 10) return 'Faltam 10 segundos para encerrar a votação.';
  if (secondsLeft <= 60) return 'Falta 1 minuto para encerrar a votação.';
  return '';
}

export function RoundTimer({ secondsLeft, isRunningOut, totalVotes, roundSeq }: Props) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Rodada {roundSeq} · encerra em
      </p>
      <p
        className={cn(
          'tabular mt-1 text-6xl font-bold leading-none transition-colors',
          isRunningOut ? 'text-primary' : 'text-foreground',
        )}
      >
        {formatClock(secondsLeft)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {totalVotes} {totalVotes === 1 ? 'voto' : 'votos'} nesta rodada
      </p>
      <p className="sr-only" aria-live="polite">
        {milestone(secondsLeft)}
      </p>
    </div>
  );
}
