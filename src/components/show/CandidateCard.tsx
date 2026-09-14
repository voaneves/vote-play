import { cn } from '@/lib/utils';
import { formatCents, percent } from '@/lib/format';
import type { RoundCandidate } from '@/types/domain';

interface Props {
  candidate: RoundCandidate;
  rank: number;
  totalWeight: number;
  leading: boolean;
  disabled?: boolean;
  onVote: (candidate: RoundCandidate) => void;
}

export function CandidateCard({
  candidate,
  rank,
  totalWeight,
  leading,
  disabled,
  onVote,
}: Props) {
  const share = percent(candidate.weight, totalWeight);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onVote(candidate)}
      aria-label={`Votar em ${candidate.title}, de ${candidate.artistName}. ${share}% dos pontos.`}
      className={cn(
        'vp-surface vp-focus group relative w-full overflow-hidden p-4 text-left transition',
        'active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50',
        leading && 'border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]',
      )}
    >
      {/* barra de participação — preenchimento do próprio card, não um elemento separado */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 transition-[width] duration-700 ease-out',
          leading ? 'bg-primary/20' : 'bg-muted/40',
        )}
        style={{ width: `${share}%` }}
      />

      <div className="relative flex items-center gap-3">
        <span
          className={cn(
            'tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            leading
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {rank}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold leading-tight">
            {candidate.title}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {candidate.artistName}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="tabular block text-lg font-bold leading-none">
            {candidate.weight}
          </span>
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
            {share}%
          </span>
        </span>
      </div>

      <div className="relative mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {candidate.votesCount} {candidate.votesCount === 1 ? 'voto' : 'votos'}
          {candidate.amountCents > 0 && ` · ${formatCents(candidate.amountCents)}`}
        </span>
        <span className="font-semibold text-primary opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          Votar →
        </span>
      </div>
    </button>
  );
}
