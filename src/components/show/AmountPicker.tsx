import { useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCents, formatCentsShort } from '@/lib/format';
import { previewVoteWeight } from '@/lib/api';
import type { RoundCandidate, ShowPublic } from '@/types/domain';

interface Props {
  show: ShowPublic;
  candidate: RoundCandidate | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (amountCents: number) => void;
}

export function AmountPicker({ show, candidate, submitting, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<number>(
    show.voteSuggestedCents[1] ?? show.voteMinCents,
  );

  const points = previewVoteWeight(show.voteMode, selected, show.centsPerPoint);

  return (
    <Drawer open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="border-border bg-card">
        <div className="mx-auto w-full max-w-md px-4 pb-8">
          <DrawerHeader className="px-0 text-left">
            <DrawerTitle className="text-xl">{candidate?.title}</DrawerTitle>
            <DrawerDescription>
              {candidate?.artistName} · escolha quanto vale o seu voto
            </DrawerDescription>
          </DrawerHeader>

          <div className="grid grid-cols-3 gap-2">
            {show.voteSuggestedCents.map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => setSelected(cents)}
                aria-pressed={selected === cents}
                className={cn(
                  'vp-focus rounded-xl border py-4 text-center transition',
                  selected === cents
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40',
                )}
              >
                <span className="block text-xs opacity-70">R$</span>
                <span className="tabular block text-2xl font-bold">
                  {formatCentsShort(cents)}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {show.voteMode === 'free_with_tip' ? (
              <>Seu voto vale 1 ponto. O valor é uma gorjeta para o artista.</>
            ) : (
              <>
                Vale{' '}
                <strong className="tabular text-foreground">{points} pontos</strong> no
                ranking
              </>
            )}
          </p>

          <Button
            size="lg"
            disabled={submitting}
            onClick={() => onConfirm(selected)}
            className="mt-5 h-14 w-full text-base font-semibold"
          >
            {submitting ? 'Gerando Pix…' : `Pagar ${formatCents(selected)} com Pix`}
          </Button>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            O voto entra no placar assim que o Pix for confirmado.
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
