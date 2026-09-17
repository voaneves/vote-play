-- Vote Play — Fase 5.1: fila do repertório.
--
-- O repertório inteiro do show fica votável o tempo todo, e o ranking vira a
-- fila de onde o artista toca. Convive com as rodadas: `vote_mode` continua
-- sendo COMO se participa (pix / instagram / free); a fila é EM QUE se vota.
--
-- Três escolhas que moldam o resto (plan.md, 5.1):
--
-- 1. Apoio, não voto repetido. Uma pessoa apoia ou não apoia cada música
--    (índice único). Sem isso, quem tem paciência define o repertório sozinho.
-- 2. Orçamento por pessoa (`queue_votes_per_session`, padrão 3). Sem ele todo
--    mundo apoia tudo e o ranking fica plano. O apoio VOLTA quando a música é
--    tocada ou tirada da fila, e a pessoa pode retirar um apoio para dar a
--    outra música — senão, num show de 2 h, a plateia gasta os apoios na
--    primeira meia hora e o jogo acaba.
-- 3. Plano Free: o estado da fila vai por RPC própria, só para quem está com a
--    aba aberta, e em duas partes — a lista (título e artista, muda quando o
--    artista toca ou esconde uma música) e os números (pesos e ordem, em
--    arrays de inteiros alinhados à lista). A lista só é reenviada quando muda;
--    os números de 40 músicas cabem em poucas centenas de bytes.
--
-- Pix: no modo `pix` o apoio será pago (Fase 7). Até lá ele é recusado nesse
-- modo, e o front não mostra a aba.

-- ---------------------------------------------------------------------------
-- 1. Configuração e contadores
-- ---------------------------------------------------------------------------

alter table shows add column queue_enabled boolean not null default true;
alter table shows add column queue_votes_per_session int not null default 3
  check (queue_votes_per_session between 1 and 10);

comment on column shows.queue_enabled is
  'Fila do repertório ligada: a plateia apoia músicas e o ranking vira a fila.';
comment on column shows.queue_votes_per_session is
  'Apoios simultâneos por pessoa. Volta quando a música é tocada ou escondida. '
  'Padrão 3 é chute a validar no QA (decisão nº 9).';

alter table show_songs
  add column queue_weight        bigint      not null default 0,
  add column queue_votes         int         not null default 0,
  add column queue_first_vote_at timestamptz,
  add column pinned              boolean     not null default false,
  add column hidden              boolean     not null default false;

comment on column show_songs.pinned is 'Fixada pelo artista no topo da fila.';
comment on column show_songs.hidden is 'Escondida pelo artista: sai da fila, os apoios voltam.';

-- ---------------------------------------------------------------------------
-- 2. Os apoios
-- ---------------------------------------------------------------------------

create table song_votes (
  id           uuid primary key default gen_random_uuid(),
  show_song_id uuid not null references show_songs(id) on delete cascade,
  session_id   uuid not null references audience_sessions(id) on delete cascade,
  payment_id   uuid references payments(id) on delete set null,   -- Fase 7
  weight       int  not null default 1 check (weight > 0),
  status       vote_status not null default 'confirmed',
  created_at   timestamptz not null default now()
);

-- uma pessoa, um apoio por música
create unique index song_votes_one_per_song_session
  on song_votes (show_song_id, session_id) where payment_id is null;
create index song_votes_session on song_votes (session_id);

alter table song_votes enable row level security;

create policy song_votes_owner_read on song_votes
  for select to authenticated
  using (exists (
    select 1 from show_songs ss join shows s on s.id = ss.show_id
     where ss.id = show_song_id and s.owner_id = auth.uid()));

revoke all on song_votes from anon, authenticated;
grant select on song_votes to authenticated;
grant all on song_votes to service_role;

/**
 * Contadores da fila, na mesma transação do apoio — a mesma estratégia de
 * `round_candidates`, pelo mesmo motivo: o ranking é leitura de coluna.
 */
create or replace function apply_song_vote() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'confirmed' then return new; end if;
    update show_songs
       set queue_weight = queue_weight + new.weight,
           queue_votes  = queue_votes + 1,
           queue_first_vote_at = least(coalesce(queue_first_vote_at, 'infinity'::timestamptz), new.created_at)
     where id = new.show_song_id;
    return new;
  end if;

  if old.status <> 'confirmed' then return old; end if;
  update show_songs
     set queue_weight = greatest(0, queue_weight - old.weight),
         queue_votes  = greatest(0, queue_votes - 1),
         queue_first_vote_at = case when queue_votes <= 1 then null else queue_first_vote_at end
   where id = old.show_song_id;
  return old;
end $$;

create trigger song_votes_apply
  after insert or delete on song_votes
  for each row execute function apply_song_vote();

-- O artista edita posição e as travas da fila; contador e status são do banco.
-- Sem isto, a policy de dono deixaria o painel reescrever o próprio ranking
-- com um UPDATE direto, e o status da música fugiria das regras da rodada.
revoke update on show_songs from authenticated;
grant update (position, pinned, hidden) on show_songs to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Apoiar e retirar (plateia)
-- ---------------------------------------------------------------------------

create or replace function set_song_support(
  p_show_song_id uuid,
  p_session_id   uuid,
  p_support      boolean default true
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_song    show_songs;
  v_show    shows;
  v_session audience_sessions;
  v_ativos  int;
begin
  -- o mesmo teto do voto, no mesmo balde: quem martela cai aqui primeiro
  if not check_rate_limit('vote:' || p_session_id,
                          coalesce((select s.vote_rate_limit from show_songs ss
                                     join shows s on s.id = ss.show_id
                                    where ss.id = p_show_song_id), 20),
                          60) then
    raise exception 'Muitos apoios em pouco tempo. Respire e tente de novo.'
      using errcode = 'too_many_connections';
  end if;

  select * into v_song from show_songs where id = p_show_song_id;
  if not found then
    raise exception 'música não encontrada' using errcode = 'no_data_found';
  end if;

  select * into v_show from shows where id = v_song.show_id;
  if v_show.status <> 'live' then
    raise exception 'Este show não está no ar.' using errcode = 'invalid_parameter_value';
  end if;
  if not v_show.queue_enabled then
    raise exception 'A fila do repertório está desligada neste show.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_show.vote_mode = 'pix' then
    raise exception 'Neste show o apoio passa pelo Pix.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_session from audience_sessions
   where id = p_session_id and show_id = v_show.id;
  if not found then
    raise exception 'sessão inválida para este show' using errcode = 'foreign_key_violation';
  end if;
  if v_show.vote_mode = 'instagram' and v_session.instagram_handle is null then
    raise exception 'Informe seu @ do Instagram para votar.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Serializa só as chamadas DESTA sessão: dois toques rápidos não furam o
  -- orçamento, e a casa inteira continua apoiando em paralelo.
  perform pg_advisory_xact_lock(hashtextextended('song_support:' || p_session_id::text, 0));

  if p_support then
    -- antes de olhar se já apoiou: repetir o toque numa música que acabou de
    -- ser tocada tem de dizer isso, não fingir que deu certo
    if v_song.hidden or v_song.status <> 'available' then
      raise exception 'Essa música não está aberta para apoio agora.'
        using errcode = 'invalid_parameter_value';
    end if;

    if not exists (select 1 from song_votes
                    where show_song_id = p_show_song_id
                      and session_id = p_session_id
                      and payment_id is null) then
      select count(*) into v_ativos
        from song_votes sv join show_songs ss on ss.id = sv.show_song_id
       where sv.session_id = p_session_id
         and ss.status in ('available', 'candidate', 'queued') and not ss.hidden;

      if v_ativos >= v_show.queue_votes_per_session then
        raise exception 'Seus apoios acabaram. Tire um apoio para dar a outra música.'
          using errcode = 'check_violation';
      end if;

      insert into song_votes (show_song_id, session_id, weight, status)
      values (p_show_song_id, p_session_id, 1, 'confirmed');

      update audience_sessions set last_seen_at = now() where id = p_session_id;
    end if;
  else
    delete from song_votes
     where show_song_id = p_show_song_id
       and session_id = p_session_id
       and payment_id is null;
  end if;

  select count(*) into v_ativos
    from song_votes sv join show_songs ss on ss.id = sv.show_song_id
   where sv.session_id = p_session_id
     and ss.status in ('available', 'candidate', 'queued') and not ss.hidden;

  return json_build_object(
    'supported', p_support,
    'supportsLeft', greatest(0, v_show.queue_votes_per_session - v_ativos)
  );
end $$;

revoke all on function set_song_support(uuid, uuid, boolean) from public;
grant execute on function set_song_support(uuid, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Estado da fila (plateia e telão)
--
-- Formato compacto de propósito (plano Free, egress):
--   list     [{id, title, artistName}]  — só quando p_list_version não bate
--   weights  [int]                      — alinhado a list
--   flags    [int]                      — 0 disponível, 1 na rodada, 2 escolhida; +4 fixada
--   order    [índice]                   — ranking, desempate já resolvido aqui
--   mine     [índice]                   — onde ESTA sessão apoiou
-- ---------------------------------------------------------------------------

create or replace function get_repertoire_state(
  p_show_id      uuid,
  p_session_id   uuid default null,
  p_list_version text default null,
  p_version      text default null
) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_show         shows;
  v_list         jsonb;
  v_weights      jsonb;
  v_flags        jsonb;
  v_order        jsonb;
  v_mine         jsonb;
  v_ativos       int := 0;
  v_dyn          jsonb;
  v_list_version text;
  v_version      text;
  v_out          jsonb;
begin
  select * into v_show from shows
   where id = p_show_id and status in ('live', 'paused', 'ended', 'cancelled');
  if not found then
    raise exception 'show indisponível' using errcode = 'no_data_found';
  end if;

  if v_show.queue_enabled then
    with visiveis as (
      select ss.id, ss.status, ss.pinned, ss.queue_weight, ss.queue_first_vote_at,
             s.title, s.artist_name,
             (row_number() over (order by ss.created_at, ss.id) - 1)::int as idx
        from show_songs ss join songs s on s.id = ss.song_id
       where ss.show_id = p_show_id
         and not ss.hidden
         and ss.status in ('available', 'candidate', 'queued')
    )
    select
      coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'artistName', v.artist_name)
                         order by v.idx), '[]'::jsonb),
      coalesce(jsonb_agg(v.queue_weight order by v.idx), '[]'::jsonb),
      coalesce(jsonb_agg((case v.status when 'available' then 0 when 'candidate' then 1 else 2 end)
                         + (case when v.pinned then 4 else 0 end) order by v.idx), '[]'::jsonb),
      coalesce(jsonb_agg(v.idx order by (v.status = 'queued') desc, v.pinned desc, v.queue_weight desc,
                         v.queue_first_vote_at asc nulls last, v.idx),
               '[]'::jsonb),
      coalesce(jsonb_agg(v.idx order by v.idx)
               filter (where p_session_id is not null and exists (
                 select 1 from song_votes sv
                  where sv.show_song_id = v.id and sv.session_id = p_session_id)), '[]'::jsonb)
      into v_list, v_weights, v_flags, v_order, v_mine
      from visiveis v;

    if p_session_id is not null then
      select count(*) into v_ativos
        from song_votes sv join show_songs ss on ss.id = sv.show_song_id
       where sv.session_id = p_session_id and ss.show_id = p_show_id
         and ss.status in ('available', 'candidate', 'queued') and not ss.hidden;
    end if;
  else
    v_list := '[]'; v_weights := '[]'; v_flags := '[]'; v_order := '[]'; v_mine := '[]';
  end if;

  v_list_version := left(md5(v_list::text), 16);
  v_dyn := jsonb_build_object(
    'enabled',    v_show.queue_enabled,
    'showStatus', v_show.status,
    'perSession', v_show.queue_votes_per_session,
    'left',       greatest(0, v_show.queue_votes_per_session - v_ativos),
    'weights',    v_weights,
    'flags',      v_flags,
    'order',      v_order,
    'mine',       v_mine
  );
  v_version := left(md5(v_list_version || v_dyn::text), 16);

  if p_version is not null and p_version = v_version then
    return json_build_object('serverTime', now(), 'version', v_version, 'unchanged', true);
  end if;

  v_out := v_dyn || jsonb_build_object(
    'serverTime', now(), 'version', v_version, 'listVersion', v_list_version);
  if p_list_version is distinct from v_list_version then
    v_out := v_out || jsonb_build_object('list', v_list);
  end if;
  return v_out::json;
end $$;

revoke all on function get_repertoire_state(uuid, uuid, text, text) from public;
grant execute on function get_repertoire_state(uuid, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tocada (painel)
--
-- Tocada sai da fila e não volta (decisão nº 11, padrão até o QA dizer outra
-- coisa). `p_played = false` desfaz um toque errado no painel.
-- ---------------------------------------------------------------------------

create or replace function set_song_played(p_show_song_id uuid, p_played boolean default true)
returns show_songs
language plpgsql security definer set search_path = public as $$
declare
  v show_songs;
begin
  select * into v from show_songs where id = p_show_song_id for update;
  if not found then
    raise exception 'música não encontrada' using errcode = 'no_data_found';
  end if;
  perform assert_show_owner(v.show_id);

  if p_played then
    if v.status = 'candidate' then
      raise exception 'Essa música está numa rodada aberta. Apure a rodada antes de marcar como tocada.'
        using errcode = 'invalid_parameter_value';
    end if;
    if v.status <> 'played' then
      update show_songs set status = 'played', played_at = now()
       where id = v.id returning * into v;
      update songs set times_played = times_played + 1 where id = v.song_id;
      insert into show_events (show_id, actor, type, payload)
      values (v.show_id, 'artist', 'song_played',
              jsonb_build_object('show_song_id', v.id, 'song_id', v.song_id,
                                 'queue_weight', v.queue_weight));
    end if;
  elsif v.status = 'played' then
    update show_songs set status = 'available', played_at = null
     where id = v.id returning * into v;
    update songs set times_played = greatest(0, times_played - 1) where id = v.song_id;
    insert into show_events (show_id, actor, type, payload)
    values (v.show_id, 'artist', 'song_unplayed', jsonb_build_object('show_song_id', v.id));
  end if;

  return v;
end $$;

revoke all on function set_song_played(uuid, boolean) from public;
grant execute on function set_song_played(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. O join passa a dizer se a fila existe
-- ---------------------------------------------------------------------------

create or replace function join_show(
  p_join_code text, p_device_hash text, p_nickname text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_show    shows;
  v_session audience_sessions;
  v_ip      text;
  v_nova    boolean;
begin
  if p_device_hash is null or length(btrim(p_device_hash)) < 8 then
    raise exception 'identificador de dispositivo inválido' using errcode = 'invalid_parameter_value';
  end if;

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

  v_ip := request_ip_hash(v_show.id::text);

  -- O limite vale para ENTRADA NOVA, não para quem volta. Recarregar a página
  -- num wi-fi ruim é o caso comum, e não pode esbarrar em rate limit.
  v_nova := not exists (
    select 1 from audience_sessions
     where show_id = v_show.id and device_hash = p_device_hash
  );

  if v_nova and v_ip is not null then
    if not check_rate_limit('join:' || v_show.id || ':' || v_ip, v_show.join_rate_limit, 60) then
      raise exception 'Muitas entradas deste local em pouco tempo. Tente de novo em um minuto.'
        using errcode = 'too_many_connections';
    end if;
  end if;

  insert into audience_sessions (show_id, device_hash, nickname, ip_hash)
  values (v_show.id, p_device_hash, nullif(btrim(coalesce(p_nickname, '')), ''), v_ip)
  on conflict (show_id, device_hash) do update
    set last_seen_at = now(),
        nickname = coalesce(excluded.nickname, audience_sessions.nickname),
        ip_hash  = coalesce(excluded.ip_hash, audience_sessions.ip_hash)
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
      'directRequestPriceCents', v_show.direct_request_price_cents,
      'queueEnabled', v_show.queue_enabled,
      'queueVotesPerSession', v_show.queue_votes_per_session
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
-- 7. Funil e participantes contam o apoio como participação
-- ---------------------------------------------------------------------------

create or replace function show_instagram_metrics(p_show_id uuid)
returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_show shows;
begin
  perform assert_show_owner(p_show_id);

  select * into v_show from shows where id = p_show_id;
  if not found then
    raise exception 'show % não encontrado', p_show_id using errcode = 'no_data_found';
  end if;

  return json_build_object(
    'funnel', json_build_object(
      'entered', (
        select count(*) from audience_sessions where show_id = p_show_id
      ),
      'clicked', (
        select count(*) from audience_sessions
         where show_id = p_show_id and instagram_follow_clicked_at is not null
      ),
      'declared', (
        select count(*) from audience_sessions
         where show_id = p_show_id and instagram_handle is not null
      ),
      -- "votou" = participou do jogo: voto em rodada OU apoio na fila. Num show
      -- só de fila, contar apenas rodada zeraria o último degrau do funil.
      'voted', (
        select count(*) from (
          select v.session_id
            from votes v join rounds r on r.id = v.round_id
           where r.show_id = p_show_id and v.status = 'confirmed'
          union
          select sv.session_id
            from song_votes sv join show_songs ss on ss.id = sv.show_song_id
           where ss.show_id = p_show_id and sv.status = 'confirmed'
        ) participantes
      )
    ),

    -- @ que nunca apareceram em show ANTERIOR deste mesmo artista.
    -- É o mais perto de "público novo" que dá para calcular com verdade, e o
    -- número é nosso — não depende de nenhuma API da Meta.
    'newHandles', (
      select count(*) from audience_sessions atual
       where atual.show_id = p_show_id
         and atual.instagram_handle is not null
         and not exists (
           select 1
             from audience_sessions antes
             join shows s on s.id = antes.show_id
            where s.owner_id = v_show.owner_id
              and s.id <> p_show_id
              and s.created_at < v_show.created_at
              and antes.instagram_handle = atual.instagram_handle
         )
    ),

    'followers', json_build_object(
      'before', v_show.instagram_followers_before,
      'after',  v_show.instagram_followers_after
    )
  );
end $$;

revoke all on function show_instagram_metrics(uuid) from public;
grant execute on function show_instagram_metrics(uuid) to authenticated, service_role;


drop function if exists show_participants(uuid);

create or replace function show_participants(p_show_id uuid)
returns table (instagram_handle text, nickname text, votos int, apoios int, entrou_em timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform assert_show_owner(p_show_id);
  return query
    select s.instagram_handle,
           s.nickname,
           (select count(*)::int from votes v where v.session_id = s.id
             and v.status = 'confirmed'),
           (select count(*)::int from song_votes sv where sv.session_id = s.id
             and sv.status = 'confirmed'),
           s.created_at
      from audience_sessions s
     where s.show_id = p_show_id
       and s.instagram_handle is not null
     order by s.created_at;
end $$;

revoke all on function show_participants(uuid) from public;
grant execute on function show_participants(uuid) to authenticated, service_role;
