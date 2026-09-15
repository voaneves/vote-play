import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { getDeviceHash } from '@/lib/deviceHash';
import type { ShowState } from '@/types/domain';
import {
  ApiError,
  type ConnectionHealth,
  type JoinResult,
  type RequestIntentInput,
  type VoteIntentInput,
  type VotePlayApi,
} from './types';

/**
 * Implementação sobre o Supabase.
 *
 * A plateia nunca toca nas tabelas: fala apenas com duas RPCs de contrato
 * estreito (`join_show` e `get_show_state`), que rodam SECURITY DEFINER e
 * devolvem exatamente o formato do domínio — por isso quase não há conversão
 * aqui. Ver supabase/migrations/…_public_api.sql.
 */

/** Evento do Postgres vem em rajada quando uma rodada fecha; agrupa. */
const EVENT_DEBOUNCE_MS = 120;
/** Com websocket de pé: rede de segurança para evento perdido. */
const HEARTBEAT_MS = 15_000;
/** Sem websocket: o polling vira o transporte e começa agressivo. */
const DEGRADED_MIN_MS = 2_000;
const DEGRADED_MAX_MS = 10_000;
/** Uma falha isolada é ruído de rede; duas seguidas é a tela mentindo. */
const OFFLINE_AFTER_FAILURES = 2;

function translate(error: { message: string; code?: string } | null, fallback: string): never {
  const message = error?.message ?? fallback;
  if (/não encontrado|not found/i.test(message)) {
    throw new ApiError('Código do show não encontrado.', 'show_not_found');
  }
  if (/não está no ar|indisponível/i.test(message)) {
    throw new ApiError('Este show não está no ar.', 'show_not_live');
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

  async getShowState(showId, sessionId) {
    const { data, error } = await getSupabase().rpc('get_show_state', {
      p_show_id: showId,
      p_session_id: sessionId,
    });
    if (error) translate(error, 'Não foi possível carregar o show.');
    // a RPC devolve {serverTime, round, queue}, que é exatamente ShowState
    return data as ShowState;
  },

  async createVoteIntent(_input: VoteIntentInput) {
    throw new ApiError(
      'O pagamento via Pix entra na Fase 4. Use VITE_API_PROVIDER=mock para ver o fluxo completo.',
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
      if (/já votou/i.test(error.message)) {
        throw new ApiError('Você já votou nesta rodada.', 'already_voted');
      }
      if (/passa pelo Pix|desligado/i.test(error.message)) {
        throw new ApiError(error.message, 'free_votes_exhausted');
      }
      translate(error, 'Não foi possível registrar seu voto.');
    }
    return data as { voteId: string };
  },

  async createRequestIntent(_input: RequestIntentInput) {
    throw new ApiError('O pedido direto com Pix entra na Fase 4.', 'unknown');
  },

  async getPaymentStatus() {
    throw new ApiError('Pagamentos entram na Fase 4.', 'unknown');
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
   * Assina as mudanças do show. Em vez de reconstruir o estado a partir de cada
   * evento — o que dessincroniza no primeiro pacote perdido — usamos o evento
   * apenas como gatilho e buscamos o snapshot inteiro, que é uma única ida ao
   * servidor. Os eventos vêm em rajada quando a plateia vota, então há um
   * debounce curto para não disparar uma busca por voto.
   */
  subscribeShow(showId, sessionId, observer) {
    const supabase = getSupabase();

    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let channel: RealtimeChannel | null = null;

    let socketUp = false;
    let failures = 0;
    let backoff = DEGRADED_MIN_MS;
    let health: ConnectionHealth | null = null;

    /** Só avisa quando muda: a UI não precisa de ruído a cada tick do polling. */
    const setHealth = (next: ConnectionHealth) => {
      if (cancelled || health === next) return;
      health = next;
      observer.onHealth?.(next);
    };

    const currentHealth = (): ConnectionHealth => {
      if (failures >= OFFLINE_AFTER_FAILURES) return 'offline';
      if (socketUp) return 'live';
      return 'degraded';
    };

    const refresh = async () => {
      if (cancelled) return;
      try {
        const state = await supabaseApi.getShowState(showId, sessionId);
        if (cancelled) return;
        failures = 0;
        backoff = DEGRADED_MIN_MS;
        observer.onState(state);
        setHealth(currentHealth());
      } catch {
        if (cancelled) return;
        failures += 1;
        // Só cresce a espera depois que o websocket já caiu: com ele de pé, a
        // falha é de uma consulta isolada e a próxima já tende a passar.
        if (!socketUp) backoff = Math.min(backoff * 2, DEGRADED_MAX_MS);
        setHealth(currentHealth());
      }
    };

    const scheduleDebounced = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        void refresh();
      }, EVENT_DEBOUNCE_MS);
    };

    /**
     * Um timer só, reagendado a cada ciclo. Com o websocket de pé ele é rede de
     * segurança (evento perdido, aba dormindo); sem ele, é o transporte.
     * `setTimeout` encadeado em vez de `setInterval` para nunca empilhar consultas
     * quando a rede está lenta.
     */
    const loop = () => {
      if (poll) clearTimeout(poll);
      if (cancelled || document.hidden) return;
      const wait = socketUp ? HEARTBEAT_MS : backoff;
      poll = setTimeout(() => {
        void refresh().finally(loop);
      }, wait);
    };

    const subscribe = () => {
      if (cancelled) return;
      if (channel) void supabase.removeChannel(channel);

      channel = supabase
        .channel(`show:${showId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'round_candidates' }, scheduleDebounced)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'rounds', filter: `show_id=eq.${showId}` },
            scheduleDebounced)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'direct_requests', filter: `show_id=eq.${showId}` },
            scheduleDebounced)
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            socketUp = true;
            // Reassinar deixa um buraco: o que mudou enquanto estávamos fora não
            // gera evento. Uma leitura imediata fecha esse buraco.
            void refresh();
          } else {
            // CHANNEL_ERROR, TIMED_OUT, CLOSED — o polling assume o transporte.
            socketUp = false;
            setHealth(currentHealth());
          }
          loop();
        });
    };

    /** Voltar para a aba, ou para a rede, invalida tudo que está na tela. */
    const wakeUp = () => {
      if (cancelled || document.hidden) return;
      failures = 0;
      backoff = DEGRADED_MIN_MS;
      setHealth('connecting');
      if (!socketUp) subscribe();
      void refresh();
      loop();
    };

    const onVisibility = () => {
      if (document.hidden) {
        // Celular no bolso não precisa consultar nada — e 80 celulares
        // consultando no bolso é conexão do Supabase queimada à toa.
        if (poll) clearTimeout(poll);
        poll = null;
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
    loop();

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      if (poll) clearTimeout(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', wakeUp);
      window.removeEventListener('offline', onOffline);
      if (channel) void supabase.removeChannel(channel);
    };
  },
};
