-- Vote Play — "não encontrado" deixa de mentir
--
-- join_show devolvia a MESMA mensagem para dois problemas opostos:
--   1. o código não existe (erro de digitação, show de outro artista);
--   2. o código existe, mas o show está em rascunho / já terminou.
--
-- O caso 2 é o comum — o artista cria o show, abre o QR e testa antes de
-- colocar no ar. Ouvir "código não encontrado" para um código que ele acabou
-- de gerar manda ele caçar o bug no lugar errado. Aconteceu de verdade em
-- 15/09 e custou uma tarde.
--
-- A distinção é segura de expor: quem tem o código já sabe que o show existe,
-- então dizer "ainda não está no ar" não revela nada a mais. Continuamos sem
-- revelar NADA sobre códigos que não existem.

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

  -- busca SEM filtrar por status, para poder explicar o porquê
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

  -- sobram 'live' e 'paused': pausado continua entrando, porque a pessoa que
  -- chega no intervalo precisa ver a tela e não um erro

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
      'instagramHandle', v_session.instagram_handle
    )
  );
end $$;

revoke all on function join_show(text, text, text) from public;
grant execute on function join_show(text, text, text) to anon, authenticated;
