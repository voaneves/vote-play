import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { listSuspiciousSessions } from '@/lib/painel/queries';

/**
 * Sessões que dividem o mesmo IP.
 *
 * Existe porque o rate limit sozinho é invisível: ele barra em silêncio e o
 * artista termina a noite sem saber se teve abuso ou não.
 *
 * A tela é deliberadamente morna. Três sessões no mesmo IP é, quase sempre, a
 * mesa dos amigos no wi-fi do bar — e um cartão vermelho gritando "FRAUDE"
 * levaria um artista a desconfiar da própria plateia por causa de um roteador
 * compartilhado. Por isso o texto diz o que o número é e o que ele não é, e o
 * app não bloqueia ninguém com base nele.
 */
export function SuspiciousSessionsCard({ showId }: { showId: string }) {
  const grupos = useQuery({
    queryKey: ['suspeitas', showId],
    queryFn: () => listSuspiciousSessions(showId),
    refetchInterval: 30_000,
  });

  // Sem nada agrupado, não há o que mostrar — e um cartão vazio no painel é só
  // ruído competindo com a ação principal da tela.
  if (!grupos.data || grupos.data.length === 0) return null;

  const total = grupos.data.reduce((soma, g) => soma + g.sessoes, 0);

  return (
    <section className="vp-surface mt-4 p-5">
      <header className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold">Aparelhos no mesmo endereço</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total} sessões em {grupos.data.length}{' '}
            {grupos.data.length === 1 ? 'endereço' : 'endereços'}
          </p>
        </div>
      </header>

      <ul className="mt-4 space-y-2">
        {grupos.data.map((g) => (
          <li
            key={g.ip_hash_curto}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="truncate font-mono text-xs text-muted-foreground">
              {g.ip_hash_curto}…
            </span>
            <span className="shrink-0 tabular-nums">
              <strong>{g.sessoes}</strong> sessões · {g.votos} votos
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        Isto é pista, não acusação: o wi-fi da casa dá o mesmo endereço para todo
        mundo, e operadoras de celular também agrupam muita gente num endereço só —
        num show cheio, um grupo grande aqui é o normal. O app não bloqueia
        ninguém por causa desta lista. O endereço em si não é guardado — só um
        código embaralhado, diferente a cada show.
      </p>
    </section>
  );
}
