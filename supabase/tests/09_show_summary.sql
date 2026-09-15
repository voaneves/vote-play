-- Resumo do show: o que o artista vê depois que a noite acaba.
-- O risco aqui não é regra de negócio, é vazamento: a função é SECURITY
-- DEFINER e roda com os privilégios do dono, então quem pode chamá-la e sobre
-- qual show importa mais que os números.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_show   uuid;
  v_code   text;
  v_round  rounds;
  v_ids    uuid[];
  v_c1     uuid;
  v_c2     uuid;
  v_s1     uuid;
  v_s2     uuid;
  v_json   json;
  v_n      int;
begin
  insert into shows (owner_id, title, venue, status, vote_mode, free_votes_per_round)
  values (v_owner, 'Show de Resumo', 'Bar do Teste', 'live', 'free', 1)
  returning id, join_code into v_show, v_code;

  insert into show_songs (show_id, song_id)
  select v_show, id from songs where owner_id = v_owner limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;

  -- rodada 1, com vencedora
  select * into v_round from open_round(v_show, v_ids);
  select id into v_c1 from round_candidates where round_id = v_round.id order by position limit 1;
  select id into v_c2 from round_candidates where round_id = v_round.id order by position offset 1 limit 1;

  set local role anon;
  v_s1 := (join_show(v_code, 'resumo-aparelho-um-01') -> 'session' ->> 'id')::uuid;
  v_s2 := (join_show(v_code, 'resumo-aparelho-do-02') -> 'session' ->> 'id')::uuid;
  perform cast_free_vote(v_round.id, v_c1, v_s1);
  perform cast_free_vote(v_round.id, v_c1, v_s2);
  reset role;

  -- fecha a votação e apura na marra (o cronômetro não vai esperar o teste)
  update rounds set closes_at = now() - interval '1 second',
                    settle_by = now() - interval '1 second'
   where id = v_round.id;
  perform close_round_voting(v_round.id);
  perform settle_round(v_round.id, true);

  v_json := show_summary(v_show);

  assert v_json -> 'show' ->> 'title' = 'Show de Resumo', 'o resumo trouxe outro show';
  assert v_json -> 'show' ->> 'venue' = 'Bar do Teste',   'o local não voltou no resumo';

  v_n := (v_json -> 'totals' ->> 'rounds')::int;
  assert v_n = 1, format('deveria contar 1 rodada apurada, contou %s', v_n);

  v_n := (v_json -> 'totals' ->> 'participants')::int;
  assert v_n = 2, format('deveria contar 2 participantes, contou %s', v_n);

  v_n := (v_json -> 'totals' ->> 'votes')::int;
  assert v_n = 2, format('deveria contar 2 votos confirmados, contou %s', v_n);

  -- no modo free ninguém declara @: a contagem precisa ser 0, não nula
  v_n := (v_json -> 'totals' ->> 'withInstagram')::int;
  assert v_n = 0, format('modo free não deveria ter @ declarado, tem %s', v_n);

  assert json_array_length(v_json -> 'rounds') = 1,
    'o resumo deveria listar exatamente a rodada que rolou';

  assert v_json -> 'rounds' -> 0 -> 'winner' ->> 'title'
       = (select title from round_candidates where id = v_c1),
    'a vencedora do resumo não é a que recebeu os votos';

  v_n := (v_json -> 'rounds' -> 0 -> 'winner' ->> 'votes')::int;
  assert v_n = 2, format('a vencedora deveria ter 2 votos, tem %s', v_n);

  -- as perdedoras entram como runnersUp, e a vencedora NÃO se repete ali
  assert json_array_length(v_json -> 'rounds' -> 0 -> 'runnersUp') = 2,
    'as duas candidatas restantes deveriam aparecer como runnersUp';

  raise notice 'OK — resumo do show: totais, vencedora e candidatas restantes';
end $$;

-- Rodada cancelada não aconteceu: não pode aparecer no resumo.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid; v_ids uuid[]; v_round rounds; v_json json;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show com Rodada Cancelada', 'live', 'free')
  returning id into v_show;
  insert into show_songs (show_id, song_id)
  select v_show, id from songs where owner_id = v_owner limit 2;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);

  update rounds set status = 'cancelled' where id = v_round.id;

  v_json := show_summary(v_show);
  assert json_array_length(v_json -> 'rounds') = 0,
    'rodada cancelada não deveria entrar no resumo';
  assert (v_json -> 'totals' ->> 'rounds')::int = 0,
    'rodada cancelada não deveria contar no total';

  raise notice 'OK — resumo ignora rodada cancelada';
end $$;

-- A trava que importa: o resumo de um show não pode vazar para outro artista.
--
-- O stub reproduz o auth.uid() do Supabase lendo `request.jwt.claim.sub` —
-- usar `request.jwt.claims` aqui faria auth.uid() voltar null, e um null faz
-- assert_show_owner sair sem reclamar. O teste passaria mostrando o contrário
-- do que verifica.
do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_outro  uuid := '22222222-2222-4222-8222-222222222222';
  v_show   uuid;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show Alheio', 'live', 'free')
  returning id into v_show;

  -- o dono enxerga
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform show_summary(v_show);

  -- o outro artista, não
  perform set_config('request.jwt.claim.sub', v_outro::text, true);
  begin
    perform show_summary(v_show);
    raise exception 'FALHA: outro artista leu o resumo de um show que não é dele';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- e a plateia não chega nem perto: a chave anon não tem o grant
  set local role anon;
  begin
    perform show_summary(v_show);
    raise exception 'FALHA: a chave anon executou show_summary';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'OK — resumo só para o dono do show: outro artista e anon barrados';
end $$;
