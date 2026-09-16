import { CloudOff, RefreshCw } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';
import type { ConnectionHealth } from '@/lib/api/types';

/**
 * Aviso de conexão para a tela da plateia.
 *
 * A regra é: só aparece quando a tela está **mentindo**. Sem websocket mas com
 * polling de pé (`degraded`), o placar atrasa poucos segundos e ninguém percebe —
 * um alerta ali seria alarme falso, e alarme falso treina a plateia a ignorar o
 * próximo. Sem nada chegando (`offline`), o que está na tela é passado.
 *
 * As duas situações de `offline` pedem frases diferentes: quem nunca recebeu um
 * snapshot está olhando uma tela vazia e precisa saber que não é culpa dele; quem
 * recebeu está olhando números que parecem atuais e não são. A segunda é a
 * perigosa.
 */
export function ConnectionBanner({
  health,
  lastSyncedAt,
}: {
  health: ConnectionHealth;
  lastSyncedAt: number | null;
}) {
  const online = useOnline();

  if (health !== 'offline') return null;

  // Aparelho sem rede já tem o OfflineBanner global dizendo isso no topo.
  // Repetir aqui embaixo seria o segundo aviso idêntico na mesma tela, e é
  // assim que a plateia aprende a não ler aviso nenhum.
  if (!online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-20 flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
    >
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {lastSyncedAt === null
          ? 'Sem conexão. Não foi possível carregar o placar.'
          : 'Sem conexão. O placar abaixo está congelado.'}
      </span>
      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
    </div>
  );
}
