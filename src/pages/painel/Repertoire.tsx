import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/context';
import { createSong, deleteSong, listSongs } from '@/lib/painel/queries';

export default function Repertoire() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

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

  const remove = useMutation({
    mutationFn: deleteSong,
    onSuccess: invalidate,
    onError: (err: Error) =>
      toast.error(
        /violates foreign key/i.test(err.message)
          ? 'Não dá para excluir: a música já foi usada em um show.'
          : err.message,
      ),
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
          <li key={song.id} className="vp-surface flex items-center gap-3 p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{song.title}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {song.artist_name}
                {song.times_played > 0 && ` · tocada ${song.times_played}x`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => remove.mutate(song.id)}
              aria-label={`Remover ${song.title}`}
              className="vp-focus rounded-lg p-2 text-muted-foreground transition hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
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
