import { Check, Pin, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepertoireSong, RepertoireState } from '@/types/domain';

interface Props {
  state: RepertoireState;
  /** id da música cujo toque ainda está indo ao servidor */
  pendingId: string | null;
  onToggle: (song: RepertoireSong) => void;
}

/**
 * A fila do repertório na mão da plateia.
 *
 * Em ordem de ranking, porque é isso que a fila É: a de cima toca primeiro. A
 * regra de "não reordenar debaixo do dedo" da rodada não se aplica igual aqui —
 * o apoio se desfaz com outro toque, e a lista só muda a cada ~10 s — mas o
 * toque passa por um botão explícito, não pelo card inteiro.
 */
export function RepertoireList({ state, pendingId, onToggle }: Props) {
  if (state.songs.length === 0) {
    return (
      <div className="vp-surface mt-4 p-8 text-center">
        <p className="font-medium">A fila ainda está vazia</p>
        <p className="mt-1 text-sm text-muted-foreground">
          O repertório aparece aqui assim que o artista montar o show.
        </p>
      </div>
    );
  }

  const maxWeight = Math.max(1, ...state.songs.map((s) => s.weight));
  const { supportsLeft, supportsPerSession } = state;

  return (
    <>
      <section className="vp-surface mb-4 mt-2 p-5 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Fila do repertório
        </p>
        <p className="mt-2 text-lg font-bold">
          {supportsLeft === 0
            ? 'Seus apoios estão todos em jogo'
            : `Você tem ${supportsLeft} ${supportsLeft === 1 ? 'apoio' : 'apoios'}`}
        </p>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: supportsPerSession }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                i < supportsPerSession - supportsLeft ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {supportsLeft === 0
            ? 'Tire um apoio para dar a outra música. Quando uma tocar, o apoio volta.'
            : 'A música mais apoiada é a próxima. Quando ela tocar, seu apoio volta.'}
        </p>
      </section>

      {/* sem aria-live aqui: a lista inteira seria relida a cada consulta (A1) */}
      <ol className="space-y-2" aria-label="Fila do repertório, em ordem">
        {state.songs.map((song) => {
          const pending = pendingId === song.id;
          const blocked =
            !song.mine && (song.status !== 'available' || supportsLeft === 0);
          const share = Math.round((song.weight / maxWeight) * 100);

          return (
            <li
              key={song.id}
              className={cn(
                'vp-surface relative overflow-hidden p-3',
                song.rank === 1 && 'border-primary/60',
                song.mine && 'border-primary ring-1 ring-primary/40',
              )}
            >
              <div
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 transition-[width] duration-700 ease-out',
                  song.rank === 1 ? 'bg-primary/15' : 'bg-muted/30',
                )}
                style={{ width: `${share}%` }}
              />
              <div className="relative flex items-center gap-3">
                <span
                  className={cn(
                    'tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    song.rank === 1
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {song.rank}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold leading-tight">{song.title}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {song.artistName}
                  </span>
                  {(song.status !== 'available' || song.pinned) && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {song.status === 'queued' && <Badge>Escolhida na rodada</Badge>}
                      {song.status === 'candidate' && <Badge>Na rodada agora</Badge>}
                      {song.pinned && (
                        <Badge>
                          <Pin className="h-3 w-3" aria-hidden /> Fixada pelo artista
                        </Badge>
                      )}
                    </span>
                  )}
                </span>

                <span className="tabular shrink-0 text-right text-sm text-muted-foreground">
                  {song.weight}
                  <span className="sr-only"> {song.weight === 1 ? 'apoio' : 'apoios'}</span>
                </span>

                <button
                  type="button"
                  onClick={() => onToggle(song)}
                  disabled={pending || blocked}
                  aria-pressed={song.mine}
                  aria-label={
                    song.mine
                      ? `Tirar apoio de ${song.title}`
                      : `Apoiar ${song.title}`
                  }
                  className={cn(
                    'vp-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition',
                    'disabled:opacity-40',
                    song.mine
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground',
                    pending && 'animate-pulse',
                  )}
                >
                  {song.mine ? (
                    <Check className="h-5 w-5" aria-hidden />
                  ) : (
                    <Plus className="h-5 w-5" aria-hidden />
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
      {children}
    </span>
  );
}
