-- Vote Play — rate limit no banco (Fase 4).
--
-- O QUE ISTO RESOLVE, E O QUE NÃO RESOLVE — leia antes de confiar.
--
-- Hoje a única barreira do voto grátis é o índice
-- `votes_one_free_per_session_round`: um voto por sessão por rodada. Só que
-- `join_show` cria uma sessão nova para cada `device_hash` novo, e o
-- device_hash é calculado no navegador. Uma aba anônima = um device_hash novo =
-- uma sessão nova = mais um voto. O índice não é furado; ele é contornado.
--
-- Isto aqui NÃO fecha esse buraco. Nada que rode só no banco fecha: quem
-- controla o cliente controla o device_hash. O que este arquivo faz é
-- **encarecer o abuso casual** e construir a peça que a Fase 7 vai precisar de
-- qualquer jeito (o plano já prevê "rate limit por session_id e por ip_hash,
-- ex.: 10 intents/min" para `create_vote_intent`, onde o custo de uma fraude
-- passa a ser dinheiro de verdade).
--
-- O portão honesto contra bot continua sendo um desafio no cliente
-- (Cloudflare Turnstile). Este arquivo não substitui isso, e o painel não deve
-- dizer que substitui.

-- ---------------------------------------------------------------------------
-- 1. O balde de batidas
--
-- Janela deslizante em vez de janela fixa: com janela fixa, 10 por minuto vira
-- 20 em dois segundos se as batidas caírem em cima da virada do minuto.
-- ---------------------------------------------------------------------------

create table rate_limit_hits (
  bucket text        not null,
  hit_at timestamptz not null default now()
);

-- desc porque toda consulta pergunta "quantas batidas recentes neste balde"
create index rate_limit_hits_bucket on rate_limit_hits (bucket, hit_at desc);

comment on table rate_limit_hits is
  'Batidas de rate limit, em janela deslizante. Efêmera: purge_rate_limits() '
  'apaga o que envelheceu. Não é trilha de auditoria — para isso existe show_events.';

alter table rate_limit_hits enable row level security;
-- sem policy nenhuma: nem anon nem authenticated enxergam. Só service_role e
-- as funções SECURITY DEFINER, que rodam como dono.

/**
 * Registra uma batida e diz se ela cabe no limite.
 *
 * Devolve true quando PERMITIDO. A batida é registrada mesmo quando recusada:
 * quem está martelando continua contando, então a punição não expira enquanto
 * o martelo bate — que é o comportamento que se quer de um rate limit.
 */
create or replace function check_rate_limit(
  p_bucket           text,
  p_limite           int,
  p_janela_segundos  int
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_recentes int;
begin
  if p_bucket is null or btrim(p_bucket) = '' then
    return true;   -- sem chave não há o que limitar (ex.: IP indisponível)
  end if;

  select count(*) into v_recentes
    from rate_limit_hits
   where bucket = p_bucket
     and hit_at > now() - make_interval(secs => p_janela_segundos);

  insert into rate_limit_hits (bucket) values (p_bucket);

  return v_recentes < p_limite;
end $$;

comment on function check_rate_limit(text, int, int) is
  'Janela deslizante. true = permitido. A batida conta mesmo quando recusada.';

/** Limpeza. Chamada pelo pg_cron junto com as outras tarefas de minuto. */
create or replace function purge_rate_limits(p_manter_segundos int default 3600)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  delete from rate_limit_hits
   where hit_at < now() - make_interval(secs => p_manter_segundos);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Nenhuma das duas é chamável de fora: elas são chamadas de dentro de outras
-- funções SECURITY DEFINER, que rodam como dono e por isso têm execute.
revoke all on function check_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function purge_rate_limits(int)            from public, anon, authenticated;
grant execute on function check_rate_limit(text, int, int) to service_role;
grant execute on function purge_rate_limits(int)           to service_role;

-- ---------------------------------------------------------------------------
-- 2. O ip_hash, que existia e nunca foi preenchido
--
-- `audience_sessions.ip_hash` está no schema desde a Fase 1 com o comentário
-- "hash salgado, para rate limit. Nunca IP puro (LGPD)" — e nunca recebeu
-- valor, porque `join_show` não o escrevia. Coluna que ninguém preenche é
-- documentação mentindo sobre o que o sistema faz.
--
-- O IP chega pelo PostgREST em `request.headers`. Fora do Supabase (o harness
-- de teste, psql) esse setting não existe: a função devolve null, e quem chama
-- trata null como "sem limite por IP" em vez de quebrar.
--
-- SALGADO COM O ID DO SHOW, de propósito: o mesmo IP em dois shows gera dois
-- hashes diferentes. Serve para limitar dentro de um show e não serve para
-- rastrear alguém entre shows — que é exatamente o limite que a seção 11 do
-- plano (LGPD) pede.
-- ---------------------------------------------------------------------------

create or replace function request_ip_hash(p_salt text)
returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_headers json;
  v_xff     text;
  v_ip      text;
begin
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    return null;      -- não estamos atrás do PostgREST
  end;

  if v_headers is null then
    return null;
  end if;

  v_xff := v_headers ->> 'x-forwarded-for';
  if v_xff is null or btrim(v_xff) = '' then
    v_ip := v_headers ->> 'cf-connecting-ip';
  else
    -- Proxies ACRESCENTAM à direita, então o valor mais à direita é o que o
    -- proxy mais próximo de nós escreveu — o único que o cliente não consegue
    -- forjar. Pegar o primeiro (o costume em tutorial) seria confiar num
    -- cabeçalho que qualquer um manda.
    v_ip := btrim(split_part(v_xff, ',', array_length(string_to_array(v_xff, ','), 1)));
  end if;

  if v_ip is null or btrim(v_ip) = '' then
    return null;
  end if;

  return encode(sha256(convert_to(coalesce(p_salt, '') || '|' || v_ip, 'utf8')), 'hex');
end $$;

comment on function request_ip_hash(text) is
  'Hash salgado do IP de origem, para rate limit. Nunca guarda o IP em si, e o '
  'sal por show impede cruzar a mesma pessoa entre eventos diferentes.';

revoke all on function request_ip_hash(text) from public, anon, authenticated;
grant execute on function request_ip_hash(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Os limites, configuráveis por show
--
-- Números escolhidos para não atrapalhar o caso real: 80 pessoas escaneando o
-- QR ao mesmo tempo é o que ACONTECE num show, não um ataque. Por isso o limite
-- de entrada é por IP (não por show) e generoso: uma casa inteira atrás do
-- mesmo NAT cabe em 30 entradas por minuto, e quem estoura isso não é plateia.
-- ---------------------------------------------------------------------------

alter table shows add column join_rate_limit int not null default 30
  check (join_rate_limit between 1 and 1000);
alter table shows add column vote_rate_limit int not null default 20
  check (vote_rate_limit between 1 and 1000);

comment on column shows.join_rate_limit is
  'Entradas novas por minuto, por IP. Atrás de um NAT a casa inteira divide o '
  'mesmo IP, então o número é alto de propósito.';
comment on column shows.vote_rate_limit is
  'Votos por minuto, por sessão. Uma pessoa votando normalmente não chega perto.';

-- ---------------------------------------------------------------------------
-- 4. join_show passa a gravar o ip_hash e a respeitar o limite
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
-- 5. cast_free_vote ganha o mesmo teto, por sessão
--
-- O limite por rodada continua sendo o índice único — isto aqui é contra o
-- martelo: script batendo na RPC gasta conexão e CPU do banco mesmo quando
-- cada chamada é recusada. Barrar antes da validação cara é o ponto.
-- ---------------------------------------------------------------------------

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
  -- primeiro o mais barato: quem está martelando cai aqui
  if not check_rate_limit('vote:' || p_session_id,
                          coalesce((select vote_rate_limit from shows s
                                     join rounds r on r.show_id = s.id
                                    where r.id = p_round_id), 20),
                          60) then
    raise exception 'Muitos votos em pouco tempo. Respire e tente de novo.'
      using errcode = 'too_many_connections';
  end if;

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

-- ---------------------------------------------------------------------------
-- 6. O que o artista vê: sessões suspeitas no mesmo IP
--
-- Sem isso o rate limit seria invisível — e o artista precisa conseguir olhar
-- a noite e dizer "isso aqui não foi plateia". Só o dono do show enxerga, e o
-- hash não revela o IP nem permite cruzar com outro show.
-- ---------------------------------------------------------------------------

create or replace function show_suspicious_sessions(p_show_id uuid)
returns table (ip_hash_curto text, sessoes int, votos int, primeira timestamptz, ultima timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_show_owner(p_show_id);
  return query
    select left(s.ip_hash, 12) as ip_hash_curto,
           count(*)::int,
           (select count(*)::int from votes v
             where v.session_id in (select id from audience_sessions a2
                                     where a2.show_id = p_show_id
                                       and a2.ip_hash = s.ip_hash)
               and v.status = 'confirmed'),
           min(s.created_at),
           max(s.last_seen_at)
      from audience_sessions s
     where s.show_id = p_show_id
       and s.ip_hash is not null
     group by s.ip_hash
    having count(*) > 1
     order by count(*) desc;
end $$;

revoke all on function show_suspicious_sessions(uuid) from public;
grant execute on function show_suspicious_sessions(uuid) to authenticated, service_role;

comment on function show_suspicious_sessions(uuid) is
  'Agrupa sessões por IP salgado: várias sessões no mesmo IP pode ser abuso ou '
  'pode ser a família toda no mesmo wi-fi. É pista para o artista olhar, nunca '
  'veredito — o app não bloqueia ninguém com base nisto.';

-- ---------------------------------------------------------------------------
-- 7. Agendamento da limpeza
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron ausente — agende purge_rate_limits() por fora';
    return;
  end if;
  perform cron.schedule('vote-play-purge-rate-limits', '*/10 * * * *',
                        'select public.purge_rate_limits();');
  raise notice 'pg_cron: purge_rate_limits a cada 10 minutos';
exception when others then
  raise warning 'não foi possível agendar purge_rate_limits (%)', sqlerrm;
end $$;
