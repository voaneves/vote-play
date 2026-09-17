import { cn } from '@/lib/utils';

/**
 * O símbolo do Vote Play: três barras subindo — o placar do show em miniatura.
 * Mesmo desenho do `public/favicon.svg` e do `brand/logo/simbolo.svg`, para a
 * marca que aparece na aba ser a mesma que aparece na tela.
 */
export function VotePlayLogo({
  className,
  title,
}: {
  className?: string;
  /** Sem título, o símbolo é decorativo e some para o leitor de tela. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('text-primary', className)}
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect x="0" y="24" width="9" height="16" rx="4.5" />
      <rect x="15.5" y="12" width="9" height="28" rx="4.5" />
      <rect x="31" y="0" width="9" height="40" rx="4.5" />
    </svg>
  );
}
