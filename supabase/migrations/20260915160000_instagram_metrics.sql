-- Vote Play — métricas do portão do Instagram
--
-- O cliente quer saber quantos seguidores ganhou. Começando pela parte
-- desconfortável: NENHUMA API nos dá esse número. Ler seguidores exige a
-- Instagram Graph API com conta Business vinculada a uma página do Facebook e
-- um app da Meta autorizado pelo próprio artista — e ainda assim só do perfil
-- dele. Inventar o número enquanto isso seria pior que não ter.
--
-- O que dá para medir com honestidade é o FUNIL do portão, e ele responde
-- perguntas que o número de seguidores não responde:
--
--   entrou → tocou em "Seguir" → declarou o @ → votou
--
-- Muita gente entrando e pouca tocando em Seguir é problema da tela do portão.
-- Muita gente tocando e pouca declarando é atrito na volta do Instagram. Muita
-- gente declarando e pouca votando é portão caro demais para o que entrega.
--
-- O número de seguidores antes/depois fica em dois campos preenchidos PELO
-- ARTISTA, e a tela do painel diz isso com todas as letras.

-- ---------------------------------------------------------------------------
-- 1. O toque em "Seguir"
-- ---------------------------------------------------------------------------

alter table audience_sessions add column instagram_follow_clicked_at timestamptz;

comment on column audience_sessions.instagram_follow_clicked_at is
  'Quando esta sessão tocou no botão que leva ao perfil do artista. NÃO é prova '
  'de que seguiu — é o topo do funil e o que destrava o voto na interface.';

/**
 * Registra o toque. Idempotente: o primeiro toque é o que conta, e voltar do
 * Instagram e tocar de novo não deve reescrever o horário.
 *
 * De propósito NÃO é pré-requisito de set_session_instagram no servidor. A
 * interface exige o toque antes de liberar o voto, mas travar isso aqui também
 * significaria que uma falha de rede no momento do toque prende a pessoa do
 * lado de fora — num show com wi-fi ruim, isso é pior do que um funil com um
 * degrau impreciso. Se o número de "declarou o @" passar o de "tocou em
 * Seguir", o painel mostra a inversão em vez de escondê-la.
 */
create or replace function mark_instagram_follow_click(p_session_id uuid)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_session audience_sessions;
begin
  update audience_sessions
     set instagram_follow_clicked_at = coalesce(instagram_follow_clicked_at, now()),
         last_seen_at = now()
   where id = p_session_id
  returning * into v_session;

  if not found then
    raise exception 'sessão não encontrada' using errcode = 'no_data_found';
  end if;

  return json_build_object('followClickedAt', v_session.instagram_follow_clicked_at);
end $$;

revoke all on function mark_instagram_follow_click(uuid) from public;
grant execute on function mark_instagram_follow_click(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Seguidores antes e depois — informados pelo artista
-- ---------------------------------------------------------------------------

alter table shows add column instagram_followers_before int
  check (instagram_followers_before is null or instagram_followers_before >= 0);
alter table shows add column instagram_followers_after int
  check (instagram_followers_after is null or instagram_followers_after >= 0);

comment on column shows.instagram_followers_before is
  'Contagem que o ARTISTA informou antes do show. Não é apurada pelo app: '
  'nenhuma API pública devolve o número de seguidores de um perfil.';

-- ---------------------------------------------------------------------------
-- 3. join_show passa a devolver se esta sessão já tocou em "Seguir"
--    (sem isso, recarregar a página faria a pessoa repetir o passo)
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

  select * into v_show from shows where join_code = upper(btrim(p_join_code));

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
-- 4. O funil, para o painel do artista
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
      'voted', (
        select count(distinct v.session_id)
          from votes v
          join rounds r on r.id = v.round_id
         where r.show_id = p_show_id and v.status = 'confirmed'
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

comment on function show_instagram_metrics(uuid) is
  'Funil do portão do Instagram e @ novos. Os seguidores antes/depois são '
  'informados pelo artista, não apurados pelo app.';
