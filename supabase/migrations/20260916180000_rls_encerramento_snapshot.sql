-- Vote Play — correções da revisão de 16/09.
--
--   1. A chave pública deixa de ler a tabela `shows`
--      (listava todos os códigos no ar e colunas internas).
--   2. O painel deixa de enxergar shows de outros artistas
--      (a policy pública valia também para `authenticated`).
--   3. `direct_requests` deixa de expor valor e sessão para a chave pública.
--   4. Encerrar o show fecha o que ficou aberto; `started_at` não é reescrito
--      ao despausar; encerrado é estado final.
--   5. `get_show_state` responde "nada mudou" em poucos bytes e continua
--      respondendo depois que o show termina — é o que torna o polling da
--      plateia viável no plano Free (ver plan.md, "Requisitos do sistema").
--   6. Realtime: `round_candidates` sai da publicação (ninguém mais assina).

-- ---------------------------------------------------------------------------
-- 1–3. Leitura pública sem tocar em `shows`
--
-- As policies de `rounds`, `round_candidates` e `direct_requests` consultavam
-- `shows` por dentro. Policy roda com o privilégio de quem consulta, então
-- tirar o SELECT de `shows` da anon quebraria as três. Os ajudantes abaixo
-- são SECURITY DEFINER: respondem só "este show está visível?" e nada mais.
-- ---------------------------------------------------------------------------

create or replace function show_is_public(p_show_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shows where id = p_show_id and status in ('live', 'paused'));
$$;

create or replace function round_is_public(p_round_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rounds r join shows s on s.id = r.show_id
     where r.id = p_round_id and s.status in ('live', 'paused'));
$$;

revoke all on function show_is_public(uuid)  from public;
revoke all on function round_is_public(uuid) from public;
grant execute on function show_is_public(uuid)  to anon, authenticated, service_role;
grant execute on function round_is_public(uuid) to anon, authenticated, service_role;

-- shows: só o dono lê. A plateia entra por join_show/get_show_state.
drop policy if exists shows_public_read on shows;
revoke select on shows from anon;

drop policy if exists rounds_public_read on rounds;
create policy rounds_public_read on rounds
  for select to anon, authenticated
  using (show_is_public(show_id));

drop policy if exists round_candidates_public_read on round_candidates;
create policy round_candidates_public_read on round_candidates
  for select to anon, authenticated
  using (round_is_public(round_id));

-- Pedidos: a leitura pública vale só para anon e só nas colunas sem dinheiro
-- nem sessão. O artista logado vê os próprios pedidos pela policy de dono —
-- sem esta separação, um artista leria o valor pago nos shows dos outros.
drop policy if exists direct_requests_public_read on direct_requests;
create policy direct_requests_public_read on direct_requests
  for select to anon
  using (status in ('paid', 'accepted', 'played') and show_is_public(show_id));

revoke select on direct_requests from anon;
grant select (id, show_id, title, artist_name, message, requester_name,
              status, queue_position, created_at)
  on direct_requests to anon;

-- ---------------------------------------------------------------------------
-- 4. Ciclo de vida do show
-- ---------------------------------------------------------------------------

create or replace function shows_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('ended', 'cancelled') then
    raise exception 'Este show já foi encerrado e não pode voltar ao ar.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- despausar não é começar de novo: o resumo mede a noite desde a 1ª subida
  if new.status = 'live' then
    new.started_at := coalesce(old.started_at, now());
  end if;

  if new.status in ('ended', 'cancelled') then
    new.ended_at := coalesce(new.ended_at, now());
  end if;

  return new;
end $$;

drop trigger if exists shows_status_guard on shows;
create trigger shows_status_guard before update of status on shows
  for each row execute function shows_status_guard();

/**
 * Encerrar o show fecha o que ficou pendurado (plan.md, 6.4):
 *   ended     → rodada aberta é apurada na hora (força a carência)
 *   cancelled → rodada aberta é cancelada, sem vencedora
 * e, nos dois, cobrança em aberto expira e leva junto o voto pendente e o
 * pedido não pago.
 *
 * Sem isto, encerrar com rodada aberta deixava o telão parado em 00:00 e a
 * rodada contando para sempre em `tick_rounds`.
 */
create or replace function shows_close_on_end() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.status not in ('ended', 'cancelled') or old.status in ('ended', 'cancelled') then
    return null;
  end if;

  for r in
    select id, status from rounds
     where show_id = new.id and status in ('open', 'closing')
  loop
    if new.status = 'cancelled' then
      update rounds set status = 'cancelled', closed_at = coalesce(closed_at, now())
       where id = r.id;
      update show_songs set status = 'available'
       where show_id = new.id and status = 'candidate';
    else
      if r.status = 'open' then
        perform close_round_voting(r.id);
      end if;
      perform settle_round(r.id, true);
    end if;
  end loop;

  with expiradas as (
    update payments set status = 'expired'
     where show_id = new.id and status in ('created', 'pending')
    returning id
  ),
  votos as (
    update votes set status = 'expired'
     where payment_id in (select id from expiradas) and status = 'pending'
    returning 1
  ),
  pedidos as (
    update direct_requests set status = 'refunded'
     where show_id = new.id and status = 'pending_payment'
    returning 1
  )
  select 1 from expiradas limit 1 into r;

  insert into show_events (show_id, actor, type, payload)
  values (new.id, 'system', 'show_' || new.status::text, '{}'::jsonb);

  return null;
end $$;

drop trigger if exists shows_close_on_end on shows;
create trigger shows_close_on_end after update of status on shows
  for each row execute function shows_close_on_end();

-- ---------------------------------------------------------------------------
-- 5. Snapshot com versão
--
-- A plateia consulta o estado a cada poucos segundos (Realtime para 300
-- celulares não cabe no plano Free — ver plan.md). Na maior parte das
-- consultas nada mudou; responder o snapshot inteiro de novo é egress jogado
-- fora, e o Free dá 5 GB por mês. O cliente manda a versão que tem; se for a
-- mesma, a resposta é só {serverTime, version, unchanged}.
--
-- A versão é o hash do próprio snapshot, então ela muda por construção quando
-- qualquer coisa visível muda — inclusive o voto desta sessão. Não existe
-- lista de campos para esquecer de atualizar.
--
-- O show encerrado continua respondendo: a plateia vê a última vencedora e
-- "o show terminou" em vez de um aviso de conexão caída a noite inteira.
-- ---------------------------------------------------------------------------

drop function if exists get_show_state(uuid, uuid);

create or replace function get_show_state(
  p_show_id    uuid,
  p_session_id uuid default null,
  p_version    text default null
) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_show    shows;
  v_round   rounds;
  v_body    jsonb;
  v_version text;
begin
  select * into v_show from shows
   where id = p_show_id and status in ('live', 'paused', 'ended', 'cancelled');
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

  v_body := jsonb_build_object(
    'showStatus', v_show.status,
    'round', case when v_round.id is null then null else jsonb_build_object(
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
        -- ordem ESTÁVEL (a do artista), não por peso: a lista não pode pular
        -- debaixo do dedo de quem está tocando. Quem quiser ranking ordena.
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'roundId', c.round_id, 'title', c.title,
                 'artistName', c.artist_name, 'position', c.position,
                 'weight', c.weight, 'amountCents', c.amount_cents,
                 'votesCount', c.votes_count
               ) order by c.position)
          from round_candidates c where c.round_id = v_round.id
      ), '[]'::jsonb)
    ) end,
    'queue', coalesce((
      select jsonb_agg(jsonb_build_object(
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
    ), '[]'::jsonb)
  );

  v_version := left(md5(v_body::text), 16);

  if p_version is not null and p_version = v_version then
    return json_build_object('serverTime', now(), 'version', v_version, 'unchanged', true);
  end if;

  return (v_body || jsonb_build_object('serverTime', now(), 'version', v_version))::json;
end $$;

revoke all on function get_show_state(uuid, uuid, text) from public;
grant execute on function get_show_state(uuid, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Realtime
--
-- Só o telão assina, e só `rounds` (filtrado por show) e `direct_requests`.
-- Todo voto confirmado já atualiza os totais da rodada, então o evento de
-- `rounds` basta para o telão buscar o snapshot. `round_candidates` era a
-- tabela mais escrita do banco sendo decodificada para ninguém.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publicação supabase_realtime ausente — pulando (ambiente não-Supabase)';
    return;
  end if;
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'round_candidates'
  ) then
    alter publication supabase_realtime drop table public.round_candidates;
    raise notice 'round_candidates saiu da publicação de Realtime';
  end if;
end $$;

-- sem assinante, o "full" só engorda o WAL da tabela que mais recebe UPDATE
alter table round_candidates replica identity default;
