import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/context';
import { createShow, listShows } from '@/lib/painel/queries';
import { cn } from '@/lib/utils';
import type { ShowStatus } from '@/types/domain';

const STATUS_LABEL: Record<ShowStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  live: 'No ar',
  paused: 'Pausado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};

export default function Shows() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');

  const shows = useQuery({ queryKey: ['shows'], queryFn: listShows });

  const create = useMutation({
    mutationFn: () => createShow(userId!, { title, venue }),
    onSuccess: (row) => {
      toast.success(`Show criado. Código: ${row.join_code}`);
      setTitle('');
      setVenue('');
      void queryClient.invalidateQueries({ queryKey: ['shows'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !userId) return;
    create.mutate();
  };

  const field =
    'vp-focus w-full rounded-xl border border-border bg-card px-4 py-3 placeholder:text-muted-foreground/50';

  return (
    <>
      <h1 className="text-2xl font-bold">Seus shows</h1>

      <form onSubmit={handleSubmit} className="vp-surface mt-5 space-y-3 p-4">
        <p className="text-sm font-medium">Novo show</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="Nome do show"
          aria-label="Nome do show"
          className={field}
        />
        <input
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          placeholder="Local (opcional)"
          aria-label="Local"
          className={field}
        />
        <Button type="submit" disabled={create.isPending} className="w-full sm:w-auto">
          {create.isPending ? 'Criando…' : 'Criar show'}
        </Button>
        <p className="text-xs text-muted-foreground">
          O código de entrada é gerado pelo banco, com 6 caracteres sem letras ambíguas.
        </p>
      </form>

      <section className="mt-8 space-y-2">
        {shows.isLoading && <p className="text-muted-foreground">Carregando…</p>}
        {shows.isError && (
          <p className="text-destructive">{(shows.error as Error).message}</p>
        )}
        {shows.data?.length === 0 && (
          <div className="vp-surface p-8 text-center text-muted-foreground">
            Nenhum show ainda. Crie o primeiro acima.
          </div>
        )}
        {shows.data?.map((show) => (
          <Link
            key={show.id}
            to={`/painel/shows/${show.id}`}
            className="vp-surface vp-focus flex items-center gap-3 p-4 transition hover:border-primary/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{show.title}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {show.venue ?? 'sem local'} · {STATUS_LABEL[show.status]}
              </span>
            </span>
            <span
              className={cn(
                'tabular shrink-0 rounded-full border px-2.5 py-1 font-mono text-xs tracking-widest',
                show.status === 'live'
                  ? 'border-primary/60 text-primary'
                  : 'border-border text-muted-foreground',
              )}
            >
              {show.join_code}
            </span>
          </Link>
        ))}
      </section>
    </>
  );
}
