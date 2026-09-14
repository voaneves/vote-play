import type {
  AudienceSession,
  DirectRequest,
  Payment,
  ShowPublic,
  ShowState,
  VoteMode,
} from '@/types/domain';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'show_not_found'
      | 'show_not_live'
      | 'round_closed'
      | 'invalid_amount'
      | 'free_votes_exhausted'
      | 'already_voted'
      | 'rate_limited'
      | 'unknown',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface JoinResult {
  show: ShowPublic;
  session: AudienceSession;
}

export interface VoteIntentInput {
  showId: string;
  roundId: string;
  candidateId: string;
  sessionId: string;
  amountCents: number;
}

export interface RequestIntentInput {
  showId: string;
  sessionId: string;
  title: string;
  artistName: string;
  message?: string;
  requesterName?: string;
}

/**
 * Contrato único entre a UI e o backend.
 * A implementação `mock` roda tudo em memória; a `supabase` chega na Fase 1/4.
 * Nenhum componente deve falar com Supabase diretamente.
 */
export interface VotePlayApi {
  join(joinCode: string): Promise<JoinResult>;
  getShowState(showId: string, sessionId: string): Promise<ShowState>;

  /** Cria voto pendente + cobrança Pix. O peso é decidido no servidor. */
  createVoteIntent(input: VoteIntentInput): Promise<{ payment: Payment; voteId: string }>;
  /**
   * Voto sem pagamento (modos free_*). O limite por rodada é decidido no banco,
   * não aqui — o cliente só reflete o que o snapshot disser.
   */
  castFreeVote(
    input: Omit<VoteIntentInput, 'amountCents'>,
  ): Promise<{ voteId: string }>;

  createRequestIntent(
    input: RequestIntentInput,
  ): Promise<{ payment: Payment; request: DirectRequest }>;

  /** Polling de fallback enquanto o QR está na tela (o webhook é o caminho rápido). */
  getPaymentStatus(paymentId: string): Promise<Payment>;

  /** Assina o estado do show. Retorna a função de cancelamento. */
  subscribeShow(
    showId: string,
    sessionId: string,
    onState: (state: ShowState) => void,
  ): () => void;
}

/**
 * Regra de peso do voto. Espelha `compute_vote_weight` do Postgres —
 * aqui serve APENAS para prever a UI. O servidor recalcula e tem a palavra final.
 */
export function previewVoteWeight(
  mode: VoteMode,
  amountCents: number,
  centsPerPoint: number,
): number {
  if (mode === 'free_with_tip') return 1;
  if (amountCents <= 0) return 1;
  return Math.max(1, Math.floor(amountCents / Math.max(1, centsPerPoint)));
}
