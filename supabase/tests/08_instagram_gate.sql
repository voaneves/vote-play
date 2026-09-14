-- Modo Instagram: portão de atrito e registro, NÃO verificação.
-- Nenhuma API do Instagram diz se alguém segue um perfil — o que testamos aqui
-- é que o @ é exigido, normalizado e guardado, e que o artista consegue a lista.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- normalização do @ aceita o que a plateia realmente digita
do $$
begin
  assert normalize_instagram_handle('@Fulano_Silva') = 'fulano_silva', 'não tirou o @ nem baixou a caixa';
  assert normalize_instagram_handle('  banda.oficial ') = 'banda.oficial', 'não aparou espaços';
  assert normalize_instagram_handle('https://instagram.com/banda.oficial') = 'banda.oficial',
    'não aceitou URL colada';
  assert normalize_instagram_handle('https://www.instagram.com/banda/?hl=pt') = 'banda',
    'não limpou parâmetros da URL';
  assert normalize_instagram_handle('   ') is null, 'string vazia deveria virar null';

  begin
    perform normalize_instagram_handle('perfil com espaço');
    assert false, 'deveria recusar @ inválido';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform normalize_instagram_handle('.comecacomponto');
    assert false, 'deveria recusar @ começando com ponto';
  exception when invalid_parameter_value then null;
  end;

  raise notice 'OK — normalização do @ do Instagram';
end $$;

-- modo instagram exige perfil configurado no show
do $$
declare v_owner uuid := '00000000-0000-4000-8000-000000000001';
begin
  begin
    insert into shows (owner_id, title, status, vote_mode)
    values (v_owner, 'Sem perfil', 'live', 'instagram');
    raise exception 'FALHA: aceitou modo instagram sem perfil configurado';
  exception when check_violation then null;
  end;
  raise notice 'OK — modo instagram sem perfil é recusado no schema';
end $$;

-- o portão em si
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid; v_code text; v_ids uuid[]; v_round rounds;
  v_cand  uuid; v_sess uuid; v_json json; v_n int;
begin
  insert into shows (owner_id, title, status, vote_mode, instagram_handle)
  values (v_owner, 'Show do Insta', 'live', 'instagram', 'banda.oficial')
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id) select v_show, id from songs where owner_id = v_owner limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);
  select id into v_cand from round_candidates where round_id = v_round.id limit 1;

  set local role anon;

  v_json := join_show(v_code, 'aparelho-insta-0001');
  v_sess := (v_json -> 'session' ->> 'id')::uuid;
  assert v_json -> 'show' ->> 'instagramHandle' = 'banda.oficial',
    'o join deveria devolver o perfil do show';
  assert v_json -> 'session' ->> 'instagramHandle' is null,
    'sessão nova não pode já ter @';

  -- sem o @, não vota
  begin
    perform cast_free_vote(v_round.id, v_cand, v_sess);
    raise exception 'FALHA: votou sem informar o @';
  exception when invalid_parameter_value then null;
  end;

  -- @ inválido é recusado
  begin
    perform set_session_instagram(v_sess, 'tem espaço aqui');
    raise exception 'FALHA: aceitou @ inválido';
  exception when invalid_parameter_value then null;
  end;

  -- declara o @ e vota
  v_json := set_session_instagram(v_sess, '@Ana.Silva');
  assert v_json ->> 'instagramHandle' = 'ana.silva', 'o @ não foi normalizado ao gravar';
  perform cast_free_vote(v_round.id, v_cand, v_sess);

  -- o join seguinte já devolve o @, para a tela não pedir de novo
  v_json := join_show(v_code, 'aparelho-insta-0001');
  assert v_json -> 'session' ->> 'instagramHandle' = 'ana.silva',
    'o @ deveria persistir entre visitas do mesmo aparelho';

  reset role;
  select count(*) into v_n from votes v
    join round_candidates c on c.id = v.candidate_id
   where c.round_id = v_round.id and v.status = 'confirmed';
  assert v_n = 1, format('esperava 1 voto, achei %s', v_n);

  -- o artista leva a lista de participantes
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  select count(*) into v_n from show_participants(v_show);
  assert v_n = 1, format('a lista deveria ter 1 participante, tem %s', v_n);

  raise notice 'OK — portão do Instagram: @ exigido, normalizado, persistido e listado';
end $$;

-- a lista de participantes é do dono, e de mais ninguém
do $$
declare v_show uuid; v_blocked int := 0;
begin
  select id into v_show from shows where title = 'Show do Insta';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  begin
    perform show_participants(v_show);
    raise exception 'FALHA DE SEGURANÇA: outro artista leu a lista de participantes';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;
  reset role;
  assert v_blocked = 1, 'a guarda de posse não bloqueou';
  raise notice 'OK — lista de participantes só para o dono do show';
end $$;
