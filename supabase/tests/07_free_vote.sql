-- Voto sem pagamento: o caminho que a chave anon pública pode chamar.
-- Se ele aceitar o que não deve, qualquer pessoa manipula o placar de graça.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_show   uuid;
  v_round  rounds;
  v_ids    uuid[];
  v_s1     uuid;
  v_s2     uuid;
  v_c1     uuid;
  v_c2     uuid;
  v_json   json;
  v_code   text;
  v_n      int;
begin
  -- show em modo gratuito
  insert into shows (owner_id, title, status, vote_mode, free_votes_per_round)
  values (v_owner, 'Show Gratuito', 'live', 'free_with_tip', 1)
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id) select v_show, id from songs where owner_id = v_owner limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);

  select id into v_c1 from round_candidates where round_id = v_round.id order by position limit 1;
  select id into v_c2 from round_candidates where round_id = v_round.id order by position offset 1 limit 1;

  set local role anon;

  -- entra pelo caminho público
  v_json := join_show(v_code, 'aparelho-da-ana-1234');
  v_s1 := (v_json -> 'session' ->> 'id')::uuid;
  v_json := join_show(v_code, 'aparelho-do-bruno-567');
  v_s2 := (v_json -> 'session' ->> 'id')::uuid;

  -- voto válido
  v_json := cast_free_vote(v_round.id, v_c1, v_s1);
  assert v_json ->> 'voteId' is not null, 'voto grátis não retornou id';

  reset role;
  select weight, votes_count into v_n, v_n from round_candidates where id = v_c1;
  select weight into v_n from round_candidates where id = v_c1;
  assert v_n = 1, format('o voto grátis deveria pesar 1, pesou %s', v_n);
  set local role anon;

  -- SEGUNDO voto do mesmo aparelho na mesma rodada: recusado
  begin
    perform cast_free_vote(v_round.id, v_c2, v_s1);
    raise exception 'FALHA: o mesmo aparelho votou duas vezes na rodada';
  exception when unique_violation then null;
  end;

  -- nem trocando de candidata, nem repetindo a mesma
  begin
    perform cast_free_vote(v_round.id, v_c1, v_s1);
    raise exception 'FALHA: voto repetido aceito';
  exception when unique_violation then null;
  end;

  -- outro aparelho vota normalmente
  perform cast_free_vote(v_round.id, v_c2, v_s2);

  -- sessão de OUTRO show não serve
  begin
    perform cast_free_vote(v_round.id, v_c1,
      (select id from audience_sessions where show_id <> v_show limit 1));
    raise exception 'FALHA: aceitou sessão de outro show';
  exception when foreign_key_violation then null;
     when others then null;
  end;

  -- candidata de outra rodada não serve
  begin
    perform cast_free_vote(v_round.id, gen_random_uuid(), v_s2);
    raise exception 'FALHA: aceitou candidata inexistente';
  exception when foreign_key_violation then null;
  end;

  -- o snapshot marca em quem a pessoa votou e quantos votos restam
  v_json := get_show_state(v_show, v_s1);
  assert (v_json -> 'round' ->> 'myVoteCandidateId')::uuid = v_c1,
    'o snapshot não marcou o voto da própria sessão';
  assert (v_json -> 'round' ->> 'freeVotesLeft')::int = 0,
    'deveria restar 0 voto grátis para quem já votou';

  v_json := get_show_state(v_show, null);
  assert v_json -> 'round' ->> 'myVoteCandidateId' is null,
    'sem sessão, o snapshot não pode apontar voto de ninguém';

  reset role;
  select total_votes into v_n from rounds where id = v_round.id;
  assert v_n = 2, format('a rodada deveria ter 2 votos, tem %s', v_n);

  raise notice 'OK — voto grátis: um por aparelho por rodada, com marcação no snapshot';
end $$;

-- modo pago não aceita voto grátis de jeito nenhum.
-- Cria o próprio cenário em vez de reaproveitar o do seed: outro teste pode já
-- ter apurado aquela rodada, e teste que depende de ordem quebra sem avisar.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_round rounds; v_cand uuid; v_sess uuid; v_show uuid; v_ids uuid[]; v_code text;
begin
  -- sem inventar código: o trigger gera um válido pelo alfabeto Crockford.
  -- Escrever 'PAGO01' à mão quebra na constraint, porque O não pertence ao alfabeto.
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show Pago', 'live', 'paid_weighted')
  returning id, join_code into v_show, v_code;
  insert into show_songs (show_id, song_id) select v_show, id from songs where owner_id = v_owner limit 2;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);
  select id into v_cand from round_candidates where round_id = v_round.id limit 1;

  set local role anon;
  v_sess := (join_show(v_code, 'aparelho-tentando-1234') -> 'session' ->> 'id')::uuid;
  begin
    perform cast_free_vote(v_round.id, v_cand, v_sess);
    raise exception 'FALHA DE SEGURANÇA: votou de graça em show de modo pago';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  raise notice 'OK — show pago recusa voto grátis';
end $$;

-- rodada encerrada recusa voto grátis
do $$
declare
  v_round uuid; v_cand uuid; v_sess uuid;
begin
  select r.id, c.id into v_round, v_cand
    from rounds r join round_candidates c on c.round_id = r.id
    join shows s on s.id = r.show_id
   where s.title = 'Show Gratuito' and r.status = 'open' limit 1;
  select id into v_sess from audience_sessions
   where device_hash = 'aparelho-do-bruno-567';

  update rounds set closes_at = now() - interval '1 second' where id = v_round;

  set local role anon;
  begin
    perform cast_free_vote(v_round, v_cand, v_sess);
    raise exception 'FALHA: aceitou voto em rodada encerrada';
  exception when invalid_parameter_value or unique_violation then null;
  end;
  reset role;
  raise notice 'OK — rodada encerrada recusa voto';
end $$;
