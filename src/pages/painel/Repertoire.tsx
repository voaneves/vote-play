import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/context';
import { createSong, deleteSong, listSongs, setSongActive } from '@/lib/painel/queries';
import { cn } from '@/lib/utils';

export default function Repertoire() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  // Remover é definitivo: primeiro toque arma, segundo confirma (auditoria 9.4, U6).
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const songs = useQuery({ queryKey: ['songs'], queryFn: listSongs });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['songs'] });

  const add = useMutation({
    mutationFn: () => createSong(userId!, title, artist),
    onSuccess: () => {
      setTitle('');
      setArtist('');
      invalidate();
    },
    onError: (err: Error) =>
      toast.error(
        /duplicate|unique/i.test(err.message)
          ? 'Essa música já está no seu repertório.'
          : err.message,
      ),
  });

  const active = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => setSongActive(id, value),
    onSuccess: (_d, v) => {
      toast.success(v.value ? 'Música reativada.' : 'Música desativada: não aparece nos próximos shows.');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: deleteSong,
    onSuccess: () => {
      setConfirmId(null);
      invalidate();
    },
    onError: (err: Error, id: string) => {
      setConfirmId(null);
      if (/violates foreign key/i.test(err.message)) {
        // Já usada em show: não some do histórico, mas pode sair de circulação.
        toast.error('Essa música já foi usada em um show e não pode ser removida.', {
          action: { label: 'Desativar', onClick: () => active.mutate({ id, value: false }) },
        });
        return;
      }
      toast.error(err.message);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !artist.trim() || !userId) return;
    add.mutate();
  };

  const field =
    'vp-focus w-full rounded-xl border border-border bg-card px-4 py-3 placeholder:text-muted-foreground/50';

  return (
    <>
      <h1 className="text-2xl font-bold">Repertório</h1>
      <p className="mt-1 text-muted-foreground">
        As músicas que você topa tocar. Cada show escolhe um recorte deste conjunto.
      </p>

      <form onSubmit={handleSubmit} className="vp-surface mt-5 space-y-3 p-4 sm:flex sm:gap-3 sm:space-y-0">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Música"
          aria-label="Música"
          className={field}
        />
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          required
          placeholder="Artista"
          aria-label="Artista"
          className={field}
        />
        <Button type="submit" disabled={add.isPending} className="w-full sm:w-auto">
          Adicionar
        </Button>
      </form>

      <ul className="mt-6 space-y-2">
        {songs.data?.map((song) => (
          <li
            key={song.id}
            className={cn('vp-surface flex flex-wrap items-center gap-2 p-3', !song.is_active && 'opacity-70')}
          >
            <span className="min-w-0 flex-1">
              <span className="block break-words font-medium">{song.title}</span>
              <span className="block break-words text-sm text-muted-foreground">
                {song.artist_name}
                {song.times_played > 0 && ` · tocada ${song.times_played}x`}
                {!song.is_active && ' · desativada'}
              </span>
            </span>
            {!song.is_active ? (
              <Button variant="ghost" className="min-h-11" onClick={() => active.mutate({ id: song.id, value: true })}>
                Reativar
              </Button>
            ) : confirmId === song.id ? (
              <span className="flex gap-1">
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(song.id)}
                >
                  Remover
                </Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setConfirmId(null)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(song.id)}
                aria-label={`Remover ${song.title}`}
                className="vp-focus flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition hover:text-destructive"
              >
                <Trash2 className="h-5 w-5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>

      {songs.data?.length === 0 && (
        <div className="vp-surface mt-6 p-8 text-center text-muted-foreground">
          Repertório vazio. Adicione a primeira música acima.
        </div>
      )}
    </>
  );
}
