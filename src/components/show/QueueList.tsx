import { cn } from '@/lib/utils';
import type { DirectRequest } from '@/types/domain';

const STATUS_LABEL: Record<DirectRequest['status'], string> = {
  pending_payment: 'Aguardando Pix',
  paid: 'Na fila',
  accepted: 'Aceita pelo artista',
  declined: 'Recusada',
  played: 'Já tocou',
  refunded: 'Estornada',
};

export function QueueList({ requests }: { requests: DirectRequest[] }) {
  if (requests.length === 0) {
    return (
      <div className="vp-surface p-8 text-center">
        <p className="font-medium">A fila está vazia</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Seja a primeira pessoa a furar a fila.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {requests.map((req) => (
        <li
          key={req.id}
          className={cn(
            'vp-surface flex items-center gap-3 p-3',
            req.mine && 'border-primary/50',
          )}
        >
          <span className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {req.queuePosition ?? '—'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-tight">{req.title}</span>
            <span className="block truncate text-sm text-muted-foreground">
              {req.artistName}
              {req.requesterName && ` · por ${req.requesterName}`}
            </span>
            {req.message && (
              <span className="mt-1 block truncate text-xs italic text-muted-foreground/80">
                “{req.message}”
              </span>
            )}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium',
              req.status === 'accepted' && 'bg-success/15 text-success',
              req.status === 'pending_payment' && 'bg-muted text-muted-foreground',
              req.status === 'paid' && 'bg-primary/15 text-primary',
              (req.status === 'declined' || req.status === 'refunded') &&
                'bg-destructive/15 text-destructive',
              req.status === 'played' && 'bg-muted text-muted-foreground',
            )}
          >
            {STATUS_LABEL[req.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
