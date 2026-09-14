import { cn } from '@/lib/utils';
import { formatClock } from '@/lib/format';

interface Props {
  secondsLeft: number;
  isRunningOut: boolean;
  totalVotes: number;
  roundSeq: number;
}

export function RoundTimer({ secondsLeft, isRunningOut, totalVotes, roundSeq }: Props) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Rodada {roundSeq} · encerra em
      </p>
      <p
        aria-live="polite"
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
    </div>
  );
}
