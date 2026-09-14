-- Vote Play — voto sem pagamento (Fase 3).
--
-- Até aqui a plateia só LIA o show. Votar exigia `create_vote_intent`, que é
-- exclusiva de service_role porque emite cobrança. Para os modos gratuitos
-- precisamos de um caminho próprio, com contrato estreito e antifraude no banco.

-- ---------------------------------------------------------------------------
-- 1. O limite de voto grátis é POR RODADA, não por sessão do show inteiro.
--
-- A coluna nasceu como `free_votes_per_session` e o nome mentia sobre a regra:
-- num show de duas horas, um voto grátis no total seria inútil; um por rodada é
-- o que faz sentido. Renomear agora, enquanto ninguém depende dela.
-- ---------------------------------------------------------------------------

alter table shows rename column free_votes_per_session to free_votes_per_round;
alter table shows alter column free_votes_per_round set default 1;
comment on column shows.free_votes_per_round is
  'Quantos votos sem pagamento cada dispositivo pode dar em CADA rodada. 0 desliga o voto grátis.';

-- Invariante no banco, não na aplicação: um dispositivo não vota grátis duas
-- vezes na mesma rodada, qualquer que seja o caminho que tente.
create unique index votes_one_free_per_session_round
  on votes (round_id, session_id) where payment_id is null;

-- ---------------------------------------------------------------------------
-- 2. A RPC de voto grátis
-- ---------------------------------------------------------------------------

create or replace function cast_free_vote(
  p_round_id     uuid,
  p_candidate_id uuid,
  p_session_id   uuid
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_round   rounds;
  v_show    shows;
  v_session audience_sessions;
  v_vote_id uuid;
  v_usados  int;
begin
  select * into v_round from rounds where id = p_round_id;
  if not found then
    raise exception 'rodada não encontrada' using errcode = 'no_data_found';
  end if;
  if v_round.status <> 'open' or v_round.closes_at <= now() then
    raise exception 'Esta rodada já foi encerrada.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_show from shows where id = v_round.show_id;
  if v_show.status <> 'live' then
    raise exception 'Este show não está no ar.' using errcode = 'invalid_parameter_value';
  end if;
  if v_show.vote_mode = 'paid_weighted' then
    raise exception 'Neste show todo voto passa pelo Pix.' using errcode = 'invalid_parameter_value';
  end if;
  if v_show.free_votes_per_round <= 0 then
    raise exception 'O voto sem pagamento está desligado neste show.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- a sessão precisa ser deste show: um id de outro evento não serve
  select * into v_session
    from audience_sessions
   where id = p_session_id and show_id = v_show.id;
  if not found then
    raise exception 'sessão inválida para este show' using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from round_candidates where id = p_candidate_id and round_id = p_round_id
  ) then
    raise exception 'candidata não pertence a esta rodada' using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_usados
    from votes
   where round_id = p_round_id and session_id = p_session_id and payment_id is null;

  if v_usados >= v_show.free_votes_per_round then
    raise exception 'Você já votou nesta rodada.' using errcode = 'unique_violation';
  end if;

  -- Peso 1 sempre: no free_with_tip a gorjeta não altera o ranking, e no
  -- free_plus_boost o peso extra vem pelo caminho pago, nunca por aqui.
  insert into votes (round_id, candidate_id, session_id, payment_id,
                     weight, amount_cents, status, confirmed_at)
  values (p_round_id, p_candidate_id, p_session_id, null, 1, 0, 'confirmed', now())
  returning id into v_vote_id;

  update audience_sessions
     set free_votes_used = free_votes_used + 1, last_seen_at = now()
   where id = p_session_id;

  return json_build_object('voteId', v_vote_id, 'candidateId', p_candidate_id);
exception
  when unique_violation then
    -- corrida entre dois toques rápidos: o índice único decide, não o count
    raise exception 'Você já votou nesta rodada.' using errcode = 'unique_violation';
end $$;

revoke all on function cast_free_vote(uuid, uuid, uuid) from public;
grant execute on function cast_free_vote(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. O snapshot passa a dizer em quem ESTA sessão votou
--
-- Sem isso a tela não sabe marcar a escolha da pessoa nem bloquear o segundo
-- toque, e ela só descobriria o limite ao receber o erro.
-- ---------------------------------------------------------------------------

create or replace function get_show_state(p_show_id uuid, p_session_id uuid default null)
returns json
language plpgsql security definer set search_path = public, extensions as $$
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
      'myVoteCandidateId', (
        select v.candidate_id from votes v
         where v.round_id = v_round.id
           and p_session_id is not null
           and v.session_id = p_session_id
           and v.status = 'confirmed'
         order by v.confirmed_at limit 1
      ),
      'freeVotesLeft', greatest(0, v_show.free_votes_per_round - coalesce((
        select count(*) from votes v
         where v.round_id = v_round.id
           and p_session_id is not null
           and v.session_id = p_session_id
           and v.payment_id is null
      ), 0)),
      'candidates', coalesce((
        select json_agg(json_build_object(
                 'id', c.id, 'roundId', c.round_id, 'title', c.title,
                 'artistName', c.artist_name, 'position', c.position,
                 'weight', c.weight, 'amountCents', c.amount_cents,
                 'votesCount', c.votes_count
               ) order by c.weight desc, c.first_vote_at asc nulls last, c.position)
          from round_candidates c where c.round_id = v_round.id
      ), '[]'::json)
    ) end,
    'queue', coalesce((
      select json_agg(json_build_object(
               'id', q.id, 'showId', q.show_id, 'title', q.title,
               'artistName', q.artist_name, 'message', q.message,
               'requesterName', q.requester_name, 'amountCents', 0,
               'status', q.status, 'queuePosition', q.queue_position,
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

-- a RPC do join também devolve o nome novo da configuração
create or replace function join_show(
  p_join_code text, p_device_hash text, p_nickname text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_show    shows;
  v_session audience_sessions;
begin
  if p_device_hash is null or length(btrim(p_device_hash)) < 8 then
    raise exception 'identificador de dispositivo inválido' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_show from shows
   where join_code = upper(btrim(p_join_code)) and status in ('live', 'paused');
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
      'id', v_show.id, 'joinCode', v_show.join_code, 'title', v_show.title,
      'venue', v_show.venue, 'city', v_show.city, 'coverUrl', v_show.cover_url,
      'status', v_show.status, 'voteMode', v_show.vote_mode,
      'voteMinCents', v_show.vote_min_cents, 'voteMaxCents', v_show.vote_max_cents,
      'voteSuggestedCents', v_show.vote_suggested_cents,
      'centsPerPoint', v_show.cents_per_point,
      'freeVotesPerRound', v_show.free_votes_per_round,
      'roundDurationSeconds', v_show.round_duration_seconds,
      'directRequestEnabled', v_show.direct_request_enabled,
      'directRequestPriceCents', v_show.direct_request_price_cents
    ),
    'session', json_build_object(
      'id', v_session.id, 'showId', v_session.show_id,
      'nickname', v_session.nickname, 'freeVotesUsed', v_session.free_votes_used
    )
  );
end $$;

grant execute on function join_show(text, text, text) to anon, authenticated;
grant execute on function get_show_state(uuid, uuid) to anon, authenticated;
