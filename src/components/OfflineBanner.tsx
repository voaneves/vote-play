import { WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';

/**
 * Aviso de aparelho sem internet, válido em qualquer tela.
 *
 * Complementa o `ConnectionBanner` da tela do show em vez de repetir:
 *
 *   este aqui  → "o seu aparelho está sem rede" (o navegador afirma)
 *   aquele     → "o placar na sua frente está congelado" (o dado não chegou)
 *
 * Quando o aparelho cai de vez, os dois seriam verdade ao mesmo tempo — e dois
 * avisos dizendo a mesma coisa em cima um do outro é como se ensina alguém a
 * ignorar aviso. Por isso o `ConnectionBanner` se cala enquanto este está no ar.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-sm font-medium text-destructive-foreground"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>Seu aparelho está sem internet.</span>
    </div>
  );
}
