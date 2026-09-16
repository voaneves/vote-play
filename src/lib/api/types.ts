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
      | 'instagram_required'
      | 'invalid_handle'
      | 'rate_limited'
      | 'unknown',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Saúde da conexão com o show, do ponto de vista da plateia.
 *
 * A distinção que importa é entre `degraded` e `offline`: sem websocket mas com
 * polling funcionando, o placar atrasa alguns segundos e ninguém percebe — avisar
 * ali seria alarme falso. Sem nada chegando, a tela está **mentindo**: mostra um
 * placar velho como se fosse o atual, e isso precisa ser dito.
 */
export type ConnectionHealth =
  /** Primeira carga, ou reassinando depois de uma queda. */
  | 'connecting'
  /**
   * O estado está chegando pelo transporte previsto: websocket de pé (telão)
   * ou consultas respondendo (plateia, que só usa polling).
   */
  | 'live'
  /** Telão sem websocket, com o polling de reserva trazendo estado. Atraso de segundos. */
  | 'degraded'
  /** Nada chega. O que está na tela é passado. */
  | 'offline';

/**
 * Como o estado chega.
 *
 *   poll     — a plateia. Consulta com intervalo adaptativo e versão. O plano
 *              Free do Supabase tem 200 conexões de Realtime para o projeto
 *              INTEIRO e 100 mensagens/s; um show cheio não cabe nisso.
 *   realtime — o telão (uma tela por show). Websocket filtrado pelo show, com
 *              polling de reserva.
 */
export type ShowTransport = 'poll' | 'realtime';

/** Resposta curta de `getShowState` quando a versão enviada ainda vale. */
export interface ShowStateUnchanged {
  unchanged: true;
  serverTime: string;
  version: string;
}

export interface ShowObserver {
  onState: (state: ShowState) => void;
  /** Chamado só quando o estado muda de verdade — nunca repete o mesmo valor. */
  onHealth?: (health: ConnectionHealth) => void;
}

export interface ShowSubscription {
  unsubscribe: () => void;
  refresh: () => void;
}

export function isUnchanged(
  value: ShowState | ShowStateUnchanged,
): value is ShowStateUnchanged {
  return (value as ShowStateUnchanged).unchanged === true;
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
 * A implementação `mock` roda tudo em memória; a `supabase` fala com o banco.
 * Nenhum componente deve falar com Supabase diretamente.
 */
export interface VotePlayApi {
  join(joinCode: string): Promise<JoinResult>;
  /**
   * Snapshot do show. Com `knownVersion` igual à atual, o servidor devolve só
   * `ShowStateUnchanged` — poucos bytes em vez do placar inteiro.
   */
  getShowState(
    showId: string,
    sessionId: string,
    knownVersion?: string | null,
  ): Promise<ShowState | ShowStateUnchanged>;

  /** Cria voto pendente + cobrança Pix. O peso é decidido no servidor. */
  createVoteIntent(input: VoteIntentInput): Promise<{ payment: Payment; voteId: string }>;
  /**
   * Voto sem pagamento (modos instagram e free). O limite por rodada é decidido no banco,
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

  /** Registra o @ declarado pela pessoa (portão do modo instagram). */
  setSessionInstagram(sessionId: string, handle: string): Promise<{ instagramHandle: string }>;

  /**
   * Marca que a pessoa tocou no botão que leva ao perfil do artista.
   *
   * Idempotente — o primeiro toque é o que conta. Não é prova de que seguiu, e
   * nada aqui afirma isso: é o topo do funil do painel e a condição que libera
   * o voto na tela.
   */
  markInstagramFollowClick(sessionId: string): Promise<{ followClickedAt: string }>;

  /**
   * Assina o estado do show. Retorna o cancelamento e um `refresh` para pedir
   * uma leitura imediata — depois do próprio voto, por exemplo, em vez de
   * esperar o próximo ciclo.
   */
  subscribeShow(
    showId: string,
    sessionId: string,
    observer: ShowObserver,
    options?: { transport?: ShowTransport },
  ): ShowSubscription;
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
  if (mode !== 'pix') return 1;
  if (amountCents <= 0) return 1;
  return Math.max(1, Math.floor(amountCents / Math.max(1, centsPerPoint)));
}

/** Tira o @, espaços e URL colada. Espelha normalize_instagram_handle do banco. */
export function normalizeInstagramHandle(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/[/?].*$/, '')
    .replace(/^@+/, '')
    .trim();
}

export function isValidInstagramHandle(input: string): boolean {
  return /^[a-z0-9_](\.?[a-z0-9_]){0,29}$/.test(normalizeInstagramHandle(input));
}
