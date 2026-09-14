-- Vote Play — API pública da plateia.
--
-- A RLS proíbe `anon` de escrever em qualquer tabela. Mas entrar no show exige
-- registrar uma sessão, e ler o placar exige juntar 4 tabelas. Em vez de abrir
-- as tabelas, expomos duas funções SECURITY DEFINER com contrato estreito:
-- elas validam tudo e devolvem só o que a plateia pode ver.
--
-- Bônus de latência: `get_show_state` traz o snapshot inteiro em UMA ida ao
-- servidor, em vez de quatro — o que importa no wi-fi de um bar.

/**
 * Entra no show pelo código. Idempotente por dispositivo: o mesmo device_hash
 * recupera a sessão anterior em vez de criar outra.
 */
create or replace function join_show(
  p_join_code   text,
  p_device_hash text,
  p_nickname    text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_show    shows;
  v_session audience_sessions;
begin
  if p_device_hash is null or length(btrim(p_device_hash)) < 8 then
    raise exception 'identificador de dispositivo inválido' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_show
    from shows
   where join_code = upper(btrim(p_join_code))
     and status in ('live', 'paused');

  if not found then
    raise exception 'Código do show não encontrado.' using errcode = 'no_data_found';
  end if;

  insert into audience_sessions (show_id, device_hash, nickname)
  values (v_show.id, p_device_hash, nullif(btrim(coalesce(p_nickname, '')), ''))
  on conflict (show_id, device_hash) do update
    set last_seen_at = now(),
        nickname = coalesce(excluded.nickname, audience_sessions.nickname)
  returning * into v_session;

  return json_build_object(
    'show', json_build_object(
      'id', v_show.id,
      'joinCode', v_show.join_code,
      'title', v_show.title,
      'venue', v_show.venue,
      'city', v_show.city,
      'coverUrl', v_show.cover_url,
      'status', v_show.status,
      'voteMode', v_show.vote_mode,
      'voteMinCents', v_show.vote_min_cents,
      'voteMaxCents', v_show.vote_max_cents,
      'voteSuggestedCents', v_show.vote_suggested_cents,
      'centsPerPoint', v_show.cents_per_point,
      'freeVotesPerSession', v_show.free_votes_per_session,
      'roundDurationSeconds', v_show.round_duration_seconds,
      'directRequestEnabled', v_show.direct_request_enabled,
      'directRequestPriceCents', v_show.direct_request_price_cents
    ),
    'session', json_build_object(
      'id', v_session.id,
      'showId', v_session.show_id,
      'nickname', v_session.nickname,
      'freeVotesUsed', v_session.free_votes_used
    )
  );
end $$;

/**
 * Snapshot completo da tela do show: rodada ativa, candidatas e fila de pedidos.
 * `serverTime` volta junto para o cliente corrigir o drift do próprio relógio —
 * é o que mantém o cronômetro igual em todos os celulares da plateia.
 */
create or replace function get_show_state(p_show_id uuid, p_session_id uuid default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_show  shows;
  v_round rounds;
begin
  select * into v_show from shows
   where id = p_show_id and status in ('live', 'paused');
  if not found then
    raise exception 'show indisponível' using errcode = 'no_data_found';
  end if;

  select * into v_round from rounds
   where show_id = p_show_id and status in ('open', 'closing')
   order by seq desc limit 1;

  -- nenhuma ativa: mostra a última apurada, para a tela anunciar a vencedora
  if not found then
    select * into v_round from rounds
     where show_id = p_show_id and status = 'settled'
     order by seq desc limit 1;
  end if;

  return json_build_object(
    'serverTime', now(),
    'round', case when v_round.id is null then null else json_build_object(
      'id', v_round.id,
      'showId', v_round.show_id,
      'seq', v_round.seq,
      'label', v_round.label,
      'status', v_round.status,
      'opensAt', v_round.opens_at,
      'closesAt', v_round.closes_at,
      'winnerCandidateId', v_round.winner_candidate_id,
      'totalWeight', v_round.total_weight,
      'totalAmountCents', v_round.total_amount_cents,
      'totalVotes', v_round.total_votes,
      'candidates', coalesce((
        select json_agg(json_build_object(
                 'id', c.id,
                 'roundId', c.round_id,
                 'title', c.title,
                 'artistName', c.artist_name,
                 'position', c.position,
                 'weight', c.weight,
                 'amountCents', c.amount_cents,
                 'votesCount', c.votes_count
               ) order by c.weight desc, c.first_vote_at asc nulls last, c.position)
          from round_candidates c where c.round_id = v_round.id
      ), '[]'::json)
    ) end,
    'queue', coalesce((
      select json_agg(json_build_object(
               'id', q.id,
               'showId', q.show_id,
               'title', q.title,
               'artistName', q.artist_name,
               'message', q.message,
               'requesterName', q.requester_name,
               'amountCents', 0,          -- valor individual não é público
               'status', q.status,
               'queuePosition', q.queue_position,
               'createdAt', q.created_at,
               'mine', (p_session_id is not null and q.session_id = p_session_id)
             ) order by q.queue_position nulls last, q.created_at)
        from direct_requests q
       where q.show_id = p_show_id
         and (q.status in ('paid', 'accepted', 'played')
              or (p_session_id is not null and q.session_id = p_session_id))
    ), '[]'::json)
  );
end $$;

revoke all on function join_show(text, text, text) from public;
revoke all on function get_show_state(uuid, uuid) from public;
grant execute on function join_show(text, text, text)  to anon, authenticated;
grant execute on function get_show_state(uuid, uuid)   to anon, authenticated;
