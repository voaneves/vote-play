-- Fase 5.1 — fila do repertório. Par pode / não pode em cada regra.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- cenário compartilhado pelos blocos: um show free no ar com 5 músicas
create temp table _fila (chave text primary key, id uuid, txt text);
grant all on _fila to anon, authenticated;

do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_code  text;
  r       record;
  i       int := 0;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show da Fila do Repertório', 'live', 'free')
  returning id, join_code into v_show, v_code;

  insert into _fila values ('show', v_show, v_code);

  for r in select id from songs where owner_id = v_owner order by title limit 5 loop
    i := i + 1;
    insert into show_songs (show_id, song_id, created_at)
    values (v_show, r.id, now() + make_interval(secs => i))
    returning id into r.id;
    insert into _fila values ('m' || i, r.id, null);
  end loop;

  assert i = 5, format('o cenário precisa de 5 músicas no repertório, achou %s', i);
  assert (select queue_enabled and queue_votes_per_session = 3 from shows where id = v_show),
    'fila ligada e 3 apoios por pessoa são o padrão';
end $$;

-- 1. Apoio: um por música, orçamento por pessoa, retirar devolve.
do $$
declare
  v_code text := (select txt from _fila where chave = 'show');
  m1 uuid := (select id from _fila where chave = 'm1');
  m2 uuid := (select id from _fila where chave = 'm2');
  m3 uuid := (select id from _fila where chave = 'm3');
  m4 uuid := (select id from _fila where chave = 'm4');
  v_ana uuid;
  v_json json;
begin
  set local role anon;
  v_ana := (join_show(v_code, 'aparelho-da-ana-fila') -> 'session' ->> 'id')::uuid;
  insert into _fila values ('ana', v_ana, null);

  v_json := join_show(v_code, 'aparelho-da-ana-fila');
  assert (v_json -> 'show' ->> 'queueEnabled')::boolean, 'o join tem de dizer que a fila existe';
  assert (v_json -> 'show' ->> 'queueVotesPerSession')::int = 3, 'o join tem de trazer o orçamento';

  v_json := set_song_support(m1, v_ana, true);
  assert (v_json ->> 'supportsLeft')::int = 2, 'depois de um apoio restam 2';

  -- repetir não empilha
  v_json := set_song_support(m1, v_ana, true);
  assert (v_json ->> 'supportsLeft')::int = 2, 'apoiar de novo a mesma música não pode gastar outro apoio';
  reset role;
  assert (select queue_weight from show_songs where id = m1) = 1, 'apoio repetido não pode somar peso';
  set local role anon;

  perform set_song_support(m2, v_ana, true);
  v_json := set_song_support(m3, v_ana, true);
  assert (v_json ->> 'supportsLeft')::int = 0, 'três apoios esgotam o orçamento';

  begin
    perform set_song_support(m4, v_ana, true);
    raise exception 'FALHA: quarto apoio passou do orçamento';
  exception when check_violation then null;
  end;

  -- retirar devolve, e aí cabe outro
  v_json := set_song_support(m2, v_ana, false);
  assert (v_json ->> 'supportsLeft')::int = 1, 'retirar um apoio devolve o apoio';
  perform set_song_support(m4, v_ana, true);

  reset role;
  assert (select queue_weight from show_songs where id = m2) = 0, 'retirar tinha de descontar o peso';
  assert (select queue_votes from show_songs where id = m4) = 1, 'o apoio novo tinha de contar';
  raise notice 'OK — fila: um apoio por música, orçamento por pessoa, retirar devolve';
end $$;

-- 2. Estado compacto: lista só quando muda, "nada mudou" em poucos bytes,
--    ranking com desempate, e o que é meu.
do $$
declare
  v_show uuid := (select id from _fila where chave = 'show');
  v_code text := (select txt from _fila where chave = 'show');
  v_ana  uuid := (select id from _fila where chave = 'ana');
  m1 uuid := (select id from _fila where chave = 'm1');
  m3 uuid := (select id from _fila where chave = 'm3');
  v_bia uuid;
  v_json json;
  v_list text;
  v_ver  text;
  v_topo int;
begin
  set local role anon;
  v_bia := (join_show(v_code, 'aparelho-da-bia-fila') -> 'session' ->> 'id')::uuid;
  perform set_song_support(m3, v_bia, true);   -- m3 fica com 2 apoios

  v_json := get_repertoire_state(v_show, v_ana);
  v_list := v_json ->> 'listVersion';
  v_ver  := v_json ->> 'version';

  assert json_array_length(v_json -> 'list') = 5, 'a lista tinha de vir inteira na primeira leitura';
  assert json_array_length(v_json -> 'weights') = 5 and json_array_length(v_json -> 'flags') = 5,
    'pesos e flags alinhados à lista';
  v_topo := (v_json -> 'order' ->> 0)::int;
  assert (v_json -> 'list' -> v_topo ->> 'id')::uuid = m3, 'a mais apoiada tinha de liderar';
  assert json_array_length(v_json -> 'mine') = 3, 'a Ana apoia 3 músicas';
  assert (v_json ->> 'left')::int = 0, 'orçamento da Ana esgotado no estado';

  -- nada mudou
  v_json := get_repertoire_state(v_show, v_ana, v_list, v_ver);
  assert (v_json ->> 'unchanged')::boolean, 'mesma versão responde unchanged';

  -- número mudou, lista não: resposta sem a lista
  perform set_song_support(m1, v_bia, true);
  v_json := get_repertoire_state(v_show, v_ana, v_list, v_ver);
  assert v_json ->> 'unchanged' is null, 'apoio novo tinha de mudar a versão';
  assert v_json -> 'list' is null, 'a lista não mudou e não podia ser reenviada';
  assert v_json ->> 'listVersion' = v_list, 'listVersion só muda com a lista';

  -- desempate: m1 e m3 com 2 apoios cada; m1 recebeu o primeiro apoio antes
  -- (lista inalterada: os índices valem para a lista da primeira leitura)
  v_topo := (v_json -> 'order' ->> 0)::int;
  reset role;
  assert v_topo = (select idx from (
      select id, (row_number() over (order by created_at, id) - 1)::int as idx
        from show_songs where show_id = v_show) t where t.id = m1),
    'empate em peso: quem recebeu o primeiro apoio antes tinha de liderar';
  raise notice 'OK — estado da fila compacto: lista só quando muda, ranking e apoios da sessão';
end $$;

-- 3. Tocada: sai da fila, devolve o apoio, e só o dono marca.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show uuid := (select id from _fila where chave = 'show');
  v_ana  uuid := (select id from _fila where chave = 'ana');
  m3 uuid := (select id from _fila where chave = 'm3');
  v_json json;
  v_list text;
  v_barrou int := 0;
begin
  v_list := get_repertoire_state(v_show, v_ana) ->> 'listVersion';

  -- anon não marca
  set local role anon;
  begin
    perform set_song_played(m3);
    raise exception 'FALHA: anon marcou música como tocada';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;
  reset role;

  -- outro artista não marca
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ee', true);
  begin
    perform set_song_played(m3);
    raise exception 'FALHA: artista marcou música de show alheio';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;

  -- o dono marca
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_song_played(m3);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  assert v_barrou = 2, format('esperava 2 bloqueios, contei %s', v_barrou);
  assert (select status from show_songs where id = m3) = 'played', 'a música tinha de ficar tocada';

  set local role anon;
  v_json := get_repertoire_state(v_show, v_ana, v_list, null);
  reset role;
  assert json_array_length(v_json -> 'list') = 4, 'a tocada tinha de sair da lista (e a lista ser reenviada)';
  assert (v_json ->> 'left')::int = 1, 'o apoio na música tocada tinha de voltar para a Ana';

  -- não dá para apoiar a tocada
  set local role anon;
  begin
    perform set_song_support(m3, v_ana, true);
    raise exception 'FALHA: apoio em música já tocada';
  exception when invalid_parameter_value then null;
  end;
  reset role;

  -- desfazer
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_song_played(m3, false);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert (select status from show_songs where id = m3) = 'available', 'desfazer tinha de devolver a música à fila';

  raise notice 'OK — tocada sai da fila e devolve o apoio; só o dono marca, e dá para desfazer';
end $$;

-- 4. Onde a fila recusa.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show uuid := (select id from _fila where chave = 'show');
  v_code text := (select txt from _fila where chave = 'show');
  m1 uuid := (select id from _fila where chave = 'm1');
  m5 uuid := (select id from _fila where chave = 'm5');
  v_cris uuid;
  v_outro uuid;
  v_outro_code text;
  v_pix uuid;
  v_pix_song uuid;
  v_pix_code text;
  v_sess uuid;
  v_ig uuid;
  v_ig_song uuid;
  v_ig_code text;
  v_ids uuid[];
  v_recusas int := 0;
begin
  set local role anon;
  v_cris := (join_show(v_code, 'aparelho-da-cris-fila') -> 'session' ->> 'id')::uuid;
  reset role;

  -- escondida: some da lista e não aceita apoio
  update show_songs set hidden = true where id = m5;
  set local role anon;
  assert not exists (select 1 from json_array_elements(get_repertoire_state(v_show, v_cris) -> 'list') e
                      where (e ->> 'id')::uuid = m5), 'escondida não pode aparecer na lista';
  begin perform set_song_support(m5, v_cris, true);
  exception when invalid_parameter_value then v_recusas := v_recusas + 1; end;
  reset role;
  update show_songs set hidden = false where id = m5;

  -- na rodada aberta: apoio recusado (vota-se nela lá)
  select array_agg(song_id) into v_ids from show_songs where id in (m1, m5);
  perform open_round(v_show, v_ids);
  set local role anon;
  begin perform set_song_support(m5, v_cris, true);
  exception when invalid_parameter_value then v_recusas := v_recusas + 1; end;
  reset role;

  -- fila desligada
  update shows set queue_enabled = false where id = v_show;
  set local role anon;
  begin perform set_song_support(m1, v_cris, true);
  exception when invalid_parameter_value then v_recusas := v_recusas + 1; end;
  reset role;
  update shows set queue_enabled = true where id = v_show;

  -- sessão de outro show
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Outro Show da Fila', 'live', 'free') returning id, join_code into v_outro, v_outro_code;
  set local role anon;
  v_sess := (join_show(v_outro_code, 'aparelho-de-outro-show') -> 'session' ->> 'id')::uuid;
  begin perform set_song_support(m1, v_sess, true);
  exception when foreign_key_violation then v_recusas := v_recusas + 1; end;
  reset role;

  -- modo pix: até a Fase 7, recusado
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show Pix da Fila', 'live', 'pix') returning id, join_code into v_pix, v_pix_code;
  insert into show_songs (show_id, song_id)
    select v_pix, id from songs where owner_id = v_owner limit 1 returning id into v_pix_song;
  set local role anon;
  v_sess := (join_show(v_pix_code, 'aparelho-do-show-pix') -> 'session' ->> 'id')::uuid;
  begin perform set_song_support(v_pix_song, v_sess, true);
  exception when invalid_parameter_value then v_recusas := v_recusas + 1; end;
  reset role;

  -- modo instagram sem @
  insert into shows (owner_id, title, status, vote_mode, instagram_handle)
  values (v_owner, 'Show Insta da Fila', 'live', 'instagram', 'banda.fila')
  returning id, join_code into v_ig, v_ig_code;
  insert into show_songs (show_id, song_id)
    select v_ig, id from songs where owner_id = v_owner limit 1 returning id into v_ig_song;
  set local role anon;
  v_sess := (join_show(v_ig_code, 'aparelho-sem-arroba') -> 'session' ->> 'id')::uuid;
  begin perform set_song_support(v_ig_song, v_sess, true);
  exception when invalid_parameter_value then v_recusas := v_recusas + 1; end;
  perform set_session_instagram(v_sess, '@com.arroba');
  perform set_song_support(v_ig_song, v_sess, true);  -- com @, passa
  reset role;

  -- show pausado (intervalo): recusa pelo motivo certo
  update shows set status = 'paused' where id = v_show;
  set local role anon;
  begin perform set_song_support(m1, v_cris, true);
  exception when invalid_parameter_value then
    if sqlerrm like '%não está no ar%' then v_recusas := v_recusas + 1; end if;
  end;
  reset role;
  update shows set status = 'live' where id = v_show;

  assert v_recusas = 7, format('esperava 7 recusas, contei %s', v_recusas);
  raise notice 'OK — fila recusa escondida, na rodada, desligada, sessão alheia, pix, sem @ e fora do ar';
end $$;

-- 5. Privilégios: anon não lê apoios; artista não reescreve o ranking.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  m1 uuid := (select id from _fila where chave = 'm1');
  v_n int;
  v_barrou int := 0;
begin
  set local role anon;
  begin
    perform count(*) from song_votes;
    raise exception 'FALHA: anon leu apoios';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ee', true);
  select count(*) into v_n from song_votes;
  assert v_n = 0, 'artista leu apoios do show de outro';

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  select count(*) into v_n from song_votes sv join show_songs ss on ss.id = sv.show_song_id
   where ss.id = m1;
  assert v_n > 0, 'o dono precisa ler os apoios do próprio show';

  begin
    update show_songs set queue_weight = 999 where id = m1;
    raise exception 'FALHA: artista reescreveu o peso da fila';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;
  begin
    update show_songs set status = 'played' where id = m1;
    raise exception 'FALHA: artista mudou o status fora das funções';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;

  update show_songs set pinned = true where id = m1;   -- permitido
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  assert v_barrou = 3, format('esperava 3 bloqueios, contei %s', v_barrou);
  assert (select pinned from show_songs where id = m1), 'o dono precisa poder fixar';
  raise notice 'OK — apoios invisíveis para anon; artista fixa, mas não reescreve peso nem status';
end $$;

-- 6. Funil do Instagram: apoiar na fila conta como participar.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show uuid;
  v_code text;
  v_song uuid;
  v_sess uuid;
  v_json json;
  v_apoios int;
begin
  insert into shows (owner_id, title, status, vote_mode, instagram_handle)
  values (v_owner, 'Show Insta Só Fila', 'live', 'instagram', 'banda.sofila')
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id)
    select v_show, id from songs where owner_id = v_owner limit 1 returning id into v_song;

  set local role anon;
  v_sess := (join_show(v_code, 'aparelho-so-fila-1') -> 'session' ->> 'id')::uuid;
  perform set_session_instagram(v_sess, '@so.na.fila');
  perform set_song_support(v_song, v_sess, true);
  reset role;

  v_json := show_instagram_metrics(v_show);
  assert (v_json -> 'funnel' ->> 'voted')::int = 1, 'apoio na fila tinha de contar no último degrau';

  select apoios into v_apoios from show_participants(v_show) limit 1;
  assert v_apoios = 1, 'a lista de participantes tinha de trazer os apoios';
  raise notice 'OK — funil e participantes contam o apoio da fila';
end $$;

drop table _fila;
