import type {
  DirectRequest,
  Payment,
  RepertoireSong,
  RepertoireState,
  Round,
  RoundCandidate,
  ShowPublic,
  ShowState,
  VoteMode,
} from '@/types/domain';
import { isValidJoinCode } from '@/lib/joinCode';
import {
  ApiError,
  isValidInstagramHandle,
  normalizeInstagramHandle,
  previewVoteWeight,
  type JoinResult,
  type RequestIntentInput,
  type ShowSubscription,
  type VoteIntentInput,
  type VotePlayApi,
} from './types';

/**
 * Provider em memória para desenvolvimento.
 *
 * Três shows de demonstração, um por modo de votação, para o fluxo inteiro ser
 * verificável sem backend:
 *   PAGAR1 — pix, todo voto passa pelo Pix
 *   GRAM99 — instagram, voto grátis atrás do portão do perfil
 *   FREE01 — free, um voto grátis por rodada
 *
 * São os MESMOS códigos que `supabase/seed.sql` cria no banco: trocar de
 * provider não deve obrigar ninguém a trocar o que digita na tela de entrada.
 *
 * Os códigos respeitam o alfabeto Crockford (sem I, L, O, U) — há uma asserção
 * em desenvolvimento porque errar isso já custou caro mais de uma vez.
 */

const uid = () => crypto.randomUUID();
const iso = (d: Date = new Date()) => d.toISOString();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REPERTOIRE = [
  { title: 'Bohemian Rhapsody', artistName: 'Queen' },
  { title: 'Evidências', artistName: 'Chitãozinho & Xororó' },
  { title: 'Hotel California', artistName: 'Eagles' },
  { title: 'Sozinho', artistName: 'Caetano Veloso' },
];

/** O resto do repertório: fora da rodada, disponível para a fila. */
const EXTRA_REPERTOIRE = [
  { title: 'Wonderwall', artistName: 'Oasis' },
  { title: 'Tempo Perdido', artistName: 'Legião Urbana' },
  { title: 'Garota de Ipanema', artistName: 'Tom Jobim' },
  { title: 'Aquarela', artistName: 'Toquinho' },
  { title: 'Sweet Child O\' Mine', artistName: "Guns N' Roses" },
  { title: 'Anna Júlia', artistName: 'Los Hermanos' },
];

interface MockSong {
  id: string;
  title: string;
  artistName: string;
  weight: number;
  pinned: boolean;
  firstAt: number;
}

interface MockShow {
  show: ShowPublic;
  round: Round;
  queue: DirectRequest[];
  /** sessionId → id da candidata em que votou nesta rodada */
  votes: Map<string, string>;
  /** sessionId → @ declarado */
  handles: Map<string, string>;
  /** sessão → quando tocou em "Seguir". Espelha instagram_follow_clicked_at. */
  clicks: Map<string, string>;
  listeners: Set<() => void>;
  /** fila do repertório */
  songs: MockSong[];
  /** sessionId → ids das músicas que apoia */
  supports: Map<string, Set<string>>;
  repListeners: Set<() => void>;
}

function makeShow(
  joinCode: string,
  title: string,
  mode: VoteMode,
  instagramHandle: string | null = null,
): ShowPublic {
  return {
    id: uid(),
    joinCode,
    title,
    venue: 'Bar do Zé',
    city: 'Palmas, TO',
    coverUrl: null,
    status: 'live',
    voteMode: mode,
    instagramHandle,
    voteMinCents: 200,
    voteMaxCents: 20000,
    voteSuggestedCents: [200, 500, 1000],
    centsPerPoint: 100,
    freeVotesPerRound: mode === 'pix' ? 0 : 1,
    roundDurationSeconds: 300,
    directRequestEnabled: true,
    directRequestPriceCents: 3000,
    queueEnabled: true,
    queueVotesPerSession: 3,
  };
}

function makeRound(show: ShowPublic, seq: number): Round {
  const roundId = uid();
  const candidates: RoundCandidate[] = REPERTOIRE.map((song, i) => {
    const weight = 5 + Math.floor(Math.random() * 25);
    return {
      id: uid(),
      roundId,
      title: song.title,
      artistName: song.artistName,
      position: i,
      weight,
      amountCents: show.voteMode === 'pix' ? weight * show.centsPerPoint : 0,
      votesCount: 2 + Math.floor(Math.random() * 6),
    };
  });
  return {
    id: roundId,
    showId: show.id,
    seq,
    label: null,
    status: 'open',
    myVoteCandidateId: null,
    freeVotesLeft: show.freeVotesPerRound,
    opensAt: iso(),
    closesAt: iso(new Date(Date.now() + show.roundDurationSeconds * 1000)),
    winnerCandidateId: null,
    totalWeight: candidates.reduce((a, c) => a + c.weight, 0),
    totalAmountCents: candidates.reduce((a, c) => a + c.amountCents, 0),
    totalVotes: candidates.reduce((a, c) => a + c.votesCount, 0),
    candidates,
  };
}

function createMockShow(
  joinCode: string,
  title: string,
  mode: VoteMode,
  instagramHandle: string | null = null,
): MockShow {
  const show = makeShow(joinCode, title, mode, instagramHandle);
  return {
    show,
    round: makeRound(show, 1),
    queue: [],
    votes: new Map(),
    listeners: new Set(),
    handles: new Map(),
    clicks: new Map(),
    songs: [...REPERTOIRE, ...EXTRA_REPERTOIRE].map((song, i) => ({
      id: uid(),
      ...song,
      weight: i < REPERTOIRE.length ? 0 : Math.floor(Math.random() * 12),
      pinned: false,
      firstAt: Date.now() - i * 1000,
    })),
    supports: new Map(),
    repListeners: new Set(),
  };
}

const SHOWS: Record<string, MockShow> = {
  PAGAR1: createMockShow('PAGAR1', 'Ensaio Aberto', 'pix'),
  FREE01: createMockShow('FREE01', 'Sarau da Casa', 'free'),
  GRAM99: createMockShow('GRAM99', 'Quinta Acústica', 'instagram', 'banda.oficial'),
};

if (import.meta.env.DEV) {
  for (const code of Object.keys(SHOWS)) {
    if (!isValidJoinCode(code)) {
      throw new Error(
        `Código de demonstração inválido: "${code}" não pertence ao alfabeto de join codes.`,
      );
    }
  }
}

SHOWS.PAGAR1.queue.push({
  id: uid(),
  showId: SHOWS.PAGAR1.show.id,
  title: 'Wonderwall',
  artistName: 'Oasis',
  message: 'Pra Ana, que odeia essa música.',
  requesterName: 'Carlos',
  amountCents: 0,
  status: 'accepted',
  queuePosition: 1,
  createdAt: iso(),
});

const byId = (showId: string) => Object.values(SHOWS).find((s) => s.show.id === showId);

/**
 * Uma sessão por aparelho por show, como o `device_hash` faz no banco — e o @
 * declarado sobrevive ao recarregar a página, como sobrevive no Postgres.
 *
 * Sem isso o mock seria mais frouxo que a realidade, e o portão pareceria
 * quebrado num teste que na verdade estava testando o mock errado.
 */
const deviceSessions = new Map<string, string>();
const sessionKey = (code: string) => `vp:mock:session:${code}`;
const handleKey = (code: string) => `vp:mock:handle:${code}`;
const clickKey = (code: string) => `vp:mock:click:${code}`;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modo privado: a sessão vira efêmera, como no navegador do banco */
  }
}

function sessionForDevice(s: MockShow): string {
  const cached = deviceSessions.get(s.show.joinCode);
  if (cached) return cached;

  const stored = readLocal(sessionKey(s.show.joinCode));
  const id = stored ?? uid();
  if (!stored) writeLocal(sessionKey(s.show.joinCode), id);
  deviceSessions.set(s.show.joinCode, id);

  const storedHandle = readLocal(handleKey(s.show.joinCode));
  if (storedHandle) s.handles.set(id, storedHandle);

  // O toque também sobrevive ao reload, como no provider real — senão o mock
  // mostraria um portão mais chato que o de produção.
  const storedClick = readLocal(clickKey(s.show.joinCode));
  if (storedClick) s.clicks.set(id, storedClick);

  return id;
}

const byIdHasSession = (s: MockShow, sessionId: string) =>
  deviceSessions.get(s.show.joinCode) === sessionId;
const notify = (s: MockShow) => s.listeners.forEach((fn) => fn());

function addWeight(s: MockShow, candidateId: string, weight: number, cents: number) {
  const candidate = s.round.candidates.find((c) => c.id === candidateId);
  if (!candidate || s.round.status !== 'open') return;
  candidate.weight += weight;
  candidate.amountCents += cents;
  candidate.votesCount += 1;
  s.round.totalWeight += weight;
  s.round.totalAmountCents += cents;
  s.round.totalVotes += 1;
}

/** Plateia fictícia, para a tela não ficar parada na demonstração. */
setInterval(() => {
  for (const s of Object.values(SHOWS)) {
    if (s.round.status !== 'open') continue;
    const c = s.round.candidates[Math.floor(Math.random() * s.round.candidates.length)];
    const w = s.show.voteMode === 'pix' ? 1 + Math.floor(Math.random() * 5) : 1;
    addWeight(s, c.id, w, s.show.voteMode === 'pix' ? w * s.show.centsPerPoint : 0);
    notify(s);
  }
}, 4000);

/** Plateia fictícia apoiando a fila, mais devagar que a rodada. */
setInterval(() => {
  for (const s of Object.values(SHOWS)) {
    if (s.repListeners.size === 0 || s.show.voteMode === 'pix') continue;
    const pool = s.songs.filter((m) => songStatus(s, m) === 'available');
    const m = pool[Math.floor(Math.random() * pool.length)];
    if (!m) continue;
    m.weight += 1;
    notifyRepertoire(s);
  }
}, 7000);

function songStatus(s: MockShow, m: MockSong): RepertoireSong['status'] {
  const inRound =
    s.round.status === 'open' && s.round.candidates.some((c) => c.title === m.title);
  return inRound ? 'candidate' : 'available';
}

function notifyRepertoire(s: MockShow) {
  for (const fn of s.repListeners) fn();
}

/** Mesmo desempate do banco: escolhida, fixada, peso, primeiro apoio, ordem. */
function repertoireSnapshot(s: MockShow, sessionId: string): RepertoireState {
  const mine = s.supports.get(sessionId) ?? new Set<string>();
  const statusRank = (st: RepertoireSong['status']) => (st === 'queued' ? 1 : 0);
  const songs = s.songs
    .map((m, idx) => ({ m, idx, status: songStatus(s, m) }))
    .sort(
      (a, b) =>
        statusRank(b.status) - statusRank(a.status) ||
        Number(b.m.pinned) - Number(a.m.pinned) ||
        b.m.weight - a.m.weight ||
        a.m.firstAt - b.m.firstAt ||
        a.idx - b.idx,
    )
    .map(({ m, status }, i) => ({
      id: m.id,
      title: m.title,
      artistName: m.artistName,
      weight: m.weight,
      status,
      pinned: m.pinned,
      mine: mine.has(m.id),
      rank: i + 1,
    }));
  return {
    enabled: s.show.queueEnabled,
    showStatus: s.show.status,
    supportsPerSession: s.show.queueVotesPerSession,
    supportsLeft: Math.max(0, s.show.queueVotesPerSession - mine.size),
    songs,
    serverTime: iso(),
    version: songs.map((x) => `${x.id}:${x.weight}:${x.mine}`).join('|'),
  };
}

/** Fecha a rodada no tempo e abre a próxima, como tick_rounds() faz no banco. */
setInterval(() => {
  for (const s of Object.values(SHOWS)) {
    if (s.round.status !== 'open' || !s.round.closesAt) continue;
    if (new Date(s.round.closesAt).getTime() > Date.now()) continue;
    const winner = [...s.round.candidates].sort((a, b) => b.weight - a.weight)[0];
    s.round.status = 'settled';
    s.round.winnerCandidateId = winner?.id ?? null;
    notify(s);
    setTimeout(() => {
      s.round = makeRound(s.show, s.round.seq + 1);
      s.votes.clear();
      notify(s);
    }, 8000);
  }
}, 1000);

const payments = new Map<string, Payment>();

function fakeBrCode(amountCents: number): string {
  return `00020126580014BR.GOV.BCB.PIX0136${uid()}5204000053039865802BR5913VOTE PLAY DEMO6009SAO PAULO62070503***6304${amountCents}`;
}

function createPayment(s: MockShow, purpose: Payment['purpose'], amountCents: number): Payment {
  const payment: Payment = {
    id: uid(),
    showId: s.show.id,
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

/** Versão barata do snapshot: muda quando algo visível muda, como no banco. */
function versionOf(s: MockShow, voted: string | null): string {
  const r = s.round;
  return [r.id, r.status, r.totalVotes, r.totalWeight, r.winnerCandidateId, voted, s.queue.length].join('|');
}

function snapshot(s: MockShow, sessionId: string | null): ShowState {
  const voted = sessionId ? (s.votes.get(sessionId) ?? null) : null;
  const round = structuredClone(s.round);
  // ordem estável, a do artista — igual ao banco (ver …180000)
  round.candidates.sort((a, b) => a.position - b.position);
  return {
    showStatus: s.show.status,
    round: {
      ...round,
      myVoteCandidateId: voted,
      freeVotesLeft: voted ? 0 : s.show.freeVotesPerRound,
    },
    queue: structuredClone(s.queue),
    serverTime: iso(),
    version: versionOf(s, voted),
  };
}

export const mockApi: VotePlayApi = {
  async join(joinCode) {
    await delay(250);
    const s = SHOWS[joinCode.toUpperCase()];
    if (!s) throw new ApiError('Código do show não encontrado.', 'show_not_found');
    // o mock guarda o @ por aparelho, como o banco faz por device_hash
    const sessionId = sessionForDevice(s);
    const result: JoinResult = {
      show: s.show,
      session: {
        id: sessionId,
        showId: s.show.id,
        nickname: null,
        freeVotesUsed: 0,
        instagramHandle: s.handles.get(sessionId) ?? null,
        followClickedAt: s.clicks.get(sessionId) ?? null,
      },
    };
    return result;
  },

  async getShowState(showId, sessionId, knownVersion) {
    await delay(120);
    const s = byId(showId);
    if (!s) throw new ApiError('Show indisponível.', 'show_not_found');
    const snap = snapshot(s, sessionId);
    if (knownVersion && knownVersion === snap.version) {
      return { unchanged: true, serverTime: snap.serverTime, version: snap.version };
    }
    return snap;
  },

  async createVoteIntent(input: VoteIntentInput) {
    await delay(400);
    const s = byId(input.showId);
    if (!s) throw new ApiError('Show indisponível.', 'show_not_found');
    if (s.round.status !== 'open') {
      throw new ApiError('Esta rodada já foi encerrada.', 'round_closed');
    }
    if (input.amountCents < s.show.voteMinCents || input.amountCents > s.show.voteMaxCents) {
      throw new ApiError('Valor fora do permitido para este show.', 'invalid_amount');
    }
    const payment = createPayment(s, 'vote', input.amountCents);
    const weight = previewVoteWeight(s.show.voteMode, input.amountCents, s.show.centsPerPoint);

    // simula o webhook do provedor confirmando o Pix
    setTimeout(() => {
      const p = payments.get(payment.id);
      if (!p || p.status !== 'pending') return;
      p.status = 'paid';
      p.paidAt = iso();
      addWeight(s, input.candidateId, weight, input.amountCents);
      s.votes.set(input.sessionId, input.candidateId);
      notify(s);
    }, 5000);

    return { payment, voteId: uid() };
  },

  async castFreeVote(input) {
    await delay(200);
    const s = byId(input.showId);
    if (!s) throw new ApiError('Show indisponível.', 'show_not_found');
    if (s.show.voteMode === 'pix') {
      throw new ApiError('Neste show todo voto passa pelo Pix.', 'free_votes_exhausted');
    }
    if (s.show.voteMode === 'instagram' && !s.handles.has(input.sessionId)) {
      throw new ApiError('Informe seu @ do Instagram para votar.', 'instagram_required');
    }
    if (s.round.status !== 'open') {
      throw new ApiError('Esta rodada já foi encerrada.', 'round_closed');
    }
    if (s.votes.has(input.sessionId)) {
      throw new ApiError('Você já votou nesta rodada.', 'already_voted');
    }
    addWeight(s, input.candidateId, 1, 0);
    s.votes.set(input.sessionId, input.candidateId);
    notify(s);
    return { voteId: uid() };
  },

  async createRequestIntent(input: RequestIntentInput) {
    await delay(400);
    const s = byId(input.showId);
    if (!s) throw new ApiError('Show indisponível.', 'show_not_found');
    const payment = createPayment(s, 'direct_request', s.show.directRequestPriceCents);
    const request: DirectRequest = {
      id: uid(),
      showId: s.show.id,
      title: input.title,
      artistName: input.artistName,
      message: input.message ?? null,
      requesterName: input.requesterName ?? null,
      amountCents: 0,
      status: 'pending_payment',
      queuePosition: null,
      createdAt: iso(),
      mine: true,
    };
    s.queue.push(request);
    notify(s);

    setTimeout(() => {
      const p = payments.get(payment.id);
      if (!p) return;
      p.status = 'paid';
      p.paidAt = iso();
      const target = s.queue.find((r) => r.id === request.id);
      if (target) {
        target.status = 'paid';
        target.queuePosition =
          s.queue.filter((q) => q.status !== 'pending_payment').length + 1;
      }
      notify(s);
    }, 5000);

    return { payment, request };
  },

  async markInstagramFollowClick(sessionId) {
    await delay(120);
    for (const s of Object.values(SHOWS)) {
      if (s.handles.has(sessionId) || byIdHasSession(s, sessionId)) {
        const at = s.clicks.get(sessionId) ?? new Date().toISOString();
        s.clicks.set(sessionId, at);
        writeLocal(clickKey(s.show.joinCode), at);
        return { followClickedAt: at };
      }
    }
    return { followClickedAt: new Date().toISOString() };
  },

  async setSessionInstagram(sessionId, handle) {
    await delay(200);
    const normalized = normalizeInstagramHandle(handle);
    if (!isValidInstagramHandle(handle)) {
      throw new ApiError('Esse @ não parece um perfil do Instagram.', 'invalid_handle');
    }
    for (const s of Object.values(SHOWS)) {
      if (s.handles.has(sessionId) || byIdHasSession(s, sessionId)) {
        s.handles.set(sessionId, normalized);
        writeLocal(handleKey(s.show.joinCode), normalized);
        notify(s);
        break;
      }
    }
    return { instagramHandle: normalized };
  },

  async getPaymentStatus(paymentId) {
    await delay(100);
    const p = payments.get(paymentId);
    if (!p) throw new ApiError('Pagamento não encontrado.', 'unknown');
    return { ...p };
  },

  async setSongSupport(input) {
    await delay(150);
    const s = byId(input.showId);
    if (!s) throw new ApiError('Show indisponível.', 'show_not_found');
    if (s.show.voteMode === 'pix') {
      throw new ApiError('Neste show o apoio passa pelo Pix.', 'queue_closed');
    }
    if (s.show.voteMode === 'instagram' && !s.handles.has(input.sessionId)) {
      throw new ApiError('Informe seu @ do Instagram para votar.', 'instagram_required');
    }
    const song = s.songs.find((m) => m.id === input.showSongId);
    if (!song) throw new ApiError('Essa música não está na fila.', 'song_unavailable');
    const mine = s.supports.get(input.sessionId) ?? new Set<string>();
    s.supports.set(input.sessionId, mine);

    if (input.support && !mine.has(song.id)) {
      if (songStatus(s, song) !== 'available') {
        throw new ApiError('Essa música não está aberta para apoio agora.', 'song_unavailable');
      }
      if (mine.size >= s.show.queueVotesPerSession) {
        throw new ApiError('Seus apoios acabaram. Tire um apoio para dar a outra música.', 'no_supports_left');
      }
      mine.add(song.id);
      song.weight += 1;
    } else if (!input.support && mine.has(song.id)) {
      mine.delete(song.id);
      song.weight = Math.max(0, song.weight - 1);
    }
    notifyRepertoire(s);
    return {
      supported: input.support,
      supportsLeft: Math.max(0, s.show.queueVotesPerSession - mine.size),
    };
  },

  subscribeRepertoire(showId, sessionId, observer): ShowSubscription {
    const s = byId(showId);
    if (!s) {
      observer.onHealth?.('offline');
      return { unsubscribe: () => {}, refresh: () => {} };
    }
    const emit = () => observer.onState(repertoireSnapshot(s, sessionId));
    s.repListeners.add(emit);
    // a rodada muda o status das candidatas: a fila acompanha
    s.listeners.add(emit);
    emit();
    observer.onHealth?.('live');
    return {
      unsubscribe: () => {
        s.repListeners.delete(emit);
        s.listeners.delete(emit);
      },
      refresh: emit,
    };
  },

  subscribeShow(showId, sessionId, observer) {
    const s = byId(showId);
    if (!s) {
      observer.onHealth?.('offline');
      return { unsubscribe: () => {}, refresh: () => {} };
    }
    // Em memória não há transporte a escolher: o mock empurra a cada mudança,
    // qualquer que seja o `transport` pedido.
    const emit = () => observer.onState(snapshot(s, sessionId));
    s.listeners.add(emit);
    emit();
    // Em memória não existe rede para cair: o mock é sempre 'live'. Reportar
    // mesmo assim mantém os dois providers com o mesmo contrato — a UI nunca
    // precisa saber qual está por baixo.
    observer.onHealth?.('live');
    return {
      unsubscribe: () => {
        s.listeners.delete(emit);
      },
      refresh: emit,
    };
  },
};
