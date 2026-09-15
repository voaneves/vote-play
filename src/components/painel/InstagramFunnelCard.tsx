import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getInstagramMetrics,
  setInstagramFollowers,
  type InstagramMetrics,
} from '@/lib/painel/queries';

/**
 * O funil do portão do Instagram.
 *
 * Por que existe um funil e não um número de seguidores: nenhuma API pública
 * devolve a contagem de seguidores de um perfil — a Basic Display foi desligada
 * em setembro de 2025, e a Graph API só lê perfil Business vinculado a uma
 * página do Facebook, com app autorizado pelo próprio artista. Inventar o
 * número seria pior que não ter.
 *
 * O funil, além de ser verdadeiro, responde o que o número de seguidores não
 * responde: ONDE consertar. Entra muita gente e poucos tocam em Seguir? O
 * problema é a tela do portão. Muitos tocam e poucos declaram o @? É o atrito
 * da volta do Instagram. Muitos declaram e poucos votam? O portão está caro
 * demais para o que entrega.
 */

const ETAPAS = [
  { chave: 'entered', rotulo: 'Entrou no show' },
  { chave: 'clicked', rotulo: 'Tocou em "Seguir"' },
  { chave: 'declared', rotulo: 'Declarou o @' },
  { chave: 'voted', rotulo: 'Votou' },
] as const;

export function InstagramFunnelCard({ showId, live }: { showId: string; live: boolean }) {
  const queryClient = useQueryClient();
  const metrics = useQuery({
    queryKey: ['insta-metrics', showId],
    queryFn: () => getInstagramMetrics(showId),
    refetchInterval: live ? 15_000 : false,
  });

  const data = metrics.data;
  // Funil de zeros antes de alguém entrar é ruído, e ruído ensina o artista a
  // ignorar a seção. Ele aparece quando passa a ter o que dizer.
  if (!data || data.funnel.entered === 0) return null;

  const { funnel, newHandles, followers } = data;
  // A escala é o topo do funil. Se nada entrou ainda, 1 evita divisão por zero
  // sem inventar barra: todas as contagens são 0 e todas as barras somem.
  const escala = Math.max(funnel.entered, 1);

  return (
    <section className="vp-surface mt-4 p-5">
      <h2 className="font-semibold">Instagram</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        O caminho que a plateia percorreu até o voto.
      </p>

      <ol className="mt-5 space-y-2">
        {ETAPAS.map((etapa, i) => {
          const valor = funnel[etapa.chave];
          const anterior = i === 0 ? null : funnel[ETAPAS[i - 1].chave];
          return (
            <li key={etapa.chave}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{etapa.rotulo}</span>
                <span className="tabular shrink-0 font-semibold">{valor}</span>
              </div>

              {/* A barra é decoração: os números já estão no texto acima, então
                  quem usa leitor de tela não perde nada ao pular o gráfico. */}
              <div
                aria-hidden
                className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted/50"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                  style={{ width: `${(valor / escala) * 100}%` }}
                />
              </div>

              {anterior !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {queda(anterior, valor)}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <dl className="mt-6 border-t border-border/60 pt-4">
        <dt className="text-sm text-muted-foreground">
          @ novos — nunca tinham aparecido num show seu
        </dt>
        <dd className="tabular text-2xl font-bold leading-tight">{newHandles}</dd>
      </dl>

      <Seguidores
        showId={showId}
        followers={followers}
        onSaved={() =>
          void queryClient.invalidateQueries({ queryKey: ['insta-metrics', showId] })
        }
      />
    </section>
  );
}

/**
 * Nunca "X% converteram" sem dizer de quê: a base muda a cada etapa, e a mesma
 * porcentagem sobre bases diferentes conta histórias opostas.
 */
function queda(anterior: number, atual: number): string {
  if (anterior === 0) return '—';
  if (atual > anterior) {
    // Pode acontecer de verdade: o toque em "Seguir" é registrado em segundo
    // plano e uma falha de rede o perde, enquanto o @ é salvo com confirmação.
    // Mostrar a inversão é mais honesto que achatar para 100%.
    return `${atual - anterior} a mais que a etapa anterior (toque não registrado?)`;
  }
  const pct = Math.round((atual / anterior) * 100);
  const perdidos = anterior - atual;
  if (perdidos === 0) return 'todos seguiram para cá';
  return `${pct}% da etapa anterior — ${perdidos} ${perdidos === 1 ? 'pessoa parou' : 'pessoas pararam'} aqui`;
}

function Seguidores({
  showId,
  followers,
  onSaved,
}: {
  showId: string;
  followers: InstagramMetrics['followers'];
  onSaved: () => void;
}) {
  const [antes, setAntes] = useState(followers.before?.toString() ?? '');
  const [depois, setDepois] = useState(followers.after?.toString() ?? '');

  const salvar = useMutation({
    mutationFn: (patch: { before?: number | null; after?: number | null }) =>
      setInstagramFollowers(showId, patch),
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });

  const num = (v: string): number | null => {
    const n = Number.parseInt(v.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  const a = num(antes);
  const d = num(depois);
  const delta = a !== null && d !== null ? d - a : null;

  const campo =
    'vp-focus tabular w-full rounded-xl border border-border bg-card px-3 py-2.5 text-right';

  return (
    <div className="mt-6 border-t border-border/60 pt-4">
      <p className="text-sm font-medium">Seguidores no seu perfil</p>
      {/*
        A ressalva fica no painel, à vista, e não na tela da plateia. O artista é
        quem precisa saber o que está comprando; a plateia não ganha nada em
        ouvir que o portão não confere nada — só ganha motivo para pular o passo.
      */}
      <p className="mt-1 text-xs text-muted-foreground">
        Anote você mesmo, antes e depois. Nenhuma API do Instagram informa quantos
        seguidores um perfil tem — e quem seguiu na noite pode ter vindo do palco
        ou do cartaz, não necessariamente daqui.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Antes</span>
          <input
            inputMode="numeric"
            value={antes}
            onChange={(e) => setAntes(e.target.value)}
            onBlur={() => salvar.mutate({ before: num(antes) })}
            placeholder="—"
            className={campo}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Depois</span>
          <input
            inputMode="numeric"
            value={depois}
            onChange={(e) => setDepois(e.target.value)}
            onBlur={() => salvar.mutate({ after: num(depois) })}
            placeholder="—"
            className={campo}
          />
        </label>
      </div>

      {delta !== null && (
        <p
          className={cn(
            'tabular mt-3 text-center text-lg font-bold',
            delta > 0 ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {delta > 0 ? '+' : ''}
          {delta} {Math.abs(delta) === 1 ? 'seguidor' : 'seguidores'} na noite
        </p>
      )}
    </div>
  );
}
