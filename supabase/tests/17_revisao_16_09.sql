-- Correções da revisão de 16/09 (migration …180000). Cada bloco é o par
-- pode / não pode, nunca só o caminho feliz.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- 1. Painel: artista não enxerga nem altera show de outro artista.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_n     int;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show de Outro Dono', 'live', 'free')
  returning id into v_show;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ee', true);

  select count(*) into v_n from shows;
  assert v_n = 0, format('artista sem shows enxergou %s show(s) de outros', v_n);

  update shows set status = 'ended' where id = v_show;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'artista alterou o status do show de outro';

  -- o dono continua vendo e alterando o próprio
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  select count(*) into v_n from shows where id = v_show;
  assert v_n = 1, 'o dono precisa ver o próprio show no ar';

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'OK — painel: show alheio não aparece e não muda';
end $$;

-- 2. Pedidos: anon lê a fila, mas não o valor nem a sessão.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_code  text;
  v_sess  uuid;
  v_n     int;
  v_barrou int := 0;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show da Fila', 'live', 'free')
  returning id, join_code into v_show, v_code;
  v_sess := (join_show(v_code, 'aparelho-da-fila-1') -> 'session' ->> 'id')::uuid;
  insert into direct_requests (show_id, session_id, title, artist_name, amount_cents, status)
  values (v_show, v_sess, 'Evidências', 'Chitãozinho & Xororó', 5000, 'paid');

  set local role anon;

  select count(*) into v_n from direct_requests where show_id = v_show;
  assert v_n = 1, 'anon precisa ler a fila pública';
  select count(*) into v_n from public_queue where show_id = v_show;
  assert v_n = 1, 'a view public_queue precisa continuar funcionando para anon';

  begin
    perform amount_cents from direct_requests limit 1;
    raise exception 'FALHA: anon leu o valor pago de um pedido';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;
  begin
    perform session_id from direct_requests limit 1;
    raise exception 'FALHA: anon leu a sessão de quem pediu';
  exception when insufficient_privilege then v_barrou := v_barrou + 1;
  end;

  -- artista logado não lê pedido de show alheio
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ee', true);
  select count(*) into v_n from direct_requests where show_id = v_show;
  assert v_n = 0, 'artista leu pedido (com valor) do show de outro';

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert v_barrou = 2, format('esperava 2 colunas fechadas, contei %s', v_barrou);
  raise notice 'OK — fila pública sem valor nem sessão, e sem vazamento entre artistas';
end $$;

-- 3. Encerrar o show apura a rodada aberta; despausar não reescreve o início;
--    encerrado é estado final; o snapshot continua respondendo depois do fim.
do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_show   uuid;
  v_code   text;
  v_ids    uuid[];
  v_round  rounds;
  v_cand   uuid;
  v_sess   uuid;
  v_inicio timestamptz;
  v_json   json;
  v_n      int;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show que Termina', 'ready', 'free')
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id)
    select v_show, id from songs where owner_id = v_owner limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  update shows set status = 'live' where id = v_show;
  select started_at into v_inicio from shows where id = v_show;
  assert v_inicio is not null, 'subir ao ar tinha de gravar started_at';

  select * into v_round from open_round(v_show, v_ids);
  select id into v_cand from round_candidates where round_id = v_round.id order by position offset 1 limit 1;

  reset role;
  v_sess := (join_show(v_code, 'aparelho-que-vota-1') -> 'session' ->> 'id')::uuid;
  perform cast_free_vote(v_round.id, v_cand, v_sess);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- pausa e volta: o início da noite não muda
  perform pg_sleep(0.01);
  update shows set status = 'paused' where id = v_show;
  update shows set status = 'live' where id = v_show;
  assert (select started_at from shows where id = v_show) = v_inicio,
    'despausar reescreveu o started_at';

  -- encerra com a rodada aberta
  update shows set status = 'ended' where id = v_show;

  select * into v_round from rounds where id = v_round.id;
  assert v_round.status = 'settled', format('rodada ficou %s ao encerrar o show', v_round.status);
  assert v_round.winner_candidate_id = v_cand, 'a vencedora tinha de ser a candidata votada';
  assert (select ended_at from shows where id = v_show) is not null, 'ended_at não foi gravado';

  begin
    update shows set status = 'live' where id = v_show;
    raise exception 'FALHA: show encerrado voltou ao ar';
  exception when invalid_parameter_value then null;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- a plateia ainda recebe o estado final — e não enxerga mais a tabela de rodadas
  set local role anon;
  v_json := get_show_state(v_show, v_sess);
  assert v_json ->> 'showStatus' = 'ended', 'o snapshot tinha de dizer que o show terminou';
  assert (v_json -> 'round' ->> 'winnerCandidateId')::uuid = v_cand,
    'o snapshot do show encerrado tinha de trazer a vencedora';
  select count(*) into v_n from rounds where show_id = v_show;
  assert v_n = 0, 'anon leu a tabela de rodadas de show fora do ar';
  reset role;

  raise notice 'OK — encerrar apura a rodada, despausar preserva o início, fim é fim';
end $$;

-- 4. Cancelar o show cancela a rodada, sem vencedora, e devolve as músicas.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_ids   uuid[];
  v_round rounds;
  v_n     int;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show Cancelado', 'live', 'free')
  returning id into v_show;
  insert into show_songs (show_id, song_id)
    select v_show, id from songs where owner_id = v_owner limit 2;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);

  update shows set status = 'cancelled' where id = v_show;

  select * into v_round from rounds where id = v_round.id;
  assert v_round.status = 'cancelled', format('rodada ficou %s ao cancelar o show', v_round.status);
  assert v_round.winner_candidate_id is null, 'rodada cancelada não tem vencedora';
  select count(*) into v_n from show_songs where show_id = v_show and status <> 'available';
  assert v_n = 0, 'as músicas da rodada cancelada tinham de voltar a ficar disponíveis';

  raise notice 'OK — cancelar o show cancela a rodada e devolve o repertório';
end $$;

-- 5. Snapshot com versão: igual responde curto; qualquer mudança visível,
--    inclusive o próprio voto, troca a versão.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_code  text;
  v_ids   uuid[];
  v_round rounds;
  v_c1    uuid;
  v_ana   uuid;
  v_bia   uuid;
  v_json  json;
  v_ver   text;
  v_ver_bia text;
  v_pos   int[];
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show da Versão', 'live', 'free')
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id)
    select v_show, id from songs where owner_id = v_owner limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);
  select id into v_c1 from round_candidates where round_id = v_round.id order by position desc limit 1;

  set local role anon;
  v_ana := (join_show(v_code, 'aparelho-da-ana-versao') -> 'session' ->> 'id')::uuid;
  v_bia := (join_show(v_code, 'aparelho-da-bia-versao') -> 'session' ->> 'id')::uuid;

  v_json := get_show_state(v_show, v_ana);
  v_ver  := v_json ->> 'version';
  assert v_ver is not null and length(v_ver) = 16, 'snapshot sem versão';
  v_ver_bia := get_show_state(v_show, v_bia) ->> 'version';

  -- nada mudou: resposta curta, sem rodada
  v_json := get_show_state(v_show, v_ana, v_ver);
  assert (v_json ->> 'unchanged')::boolean, 'mesma versão tinha de responder unchanged';
  assert v_json -> 'round' is null, 'resposta unchanged não pode carregar o snapshot';
  assert v_json ->> 'serverTime' is not null, 'unchanged ainda precisa corrigir o relógio';

  -- a Ana vota: a versão DELA muda (myVoteCandidateId)…
  perform cast_free_vote(v_round.id, v_c1, v_ana);
  v_json := get_show_state(v_show, v_ana, v_ver);
  assert v_json ->> 'unchanged' is null, 'o próprio voto tinha de invalidar a versão';
  assert (v_json -> 'round' ->> 'myVoteCandidateId')::uuid = v_c1, 'o voto não voltou no snapshot';

  -- …e a da Bia também, porque o placar mudou
  v_json := get_show_state(v_show, v_bia, v_ver_bia);
  assert v_json ->> 'unchanged' is null, 'o voto de outra pessoa tinha de mudar o placar visível';

  -- ordem estável: a do artista, mesmo com a última candidata na frente
  select array_agg((c ->> 'position')::int) into v_pos
    from json_array_elements(v_json -> 'round' -> 'candidates') c;
  assert v_pos = (select array_agg(position order by position) from round_candidates where round_id = v_round.id),
    'as candidatas tinham de vir na ordem do artista, não reordenadas por peso';

  reset role;
  raise notice 'OK — snapshot com versão: curto quando igual, troca a cada mudança visível';
end $$;
