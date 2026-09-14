import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { getDeviceHash } from '@/lib/deviceHash';
import type { ShowState } from '@/types/domain';
import {
  ApiError,
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

function translate(error: { message: string; code?: string } | null, fallback: string): never {
  const message = error?.message ?? fallback;
  if (/não encontrado|not found/i.test(message)) {
    throw new ApiError('Código do show não encontrado.', 'show_not_found');
  }
  if (/não está no ar|indisponível/i.test(message)) {
    throw new ApiError('Este show não está no ar.', 'show_not_live');
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

  async castFreeVote() {
    throw new ApiError('Voto sem pagamento entra na Fase 3.', 'unknown');
  },

  async createRequestIntent(_input: RequestIntentInput) {
    throw new ApiError('O pedido direto com Pix entra na Fase 4.', 'unknown');
  },

  async getPaymentStatus() {
    throw new ApiError('Pagamentos entram na Fase 4.', 'unknown');
  },

  /**
   * Assina as mudanças do show. Em vez de reconstruir o estado a partir de cada
   * evento — o que dessincroniza no primeiro pacote perdido — usamos o evento
   * apenas como gatilho e buscamos o snapshot inteiro, que é uma única ida ao
   * servidor. Os eventos vêm em rajada quando a plateia vota, então há um
   * debounce curto para não disparar uma busca por voto.
   */
  subscribeShow(showId, sessionId, onState) {
    const supabase = getSupabase();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      if (cancelled) return;
      try {
        const state = await supabaseApi.getShowState(showId, sessionId);
        if (!cancelled) onState(state);
      } catch {
        /* falha momentânea: o próximo evento ou o polling de reconexão resolve */
      }
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 120);
    };

    const channel: RealtimeChannel = supabase
      .channel(`show:${showId}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'round_candidates' }, schedule)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'rounds', filter: `show_id=eq.${showId}` }, schedule)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'direct_requests', filter: `show_id=eq.${showId}` }, schedule)
      .subscribe();

    void refresh();

    // Rede de segurança: wi-fi de bar derruba websocket sem avisar.
    const heartbeat = setInterval(() => void refresh(), 15000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      void supabase.removeChannel(channel);
    };
  },
};
