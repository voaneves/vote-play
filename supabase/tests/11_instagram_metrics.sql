-- Funil do portão do Instagram.
--
-- Os @ daqui levam prefixo `funil.` de propósito: "público novo" é calculado
-- contra TODOS os shows anteriores do mesmo artista, então reaproveitar um @ de
-- outro arquivo de teste faz este contar errado — e o erro parece bug da função.
-- O risco aqui não é cálculo errado, é número que MENTE: se "declarou o @"
-- contar gente que não declarou, o artista toma decisão sobre o portão com
-- base em ficção.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid; v_code text; v_round rounds; v_ids uuid[]; v_cand uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_json json; v_n int;
begin
  insert into shows (owner_id, title, status, vote_mode, instagram_handle)
  values (v_owner, 'Show do Funil', 'live', 'instagram', 'banda.oficial')
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id)
  select v_show, id from songs where owner_id = v_owner limit 2;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);
  select id into v_cand from round_candidates where round_id = v_round.id limit 1;

  set local role anon;
  -- quatro pessoas, cada uma parando num degrau diferente do funil
  v_s1 := (join_show(v_code, 'funil-so-entrou-0001') -> 'session' ->> 'id')::uuid;  -- só entrou
  v_s2 := (join_show(v_code, 'funil-so-tocou-00002') -> 'session' ->> 'id')::uuid;  -- tocou
  v_s3 := (join_show(v_code, 'funil-declarou-0003') -> 'session' ->> 'id')::uuid;   -- tocou + declarou
  v_s4 := (join_show(v_code, 'funil-votou-000004') -> 'session' ->> 'id')::uuid;    -- tudo

  perform mark_instagram_follow_click(v_s2);
  perform mark_instagram_follow_click(v_s3);
  perform mark_instagram_follow_click(v_s4);
  perform set_session_instagram(v_s3, '@funil.pessoa.um');
  perform set_session_instagram(v_s4, 'funil_pessoa_dois');
  perform cast_free_vote(v_round.id, v_cand, v_s4);

  -- tocar duas vezes não pode contar duas: o primeiro toque é o que vale
  perform mark_instagram_follow_click(v_s4);

  reset role;
  v_json := show_instagram_metrics(v_show);

  v_n := (v_json -> 'funnel' ->> 'entered')::int;
  assert v_n = 4, format('entrou: esperava 4, veio %s', v_n);
  v_n := (v_json -> 'funnel' ->> 'clicked')::int;
  assert v_n = 3, format('tocou em Seguir: esperava 3, veio %s', v_n);
  v_n := (v_json -> 'funnel' ->> 'declared')::int;
  assert v_n = 2, format('declarou o @: esperava 2, veio %s', v_n);
  v_n := (v_json -> 'funnel' ->> 'voted')::int;
  assert v_n = 1, format('votou: esperava 1, veio %s', v_n);

  -- primeiro show do artista com estes @: os dois são novos
  v_n := (v_json ->> 'newHandles')::int;
  assert v_n = 2, format('@ novos: esperava 2, veio %s', v_n);

  -- seguidores nascem nulos, porque quem informa é o artista
  assert v_json -> 'followers' ->> 'before' is null, 'seguidores antes deveria nascer nulo';

  raise notice 'OK — funil do Instagram conta cada degrau, e toque repetido não duplica';
end $$;

-- @ que já apareceu em show anterior do mesmo artista não é público novo.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_antigo uuid; v_novo uuid; v_c1 text; v_c2 text; v_s uuid; v_json json; v_n int;
begin
  -- show antigo, criado para trás no tempo
  insert into shows (owner_id, title, status, vote_mode, instagram_handle, created_at)
  values (v_owner, 'Show Antigo', 'live', 'instagram', 'banda.oficial', now() - interval '30 days')
  returning id, join_code into v_antigo, v_c1;

  insert into shows (owner_id, title, status, vote_mode, instagram_handle)
  values (v_owner, 'Show Novo', 'live', 'instagram', 'banda.oficial')
  returning id, join_code into v_novo, v_c2;

  set local role anon;
  v_s := (join_show(v_c1, 'reincidente-antes-01') -> 'session' ->> 'id')::uuid;
  perform set_session_instagram(v_s, 'funil.reincidente');

  -- a mesma pessoa volta no show novo, e mais uma estreante
  v_s := (join_show(v_c2, 'reincidente-depois-1') -> 'session' ->> 'id')::uuid;
  perform set_session_instagram(v_s, 'funil.reincidente');
  v_s := (join_show(v_c2, 'estreante-no-show-2') -> 'session' ->> 'id')::uuid;
  perform set_session_instagram(v_s, 'funil.estreante');

  reset role;
  v_json := show_instagram_metrics(v_novo);
  v_n := (v_json ->> 'newHandles')::int;
  assert v_n = 1, format('só a estreante é pública nova: esperava 1, veio %s', v_n);

  raise notice 'OK — @ repetido de show anterior não conta como público novo';
end $$;

-- O funil é do dono. Nem outro artista, nem a plateia.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_outro uuid := '22222222-2222-4222-8222-222222222222';
  v_show  uuid;
begin
  insert into shows (owner_id, title, status, vote_mode, instagram_handle)
  values (v_owner, 'Funil Alheio', 'live', 'instagram', 'banda.oficial')
  returning id into v_show;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform show_instagram_metrics(v_show);

  perform set_config('request.jwt.claim.sub', v_outro::text, true);
  begin
    perform show_instagram_metrics(v_show);
    raise exception 'FALHA: outro artista leu o funil de um show que não é dele';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role anon;
  begin
    perform show_instagram_metrics(v_show);
    raise exception 'FALHA: a chave anon executou show_instagram_metrics';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'OK — funil só para o dono do show';
end $$;
