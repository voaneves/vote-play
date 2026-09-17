import type { ShowStatus } from '@/types/domain';

/** Status do show em português — o enum do banco nunca aparece cru na tela. */
export const SHOW_STATUS_LABEL: Record<ShowStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  live: 'No ar',
  paused: 'Pausado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};
