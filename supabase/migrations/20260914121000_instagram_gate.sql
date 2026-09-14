-- Vote Play — modo Instagram e simplificação dos modos de votação.
--
-- IMPORTANTE, e o cliente precisa saber: NÃO existe forma de verificar que
-- alguém segue um perfil. A Basic Display API foi desligada em setembro de 2025
-- e nenhuma API do Instagram expõe relação de seguidor para terceiros — nem com
-- login, nem para conta Business. O que este modo entrega é ATRITO e REGISTRO:
-- um toque que leva ao perfil e o @ de quem participou. Não é trava.

-- ---------------------------------------------------------------------------
-- 1. Três modos, com nomes que o artista entende
--
--   pix       — todo voto passa por pagamento
--   instagram — voto grátis, atrás do portão do perfil
--   free      — voto grátis sem portão (evento beneficente, casamento)
--
-- `paid_weighted`, `free_plus_boost` e `free_with_tip` descreviam mecânica, não
-- produto, e dois deles nunca foram usados.
-- ---------------------------------------------------------------------------

create type vote_mode_v2 as enum ('pix', 'instagram', 'free');

alter table shows alter column vote_mode drop default;
alter table shows
  alter column vote_mode type vote_mode_v2
  using case vote_mode
    when 'paid_weighted'   then 'pix'
    when 'free_plus_boost' then 'free'
    when 'free_with_tip'   then 'free'
  end::vote_mode_v2;
alter table shows alter column vote_mode set default 'pix'::vote_mode_v2;

drop type vote_mode;
alter type vote_mode_v2 rename to vote_mode;

-- ---------------------------------------------------------------------------
-- 2. O perfil do show e o @ de quem vota
-- ---------------------------------------------------------------------------

alter table shows add column instagram_handle text;

-- Regras reais de username do Instagram: 1–30 caracteres, letras, números,
-- ponto e sublinhado; sem ponto no começo ou fim.
alter table shows add constraint shows_instagram_handle_format
  check (
    instagram_handle is null
    or (instagram_handle ~ '^[a-z0-9_](\.?[a-z0-9_]){0,29}$')
  );

-- Modo instagram sem perfil configurado seria um portão sem porta.
alter table shows add constraint shows_instagram_requires_handle
  check (vote_mode <> 'instagram' or instagram_handle is not null);

alter table audience_sessions add column instagram_handle text;
alter table audience_sessions add constraint sessions_instagram_handle_format
  check (
    instagram_handle is null
    or (instagram_handle ~ '^[a-z0-9_](\.?[a-z0-9_]){0,29}$')
  );

comment on column shows.instagram_handle is
  'Perfil que a plateia é convidada a seguir, sem @ e em minúsculas.';
comment on column audience_sessions.instagram_handle is
  'O @ que a pessoa declarou. Declaração, não verificação — ver topo desta migration.';

-- ---------------------------------------------------------------------------
-- 3. Normalização e registro do @
-- ---------------------------------------------------------------------------

/** Tira o @, espaços e uma URL colada; devolve null se não sobrar nada válido. */
create or replace function normalize_instagram_handle(p_input text)
returns text language plpgsql immutable as $$
declare v text;
begin
  if p_input is null then return null; end if;
  v := lower(btrim(p_input));
  v := regexp_replace(v, '^https?://(www\.)?instagram\.com/', '');
  v := regexp_replace(v, '[/?].*$', '');
  v := ltrim(v, '@');
  v := btrim(v);
  if v = '' then return null; end if;
  if v !~ '^[a-z0-9_](\.?[a-z0-9_]){0,29}$' then
    raise exception 'Esse @ não parece um perfil do Instagram.'
      using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

/** A plateia declara o próprio @. Chamada pela tela do portão. */
create or replace function set_session_instagram(p_session_id uuid, p_handle text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_handle  text;
  v_session audience_sessions;
begin
  v_handle := normalize_instagram_handle(p_handle);
  if v_handle is null then
    raise exception 'Informe seu @ do Instagram.' using errcode = 'invalid_parameter_value';
  end if;

  update audience_sessions
     set instagram_handle = v_handle, last_seen_at = now()
   where id = p_session_id
  returning * into v_session;

  if not found then
    raise exception 'sessão inválida' using errcode = 'no_data_found';
  end if;

  return json_build_object('instagramHandle', v_session.instagram_handle);
end $$;

revoke all on function set_session_instagram(uuid, text) from public;
revoke all on function normalize_instagram_handle(text) from public;
grant execute on function set_session_instagram(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. As funções que liam os modos antigos
-- ---------------------------------------------------------------------------

create or replace function compute_vote_weight(p_show_id uuid, p_amount_cents int)
returns int language plpgsql stable set search_path = public, extensions as $$
declare
  v_mode  vote_mode;
  v_ratio int;
begin
  select vote_mode, cents_per_point into v_mode, v_ratio from shows where id = p_show_id;
  if not found then
    raise exception 'show % não encontrado', p_show_id using errcode = 'no_data_found';
  end if;
  -- fora do modo pix o voto não tem peso variável: vale 1, sempre
  if v_mode <> 'pix' then return 1; end if;
  if p_amount_cents <= 0 then return 1; end if;
  return greatest(1, (p_amount_cents / greatest(1, v_ratio))::int);
end $$;

create or replace function cast_free_vote(
  p_round_id uuid, p_candidate_id uuid, p_session_id uuid
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
  if v_show.vote_mode = 'pix' then
    raise exception 'Neste show todo voto passa pelo Pix.' using errcode = 'invalid_parameter_value';
  end if;
  if v_show.free_votes_per_round <= 0 then
    raise exception 'O voto sem pagamento está desligado neste show.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_session from audience_sessions
   where id = p_session_id and show_id = v_show.id;
  if not found then
    raise exception 'sessão inválida para este show' using errcode = 'foreign_key_violation';
  end if;

  -- o portão do Instagram: sem o @ declarado, não vota
  if v_show.vote_mode = 'instagram' and v_session.instagram_handle is null then
    raise exception 'Informe seu @ do Instagram para votar.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from round_candidates where id = p_candidate_id and round_id = p_round_id
  ) then
    raise exception 'candidata não pertence a esta rodada' using errcode = 'foreign_key_violation';
  end if;

  select count(*) into v_usados from votes
   where round_id = p_round_id and session_id = p_session_id and payment_id is null;
  if v_usados >= v_show.free_votes_per_round then
    raise exception 'Você já votou nesta rodada.' using errcode = 'unique_violation';
  end if;

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
    raise exception 'Você já votou nesta rodada.' using errcode = 'unique_violation';
end $$;

grant execute on function cast_free_vote(uuid, uuid, uuid) to anon, authenticated;
grant execute on function compute_vote_weight(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. As RPCs públicas passam a carregar o portão
-- ---------------------------------------------------------------------------

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
      'instagramHandle', v_show.instagram_handle,
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
      'nickname', v_session.nickname, 'freeVotesUsed', v_session.free_votes_used,
      'instagramHandle', v_session.instagram_handle
    )
  );
end $$;

grant execute on function join_show(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. O que o artista leva do show: a lista de quem participou
--
-- É isto que o modo Instagram entrega de fato. Como não há verificação, o valor
-- está no registro — o artista cruza com os próprios seguidores se quiser.
-- ---------------------------------------------------------------------------

create or replace function show_participants(p_show_id uuid)
returns table (instagram_handle text, nickname text, votos int, entrou_em timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_show_owner(p_show_id);
  return query
    select s.instagram_handle,
           s.nickname,
           (select count(*)::int from votes v where v.session_id = s.id
             and v.status = 'confirmed'),
           s.created_at
      from audience_sessions s
     where s.show_id = p_show_id
       and s.instagram_handle is not null
     order by s.created_at;
end $$;

revoke all on function show_participants(uuid) from public;
grant execute on function show_participants(uuid) to authenticated, service_role;
