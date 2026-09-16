-- Vote Play — garante que as correções de 15/09 estão no schema, não só no histórico.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- `supabase migration list` mostra 20260915170000 a …173000 como aplicadas no
-- remoto, mas `supabase db push` nunca chegou a executá-las: a primeira
-- tentativa morreu em "Initialising login role" e a seguinte já encontrou o
-- histórico preenchido. O `supabase link` refeito em 16/09 registrou as
-- migrations locais na tabela de histórico sem rodar o SQL.
--
-- Histórico e schema podem discordar, e quem manda é o schema. Esta migration
-- pergunta ao catálogo do Postgres o que de fato existe e aplica só o que
-- faltar — então é segura nos dois cenários, e diz em voz alta o que encontrou.
--
-- Cada bloco é idempotente. Rodar de novo não faz nada além de imprimir
-- "já estava aplicado".

-- ---------------------------------------------------------------------------
-- 1. tick_rounds() escopado por auth.uid()   (era 20260915170000)
--
-- `create or replace` já é idempotente: o estado final é o mesmo tenha ela
-- rodado ou não. O `if` aqui existe só para o relatório.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'tick_rounds'
       and pg_get_functiondef(p.oid) like '%v_uid%'
  ) then
    raise notice '1/5 tick_rounds  : já estava escopada';
  else
    raise notice '1/5 tick_rounds  : NÃO estava aplicada — corrigindo agora';
  end if;
end $$;

create or replace function tick_rounds() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_touched int := 0;
begin
  for v_id in
    select r.id
      from rounds r
      join shows s on s.id = r.show_id
     where r.status = 'open'
       and r.closes_at <= now()
       and (v_uid is null or s.owner_id = v_uid)
     order by r.closes_at
  loop
    perform close_round_voting(v_id);
    v_touched := v_touched + 1;
  end loop;

  for v_id in
    select r.id
      from rounds r
      join shows s on s.id = r.show_id
     where r.status = 'closing'
       and (v_uid is null or s.owner_id = v_uid)
     order by r.closed_at nulls first
  loop
    perform settle_round(v_id);
    v_touched := v_touched + 1;
  end loop;

  return v_touched;
end $$;

comment on function tick_rounds() is
  'Fecha a votação no horário e apura o que já pode ser apurado. Chamada pelo '
  'pg_cron (varre tudo) e pelo painel do artista (varre só os shows dele).';

grant execute on function tick_rounds() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. generate_join_code() reservando o código desde o rascunho
--                                            (era 20260915171000, parte 1)
-- ---------------------------------------------------------------------------

create or replace function generate_join_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes  bytea;
  code     text;
  attempt  int := 0;
begin
  loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');

    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;

    exit when not exists (
      select 1 from shows
       where join_code = code
         and status in ('draft', 'ready', 'live', 'paused')
    );

    attempt := attempt + 1;
    if attempt >= 10 then
      raise exception 'não foi possível gerar um código de show livre após % tentativas', attempt;
    end if;
  end loop;
  return code;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Índice de join_code cobrindo rascunho    (era 20260915171000, parte 2)
--
-- Aqui a idempotência importa de verdade: `create unique index` sem guarda
-- quebraria a migration inteira se ela já tivesse rodado.
-- ---------------------------------------------------------------------------

do $$
declare
  r      record;
  v_novo text;
  v_n    int := 0;
begin
  if to_regclass('public.shows_join_code_claimed') is not null then
    raise notice '3/5 índice       : já estava aplicado';
    return;
  end if;

  raise notice '3/5 índice       : NÃO estava aplicado — corrigindo agora';

  -- desempata códigos repetidos entre shows ainda "vivos" antes de apertar
  for r in
    select id, join_code
      from (
        select id, join_code,
               row_number() over (partition by join_code order by created_at, id) as n
          from shows
         where status in ('draft', 'ready', 'live', 'paused')
      ) t
     where n > 1
  loop
    v_novo := generate_join_code();
    update shows set join_code = v_novo where id = r.id;
    v_n := v_n + 1;
    raise notice '      código % estava repetido; show % passou a usar %',
      r.join_code, r.id, v_novo;
  end loop;

  if v_n > 0 then
    raise notice '      % código(s) desempatado(s)', v_n;
  end if;

  drop index if exists shows_join_code_active;
  create unique index shows_join_code_claimed
    on shows (join_code) where status in ('draft', 'ready', 'live', 'paused');

  comment on index shows_join_code_claimed is
    'Código único entre shows que ainda podem receber gente — rascunho incluído, '
    'porque o artista imprime o QR antes de colocar o show no ar.';
end $$;

-- ---------------------------------------------------------------------------
-- 4. join_show() escolhendo deterministicamente (era 20260915171000, parte 3)
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

  -- busca SEM filtrar por status, para poder explicar o porquê — mas com
  -- ordem explícita, para que "o show no ar" sempre ganhe do homônimo velho
  select * into v_show
    from shows
   where join_code = upper(btrim(p_join_code))
   order by case status
              when 'live'      then 0
              when 'paused'    then 1
              when 'ready'     then 2
              when 'draft'     then 3
              when 'ended'     then 4
              else                  5
            end,
            created_at desc
   limit 1;

  if not found then
    raise exception 'Código do show não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_show.status in ('draft', 'ready') then
    raise exception 'Este show ainda não está no ar. O artista precisa abri-lo no painel.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_show.status in ('ended', 'cancelled') then
    raise exception 'Este show já terminou.' using errcode = 'invalid_parameter_value';
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
      'nickname', v_session.nickname,
      'freeVotesUsed', v_session.free_votes_used,
      'instagramHandle', v_session.instagram_handle,
      'followClickedAt', v_session.instagram_follow_clicked_at
    )
  );
end $$;

revoke all on function join_show(text, text, text) from public;
grant execute on function join_show(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. free_votes_per_round limitado a 0..1      (era 20260915172000)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shows_free_votes_per_round_range') then
    raise notice '4/5 check voto   : já estava aplicado';
    return;
  end if;

  raise notice '4/5 check voto   : NÃO estava aplicado — corrigindo agora';

  update shows set free_votes_per_round = 1 where free_votes_per_round > 1;

  alter table shows add constraint shows_free_votes_per_round_range
    check (free_votes_per_round between 0 and 1);
end $$;

comment on column shows.free_votes_per_round is
  'Voto sem pagamento por dispositivo em CADA rodada: 1 liga, 0 desliga. '
  'O teto de 1 não é preferência e sim o que o índice único '
  'votes_one_free_per_session_round garante.';

-- ---------------------------------------------------------------------------
-- 6. expire_stale_payments() contando pagamentos (era 20260915173000)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'expire_stale_payments'
       and pg_get_functiondef(p.oid) like '%pedidos as%'
  ) then
    raise notice '5/5 expire       : já estava aplicada';
  else
    raise notice '5/5 expire       : NÃO estava aplicada — corrigindo agora';
  end if;
end $$;

create or replace function expire_stale_payments() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  with expired as (
    update payments set status = 'expired'
     where status in ('created', 'pending')
       and expires_at is not null
       and expires_at <= now()
    returning id
  ),
  votos as (
    update votes set status = 'expired'
     where payment_id in (select id from expired)
       and status = 'pending'
    returning 1
  ),
  pedidos as (
    update direct_requests set status = 'refunded'
     where status = 'pending_payment'
       and payment_id in (select id from expired)
    returning 1
  )
  select count(*)::int into v_count from expired;

  return v_count;
end $$;

comment on function expire_stale_payments() is
  'Cobranças vencidas viram expired e derrubam junto o voto pendente e o '
  'pedido direto não pago. Devolve quantos PAGAMENTOS expiraram nesta passada.';

grant execute on function expire_stale_payments() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Relatório final
-- ---------------------------------------------------------------------------

do $$
declare
  v_tick   boolean;
  v_indice boolean;
  v_check  boolean;
  v_expire boolean;
  v_shows  int;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'tick_rounds'
       and pg_get_functiondef(p.oid) like '%v_uid%') into v_tick;

  v_indice := to_regclass('public.shows_join_code_claimed') is not null;

  select exists (select 1 from pg_constraint
    where conname = 'shows_free_votes_per_round_range') into v_check;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'expire_stale_payments'
       and pg_get_functiondef(p.oid) like '%pedidos as%') into v_expire;

  select count(*) into v_shows from shows
   where join_code in ('PAGAR1', 'GRAM99', 'FREE01');

  raise notice '';
  raise notice '=== estado final do schema ===';
  raise notice '  tick_rounds escopada ........ %', v_tick;
  raise notice '  índice join_code (rascunho) . %', v_indice;
  raise notice '  check free_votes_per_round ... %', v_check;
  raise notice '  expire_stale_payments ....... %', v_expire;
  raise notice '  shows de demonstração ....... % de 3', v_shows;

  if not (v_tick and v_indice and v_check and v_expire) then
    raise exception 'alguma correção não ficou aplicada — não deveria acontecer';
  end if;

  if v_shows < 3 then
    raise notice '';
    raise notice '  Faltam shows de demonstração. Rode:';
    raise notice '    supabase db push --include-seed';
    raise notice '  (ou cole supabase/seed.sql; ele é idempotente)';
  end if;
  raise notice '';
end $$;
