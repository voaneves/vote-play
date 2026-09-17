/**
 * Tipos de domínio do Vote Play.
 * Espelham o schema descrito no plan.md (seção 5). Dinheiro SEMPRE em centavos (inteiro).
 */

export type ShowStatus = 'draft' | 'ready' | 'live' | 'paused' | 'ended' | 'cancelled';
/**
 * Como o show deixa a plateia votar.
 *   pix       — todo voto passa por pagamento
 *   instagram — voto grátis, atrás do portão do perfil
 *   free      — voto grátis sem portão
 */
export type VoteMode = 'pix' | 'instagram' | 'free';
/**
 * Ciclo da rodada. `closing` é o estado que separa o fim da VOTAÇÃO do fim da
 * APURAÇÃO: o cronômetro zerou e ninguém vota mais, mas os Pix já emitidos
 * ainda podem chegar dentro da carência.
 *
 * Dizia `closed` aqui até 15/09 — nome que o enum do Postgres nunca teve, então
 * o tipo descrevia um estado que jamais chegaria pela rede.
 */
export type RoundStatus = 'draft' | 'open' | 'closing' | 'settled' | 'cancelled';
export type VoteStatus = 'pending' | 'confirmed' | 'expired' | 'refunded' | 'voided';
export type RequestStatus =
  | 'pending_payment'
  | 'paid'
  | 'accepted'
  | 'declined'
  | 'played'
  | 'refunded';
export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'refunded';
export type PaymentPurpose = 'vote' | 'direct_request' | 'tip';

/** Dados do show visíveis para a plateia (subconjunto público da tabela `shows`). */
export interface ShowPublic {
  id: string;
  joinCode: string;
  title: string;
  venue: string | null;
  city: string | null;
  coverUrl: string | null;
  status: ShowStatus;

  voteMode: VoteMode;
  /** Perfil que a plateia é convidada a seguir. Só existe no modo instagram. */
  instagramHandle: string | null;
  voteMinCents: number;
  voteMaxCents: number;
  voteSuggestedCents: number[];
  centsPerPoint: number;
  freeVotesPerRound: number;
  roundDurationSeconds: number;

  directRequestEnabled: boolean;
  directRequestPriceCents: number;

  /** Fila do repertório ligada. No modo pix ela só abre na Fase 7 (apoio pago). */
  queueEnabled: boolean;
  /** Quantos apoios cada pessoa tem ao mesmo tempo. */
  queueVotesPerSession: number;
}

export interface RoundCandidate {
  id: string;
  roundId: string;
  title: string;
  artistName: string;
  position: number;
  weight: number;
  amountCents: number;
  votesCount: number;
}

export interface Round {
  id: string;
  showId: string;
  seq: number;
  label: string | null;
  status: RoundStatus;
  /** Em quem ESTA sessão votou nesta rodada, se votou. */
  myVoteCandidateId: string | null;
  /** Votos sem pagamento que ainda restam a esta sessão nesta rodada. */
  freeVotesLeft: number;
  opensAt: string | null;
  /** Fonte da verdade do cronômetro. O cliente calcula closesAt - serverTime. */
  closesAt: string | null;
  winnerCandidateId: string | null;
  totalWeight: number;
  totalAmountCents: number;
  totalVotes: number;
  candidates: RoundCandidate[];
}

export interface DirectRequest {
  id: string;
  showId: string;
  title: string;
  artistName: string;
  message: string | null;
  requesterName: string | null;
  amountCents: number;
  status: RequestStatus;
  queuePosition: number | null;
  createdAt: string;
  /** true quando o pedido pertence à sessão atual — libera detalhes extras na UI. */
  mine?: boolean;
}

export interface Payment {
  id: string;
  showId: string;
  purpose: PaymentPurpose;
  amountCents: number;
  status: PaymentStatus;
  /** Payload Pix copia-e-cola (BR Code). */
  brCode: string | null;
  qrPngBase64: string | null;
  expiresAt: string | null;
  paidAt: string | null;
}

export interface AudienceSession {
  id: string;
  showId: string;
  nickname: string | null;
  freeVotesUsed: number;
  /**
   * O @ que a pessoa declarou.
   *
   * Declaração, não verificação: nenhuma API do Instagram informa se alguém
   * segue um perfil (a Basic Display foi desligada em set/2025). O valor deste
   * campo é o registro para o artista, não uma trava.
   */
  instagramHandle: string | null;
  /**
   * Quando esta sessão tocou no botão que leva ao perfil do artista.
   *
   * É o que destrava o voto na interface — e o topo do funil que o painel
   * mostra. Volta do servidor para que recarregar a página não obrigue a
   * pessoa a repetir o passo: ela já foi ao Instagram uma vez.
   */
  followClickedAt: string | null;
}

/**
 * Onde a música está, do ponto de vista da fila.
 *   available — pode receber apoio
 *   candidate — está na rodada aberta agora (vota-se nela lá)
 *   queued    — venceu uma rodada: é a próxima a tocar
 * Tocadas e escondidas não aparecem.
 */
export type RepertoireSongStatus = 'available' | 'candidate' | 'queued';

export interface RepertoireSong {
  /** id em `show_songs` */
  id: string;
  title: string;
  artistName: string;
  /** Soma dos apoios. */
  weight: number;
  status: RepertoireSongStatus;
  /** Fixada no topo pelo artista. */
  pinned: boolean;
  /** Esta sessão apoia a música. */
  mine: boolean;
  /** 1 = a próxima da fila. */
  rank: number;
}

/**
 * A fila do repertório, já em ordem de ranking.
 *
 * Chega por consulta própria, separada do placar da rodada, e só para quem
 * está olhando: o repertório inteiro a cada 4 s não caberia no egress do
 * plano Free (plan.md, 8 e 5.1).
 */
export interface RepertoireState {
  enabled: boolean;
  showStatus: ShowStatus;
  supportsPerSession: number;
  supportsLeft: number;
  songs: RepertoireSong[];
  serverTime: string;
  version: string;
}

/**
 * O que muda enquanto o show acontece.
 *
 * Não inclui o `ShowPublic`: ele chega no `join`, é estável durante o show e já
 * fica no contexto. Repetir a configuração inteira a cada atualização de placar
 * seria desperdício no wi-fi da plateia.
 */
export interface ShowState {
  /**
   * Status do show neste instante. Chega no snapshot, e não só no `join`,
   * porque é o que muda durante a noite: pausa, e sobretudo o fim — sem ele a
   * plateia de um show encerrado via "sem conexão" em vez de "o show terminou".
   */
  showStatus: ShowStatus;
  round: Round | null;
  queue: DirectRequest[];
  /** ISO do relógio do servidor, usado para corrigir drift do cronômetro. */
  serverTime: string;
  /**
   * Hash do snapshot. O cliente devolve na próxima consulta e, se nada mudou,
   * o servidor responde só `{ unchanged: true }` — o que mantém o polling da
   * plateia dentro do egress do plano Free.
   */
  version: string;
}
