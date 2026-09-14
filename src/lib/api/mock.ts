import type {
  DirectRequest,
  Payment,
  Round,
  RoundCandidate,
  ShowPublic,
  ShowState,
} from '@/types/domain';
import { isValidJoinCode } from '@/lib/joinCode';
import {
  ApiError,
  previewVoteWeight,
  type JoinResult,
  type RequestIntentInput,
  type VoteIntentInput,
  type VotePlayApi,
} from './types';

/**
 * Show de demonstração. Trocar por Supabase na Fase 1 (ver plan.md §12).
 * O código precisa respeitar o alfabeto Crockford — sem I, L, O e U.
 */
const DEMO_CODE = 'TESTE1';

if (import.meta.env.DEV && !isValidJoinCode(DEMO_CODE)) {
  throw new Error(
    `Código de demonstração inválido: "${DEMO_CODE}" não pertence ao alfabeto de join codes.`,
  );
}

const uid = () => crypto.randomUUID();
const iso = (d: Date = new Date()) => d.toISOString();

const show: ShowPublic = {
  id: uid(),
  joinCode: DEMO_CODE,
  title: 'Ensaio Aberto',
  venue: 'Bar do Zé',
  city: 'Palmas, TO',
  coverUrl: null,
  status: 'live',
  voteMode: 'paid_weighted',
  voteMinCents: 200,
  voteMaxCents: 20000,
  voteSuggestedCents: [200, 500, 1000],
  centsPerPoint: 100,
  freeVotesPerSession: 0,
  roundDurationSeconds: 300,
  directRequestEnabled: true,
  directRequestPriceCents: 3000,
};

const REPERTOIRE = [
  { title: 'Bohemian Rhapsody', artistName: 'Queen' },
  { title: 'Evidências', artistName: 'Chitãozinho & Xororó' },
  { title: 'Hotel California', artistName: 'Eagles' },
  { title: 'Sozinho', artistName: 'Caetano Veloso' },
];

function makeRound(seq: number): Round {
  const roundId = uid();
  const candidates: RoundCandidate[] = REPERTOIRE.map((song, i) => ({
    id: uid(),
    roundId,
    title: song.title,
    artistName: song.artistName,
    position: i,
    weight: 5 + Math.floor(Math.random() * 25),
    amountCents: 0,
    votesCount: 2 + Math.floor(Math.random() * 6),
  }));
  candidates.forEach((c) => {
    c.amountCents = c.weight * show.centsPerPoint;
  });
  return {
    id: roundId,
    showId: show.id,
    seq,
    label: null,
    status: 'open',
    opensAt: iso(),
    closesAt: iso(new Date(Date.now() + show.roundDurationSeconds * 1000)),
    winnerCandidateId: null,
    totalWeight: candidates.reduce((a, c) => a + c.weight, 0),
    totalAmountCents: candidates.reduce((a, c) => a + c.amountCents, 0),
    totalVotes: candidates.reduce((a, c) => a + c.votesCount, 0),
    candidates,
  };
}

let round: Round = makeRound(1);
let queue: DirectRequest[] = [
  {
    id: uid(),
    showId: show.id,
    title: 'Wonderwall',
    artistName: 'Oasis',
    message: 'Pra Ana, que odeia essa música.',
    requesterName: 'Carlos',
    amountCents: show.directRequestPriceCents,
    status: 'accepted',
    queuePosition: 1,
    createdAt: iso(),
  },
];

const payments = new Map<string, Payment>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Plateia fictícia votando, para a tela não ficar parada na demo. */
setInterval(() => {
  if (round.status !== 'open') return;
  const c = round.candidates[Math.floor(Math.random() * round.candidates.length)];
  const w = 1 + Math.floor(Math.random() * 5);
  c.weight += w;
  c.amountCents += w * show.centsPerPoint;
  c.votesCount += 1;
  round.totalWeight += w;
  round.totalAmountCents += w * show.centsPerPoint;
  round.totalVotes += 1;
  notify();
}, 4000);

/** Fecha a rodada no tempo e abre a próxima, como o cron fará na Fase 2. */
setInterval(() => {
  if (round.status !== 'open' || !round.closesAt) return;
  if (new Date(round.closesAt).getTime() > Date.now()) return;
  const winner = [...round.candidates].sort((a, b) => b.weight - a.weight)[0];
  round.status = 'settled';
  round.winnerCandidateId = winner?.id ?? null;
  notify();
  setTimeout(() => {
    round = makeRound(round.seq + 1);
    notify();
  }, 8000);
}, 1000);

function fakeBrCode(amountCents: number): string {
  return `00020126580014BR.GOV.BCB.PIX0136${uid()}5204000053039865802BR5913VOTE PLAY DEMO6009SAO PAULO62070503***6304${amountCents}`;
}

function createPayment(purpose: Payment['purpose'], amountCents: number): Payment {
  const payment: Payment = {
    id: uid(),
    showId: show.id,
    purpose,
    amountCents,
    status: 'pending',
    brCode: fakeBrCode(amountCents),
    qrPngBase64: null,
    expiresAt: iso(new Date(Date.now() + 5 * 60 * 1000)),
    paidAt: null,
  };
  payments.set(payment.id, payment);
  return payment;
}

function snapshot(): ShowState {
  return {
    round: structuredClone(round),
    queue: structuredClone(queue),
    serverTime: iso(),
  };
}

export const mockApi: VotePlayApi = {
  async join(joinCode) {
    await delay(250);
    if (joinCode.toUpperCase() !== DEMO_CODE) {
      throw new ApiError('Código do show não encontrado.', 'show_not_found');
    }
    const result: JoinResult = {
      show,
      session: { id: uid(), showId: show.id, nickname: null, freeVotesUsed: 0 },
    };
    return result;
  },

  async getShowState() {
    await delay(120);
    return snapshot();
  },

  async createVoteIntent(input: VoteIntentInput) {
    await delay(400);
    if (round.status !== 'open') {
      throw new ApiError('Esta rodada já foi encerrada.', 'round_closed');
    }
    if (
      input.amountCents < show.voteMinCents ||
      input.amountCents > show.voteMaxCents
    ) {
      throw new ApiError('Valor fora do permitido para este show.', 'invalid_amount');
    }
    const payment = createPayment('vote', input.amountCents);
    const weight = previewVoteWeight(
      show.voteMode,
      input.amountCents,
      show.centsPerPoint,
    );

    // Simula o webhook do provedor confirmando o Pix.
    setTimeout(() => {
      const p = payments.get(payment.id);
      if (!p || p.status !== 'pending') return;
      p.status = 'paid';
      p.paidAt = iso();
      const candidate = round.candidates.find((c) => c.id === input.candidateId);
      if (candidate && round.status === 'open') {
        candidate.weight += weight;
        candidate.amountCents += input.amountCents;
        candidate.votesCount += 1;
        round.totalWeight += weight;
        round.totalAmountCents += input.amountCents;
        round.totalVotes += 1;
      }
      notify();
    }, 5000);

    return { payment, voteId: uid() };
  },

  async castFreeVote(input) {
    await delay(200);
    if (show.voteMode === 'paid_weighted') {
      throw new ApiError('Este show não aceita voto grátis.', 'free_votes_exhausted');
    }
    const candidate = round.candidates.find((c) => c.id === input.candidateId);
    if (candidate) {
      candidate.weight += 1;
      candidate.votesCount += 1;
      round.totalWeight += 1;
      round.totalVotes += 1;
      notify();
    }
    return { voteId: uid() };
  },

  async createRequestIntent(input: RequestIntentInput) {
    await delay(400);
    const payment = createPayment('direct_request', show.directRequestPriceCents);
    const request: DirectRequest = {
      id: uid(),
      showId: show.id,
      title: input.title,
      artistName: input.artistName,
      message: input.message ?? null,
      requesterName: input.requesterName ?? null,
      amountCents: show.directRequestPriceCents,
      status: 'pending_payment',
      queuePosition: null,
      createdAt: iso(),
      mine: true,
    };
    queue = [...queue, request];
    notify();

    setTimeout(() => {
      const p = payments.get(payment.id);
      if (!p) return;
      p.status = 'paid';
      p.paidAt = iso();
      queue = queue.map((r) =>
        r.id === request.id
          ? {
              ...r,
              status: 'paid' as const,
              queuePosition: queue.filter((q) => q.status !== 'pending_payment').length + 1,
            }
          : r,
      );
      notify();
    }, 5000);

    return { payment, request };
  },

  async getPaymentStatus(paymentId) {
    await delay(100);
    const p = payments.get(paymentId);
    if (!p) throw new ApiError('Pagamento não encontrado.', 'unknown');
    return { ...p };
  },

  subscribeShow(_showId, _sessionId, onState) {
    const emit = () => onState(snapshot());
    listeners.add(emit);
    emit();
    return () => {
      listeners.delete(emit);
    };
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const MOCK_DEMO_CODE = DEMO_CODE;
