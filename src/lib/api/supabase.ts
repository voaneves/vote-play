import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { getDeviceHash } from '@/lib/deviceHash';
import type {
  RepertoireSong,
  RepertoireSongStatus,
  RepertoireState,
  ShowState,
  ShowStatus,
} from '@/types/domain';
import {
  ApiError,
  isUnchanged,
  type ConnectionHealth,
  type JoinResult,
  type RequestIntentInput,
  type ShowSubscription,
  type ShowStateUnchanged,
  type VoteIntentInput,
  type VotePlayApi,
} from './types';

/**
 * Implementação sobre o Supabase.
 *
 * A plateia nunca toca nas tabelas: fala apenas com RPCs de contrato estreito
 * (`join_show`, `get_show_state`, `cast_free_vote`, `set_session_instagram`,
 * `mark_instagram_follow_click`), que rodam SECURITY DEFINER e devolvem
 * exatamente o formato do domínio — por isso quase não há conversão aqui.
 * Ver supabase/migrations/…_public_api.sql.
 *
 * O Pix é Fase 7: os três métodos de pagamento abaixo falham de propósito, em
 * voz alta, em vez de fingir sucesso.
 */

// ---------------------------------------------------------------------------
// Orçamento de consultas — plano Free do Supabase (ver plan.md, "Requisitos
// do sistema"). Os números existem para caber nele, não por gosto:
//
//   300 celulares ÷ 4 s ≈ 75 consultas/s durante a rodada aberta. Quase todas
//   voltam "nada mudou" em poucos bytes. Fora da rodada, ÷ 12 s ≈ 25/s.
// ---------------------------------------------------------------------------

/** Rodada aberta: o placar mexe, a pessoa quer ver. */
const POLL_OPEN_MS = 4_000;
/** Apurando: a vencedora sai no próximo tick do banco (10 s). */
const POLL_CLOSING_MS = 5_000;
/** Sem rodada: só descobrir que a próxima abriu. */
const POLL_IDLE_MS = 12_000;
/** Show encerrado ou cancelado: não vai mudar, só não custa nada saber. */
const POLL_STOPPED_MS = 60_000;
/** Falha: espera cresce até aqui, com jitter. */
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 20_000;
/** Telão com websocket de pé: rede de segurança para evento perdido. */
const HEARTBEAT_MS = 15_000;
/** Telão: no máximo uma leitura por segundo, por mais votos que cheguem. */
const REALTIME_MIN_GAP_MS = 1_000;
/**
 * Fila do repertório: só quem está com a aba aberta consulta, e mais devagar
 * que o placar — apoio é decisão de minutos, não de segundos. Com 300 celulares
 * na aba, ≈ 30 consultas/s, quase todas "nada mudou" (~100 B).
 */
const REPERTOIRE_POLL_MS = 10_000;
/** Uma falha isolada é ruído de rede; duas seguidas é a tela mentindo. */
const OFFLINE_AFTER_FAILURES = 2;

/**
 * ±25% em cada espera. Sem isso, 300 celulares que abriram a página juntos
 * (o QR do telão, no começo do show) consultam juntos para sempre — o pico da
 * entrada vira pico a cada 4 segundos.
 */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

function translate(
  error: { message: string; code?: string } | null,
  fallback: string,
): never {
  const message = error?.message ?? fallback;

  // 53300 = too_many_connections, o código que o rate limit do banco usa.
  // Tem de vir antes de tudo: é o erro que a UI trata tentando de novo sozinha.
  if (error?.code === '53300' || /^Muit[ao]s /i.test(message)) {
    throw new ApiError(message, 'rate_limited');
  }
  // "rodada não encontrada" também contém "não encontrad": sem este caso
  // antes, virava "Código do show não encontrado" no meio de uma votação.
  if (/rodada não encontrada/i.test(message)) {
    throw new ApiError('Esta rodada não existe mais.', 'round_closed');
  }
  if (/Código do show não encontrado|not found/i.test(message)) {
    throw new ApiError('Código do show não encontrado.', 'show_not_found');
  }
  // O banco já escreve estas em português, para a plateia, e distingue "ainda
  // não abriu" de "já terminou" — repassamos o texto dele em vez de achatar os
  // dois casos numa frase genérica daqui.
  if (/não está no ar|já terminou|indisponível/i.test(message)) {
    throw new ApiError(message, 'show_not_live');
  }
  if (/apoios acabaram/i.test(message)) {
    throw new ApiError(message, 'no_supports_left');
  }
  if (/não está aberta para apoio|música não encontrada/i.test(message)) {
    throw new ApiError('Essa música não está aberta para apoio agora.', 'song_unavailable');
  }
  if (/fila do repertório está desligada|apoio passa pelo Pix/i.test(message)) {
    throw new ApiError(message, 'queue_closed');
  }
  if (/Informe seu @/i.test(message)) {
    throw new ApiError('Informe seu @ do Instagram para votar.', 'instagram_required');
  }
  if (/já votou/i.test(message)) {
    throw new ApiError('Você já votou nesta rodada.', 'already_voted');
  }
  if (/encerrada|closing|settled/i.test(message)) {
    throw new ApiError('Esta rodada já foi encerrada.', 'round_closed');
  }
  if (/valor fora/i.test(message)) {
    throw new ApiError('Valor fora do permitido para este show.', 'invalid_amount');
  }
  throw new ApiError(fallback, 'unknown');
}

/** O que `get_repertoire_state` devolve — ver …200000_fila_repertorio.sql. */
interface RepertoireWire {
  unchanged?: true;
  serverTime: string;
  version: string;
  listVersion?: string;
  list?: { id: string; title: string; artistName: string }[];
  enabled?: boolean;
  showStatus?: ShowStatus;
  perSession?: number;
  left?: number;
  weights?: number[];
  flags?: number[];
  order?: number[];
  mine?: number[];
}

const FLAG_STATUS: RepertoireSongStatus[] = ['available', 'candidate', 'queued'];

/** Monta o estado legível a partir da lista em cache e dos números da rodada. */
function decodeRepertoire(
  wire: RepertoireWire,
  list: NonNullable<RepertoireWire['list']>,
): RepertoireState {
  const mine = new Set(wire.mine ?? []);
  const songs: RepertoireSong[] = (wire.order ?? []).flatMap((idx, i) => {
    const item = list[idx];
    if (!item) return [];
    const flag = wire.flags?.[idx] ?? 0;
    return [{
      id: item.id,
      title: item.title,
      artistName: item.artistName,
      weight: wire.weights?.[idx] ?? 0,
      status: FLAG_STATUS[flag & 3] ?? 'available',
      pinned: (flag & 4) === 4,
      mine: mine.has(idx),
      rank: i + 1,
    }];
  });
  return {
    enabled: wire.enabled ?? false,
    showStatus: wire.showStatus ?? 'live',
    supportsPerSession: wire.perSession ?? 0,
    supportsLeft: wire.left ?? 0,
    songs,
    serverTime: wire.serverTime,
    version: wire.version,
  };
}

export const supabaseApi: VotePlayApi = {
  async join(joinCode) {
    const { data, error } = await getSupabase().rpc('join_show', {
      p_join_code: joinCode,
      p_device_hash: getDeviceHash(),
    });
    if (error) translate(error, 'Não foi possível entrar no show.');
    // a RPC devolve exatamente {show, session} em camelCase — ver …_public_api.sql
    return data as JoinResult;
  },

  async getShowState(showId, sessionId, knownVersion) {
    const { data, error } = await getSupabase().rpc('get_show_state', {
      p_show_id: showId,
      p_session_id: sessionId,
      p_version: knownVersion ?? null,
    });
    if (error) translate(error, 'Não foi possível carregar o show.');
    // a RPC devolve exatamente ShowState, ou {unchanged, serverTime, version}
    return data as ShowState | ShowStateUnchanged;
  },

  async createVoteIntent(_input: VoteIntentInput) {
    throw new ApiError(
      'O pagamento via Pix entra na Fase 7. Use VITE_API_PROVIDER=mock para ver o fluxo completo.',
      'unknown',
    );
  },

  async castFreeVote(input) {
    const { data, error } = await getSupabase().rpc('cast_free_vote', {
      p_round_id: input.roundId,
      p_candidate_id: input.candidateId,
      p_session_id: input.sessionId,
    });
    if (error) {
      if (/passa pelo Pix|desligado/i.test(error.message)) {
        throw new ApiError(error.message, 'free_votes_exhausted');
      }
      translate(error, 'Não foi possível registrar seu voto.');
    }
    return data as { voteId: string };
  },

  async setSongSupport(input) {
    const { data, error } = await getSupabase().rpc('set_song_support', {
      p_show_song_id: input.showSongId,
      p_session_id: input.sessionId,
      p_support: input.support,
    });
    if (error) translate(error, 'Não foi possível registrar seu apoio.');
    return data as { supported: boolean; supportsLeft: number };
  },

  /**
   * Fila do repertório por polling, com duas versões: a da lista (títulos,
   * muda raramente) e a dos números. A lista fica em cache aqui e só é
   * reenviada pelo banco quando muda.
   */
  subscribeRepertoire(showId, sessionId, observer): ShowSubscription {
    const supabase = getSupabase();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let again = false;
    let failures = 0;
    let backoff = BACKOFF_MIN_MS;
    let health: ConnectionHealth | null = null;
    let list: NonNullable<RepertoireWire['list']> | null = null;
    let listVersion: string | null = null;
    let last: RepertoireState | null = null;

    const setHealth = (next: ConnectionHealth) => {
      if (cancelled || health === next) return;
      health = next;
      observer.onHealth?.(next);
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (cancelled || document.hidden) return;
      const stopped = last && (last.showStatus === 'ended' || last.showStatus === 'cancelled');
      const wait = failures > 0
        ? 500 + Math.round(Math.random() * backoff)
        : jitter(stopped ? POLL_STOPPED_MS : REPERTOIRE_POLL_MS);
      timer = setTimeout(() => void refresh(), wait);
    };

    const refresh = async () => {
      if (cancelled) return;
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        const { data, error } = await supabase.rpc('get_repertoire_state', {
          p_show_id: showId,
          p_session_id: sessionId,
          p_list_version: list ? listVersion : null,
          p_version: list ? (last?.version ?? null) : null,
        });
        if (error) translate(error, 'Não foi possível carregar a fila.');
        if (cancelled) return;
        const wire = data as RepertoireWire;

        if (wire.unchanged) {
          if (last) observer.onState((last = { ...last, serverTime: wire.serverTime }));
        } else {
          if (wire.list) {
            list = wire.list;
            listVersion = wire.listVersion ?? null;
          }
          if (list) {
            last = decodeRepertoire(wire, list);
            observer.onState(last);
          }
        }
        failures = 0;
        backoff = BACKOFF_MIN_MS;
        setHealth('live');
      } catch {
        if (cancelled) return;
        failures += 1;
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        if (failures >= OFFLINE_AFTER_FAILURES) setHealth('offline');
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (again) {
            again = false;
            void refresh();
          } else {
            schedule();
          }
        }
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    setHealth('connecting');
    void refresh();

    return {
      unsubscribe: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      },
      refresh: () => void refresh(),
    };
  },

  async createRequestIntent(_input: RequestIntentInput) {
    throw new ApiError('O pedido direto com Pix entra na Fase 8.', 'unknown');
  },

  async getPaymentStatus() {
    throw new ApiError('Pagamentos entram na Fase 7.', 'unknown');
  },

  async markInstagramFollowClick(sessionId) {
    const { data, error } = await getSupabase().rpc('mark_instagram_follow_click', {
      p_session_id: sessionId,
    });
    if (error) translate(error, 'Não foi possível registrar o toque.');
    return data as { followClickedAt: string };
  },

  async setSessionInstagram(sessionId, handle) {
    const { data, error } = await getSupabase().rpc('set_session_instagram', {
      p_session_id: sessionId,
      p_handle: handle,
    });
    if (error) {
      if (/não parece|Informe seu @/i.test(error.message)) {
        throw new ApiError('Esse @ não parece um perfil do Instagram.', 'invalid_handle');
      }
      translate(error, 'Não foi possível salvar seu @.');
    }
    return data as { instagramHandle: string };
  },

  /**
   * Acompanha o show.
   *
   * `poll` (plateia): consultas com intervalo que depende do momento do show,
   * jitter, versão e pausa com a aba em segundo plano. Não abre websocket —
   * no plano Free o Realtime tem 200 conexões para o projeto inteiro e 100
   * mensagens por segundo, e um show cheio estouraria os dois sozinho.
   *
   * `realtime` (telão): websocket escutando só `rounds` e `direct_requests`
   * DESTE show. Todo voto atualiza os totais da rodada, então um evento basta
   * como gatilho; o estado vem sempre do snapshot, que não dessincroniza no
   * primeiro pacote perdido. Sem websocket, cai no polling.
   */
  subscribeShow(showId, sessionId, observer, options) {
    const supabase = getSupabase();
    const realtime = options?.transport === 'realtime';

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;

    let socketUp = false;
    let failures = 0;
    let backoff = BACKOFF_MIN_MS;
    let health: ConnectionHealth | null = null;
    let last: ShowState | null = null;
    let inFlight = false;
    let again = false;
    let lastFetchAt = 0;
    /** relógio do servidor − relógio local, medido quando a resposta chega */
    let skewMs = 0;

    /** Só avisa quando muda: a UI não precisa de ruído a cada consulta. */
    const setHealth = (next: ConnectionHealth) => {
      if (cancelled || health === next) return;
      health = next;
      observer.onHealth?.(next);
    };

    const currentHealth = (): ConnectionHealth => {
      if (failures >= OFFLINE_AFTER_FAILURES) return 'offline';
      // no polling, consulta que chega É o transporte funcionando
      if (!realtime || socketUp) return 'live';
      return 'degraded';
    };

    /** Quanto esperar até a próxima leitura, dado o que está na tela. */
    const nextDelay = (): number => {
      if (failures > 0) return Math.round(Math.random() * backoff) + 500;
      if (realtime && socketUp) return HEARTBEAT_MS;

      const round = last?.round;
      if (!last) return jitter(POLL_IDLE_MS);
      if (last.showStatus === 'ended' || last.showStatus === 'cancelled') {
        return jitter(POLL_STOPPED_MS);
      }
      // Pausado é intervalo: a volta tem de aparecer tão rápido quanto a
      // próxima rodada, não um minuto depois.
      if (last.showStatus !== 'live') return jitter(POLL_IDLE_MS);
      if (round?.status === 'open') {
        let wait = jitter(POLL_OPEN_MS);
        // O fim do cronômetro é o momento que todo mundo quer ver. Em vez de
        // descobrir até 4 s depois, marca uma leitura logo após o zero —
        // espalhada em 3 s, para 300 celulares não chegarem no mesmo instante.
        if (round.closesAt) {
          const untilClose = new Date(round.closesAt).getTime() - (Date.now() + skewMs);
          const afterClose = untilClose + 500 + Math.random() * 2_500;
          if (afterClose > 0 && afterClose < wait) wait = afterClose;
        }
        return wait;
      }
      if (round?.status === 'closing') return jitter(POLL_CLOSING_MS);
      return jitter(POLL_IDLE_MS);
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => void refresh(), nextDelay());
    };

    const refresh = async () => {
      if (cancelled) return;
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      lastFetchAt = Date.now();
      try {
        const res = await supabaseApi.getShowState(showId, sessionId, last?.version);
        if (cancelled) return;
        skewMs = new Date(res.serverTime).getTime() - Date.now();
        if (isUnchanged(res)) {
          // `last` existe: só mandamos versão quando já temos um snapshot
          if (last) {
            last = { ...last, serverTime: res.serverTime };
            observer.onState(last);
          }
        } else {
          last = res;
          observer.onState(res);
        }
        failures = 0;
        backoff = BACKOFF_MIN_MS;
        setHealth(currentHealth());
      } catch {
        if (cancelled) return;
        failures += 1;
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        setHealth(currentHealth());
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (again) {
            again = false;
            void refresh();
          } else {
            schedule();
          }
        }
      }
    };

    /** Evento do websocket: no máximo uma leitura por segundo. */
    let throttle: ReturnType<typeof setTimeout> | null = null;
    const onEvent = () => {
      if (cancelled || throttle) return;
      const wait = Math.max(0, REALTIME_MIN_GAP_MS - (Date.now() - lastFetchAt));
      throttle = setTimeout(() => {
        throttle = null;
        void refresh();
      }, wait);
    };

    const subscribe = () => {
      if (cancelled || !realtime) return;
      if (channel) void supabase.removeChannel(channel);

      channel = supabase
        .channel(`show:${showId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'rounds', filter: `show_id=eq.${showId}` },
            onEvent)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'direct_requests', filter: `show_id=eq.${showId}` },
            onEvent)
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            socketUp = true;
            // Reassinar deixa um buraco: o que mudou enquanto estávamos fora
            // não gera evento. Uma leitura imediata fecha esse buraco.
            void refresh();
          } else {
            // CHANNEL_ERROR, TIMED_OUT, CLOSED — o polling assume.
            socketUp = false;
            setHealth(currentHealth());
            schedule();
          }
        });
    };

    /** Voltar para a aba, ou para a rede, invalida o que está na tela. */
    const wakeUp = () => {
      if (cancelled || document.hidden) return;
      failures = 0;
      backoff = BACKOFF_MIN_MS;
      if (realtime && !socketUp) subscribe();
      void refresh();
    };

    const onVisibility = () => {
      if (document.hidden) {
        // Celular no bolso não consulta nada — 300 celulares consultando no
        // bolso é cota do plano Free queimada à toa.
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        wakeUp();
      }
    };

    const onOffline = () => {
      if (cancelled) return;
      socketUp = false;
      failures = OFFLINE_AFTER_FAILURES;
      setHealth('offline');
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', wakeUp);
    window.addEventListener('offline', onOffline);

    setHealth('connecting');
    subscribe();
    void refresh();

    return {
      unsubscribe: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        if (throttle) clearTimeout(throttle);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('online', wakeUp);
        window.removeEventListener('offline', onOffline);
        if (channel) void supabase.removeChannel(channel);
      },
      // Leitura imediata. Vai com a versão mesmo assim: ela é o hash do
      // snapshot DESTA sessão, então se o voto mudou algo a resposta vem
      // completa, e se não mudou ninguém paga pelo placar inteiro.
      refresh: () => void refresh(),
    };
  },
};
