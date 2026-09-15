-- `free_votes_per_round` só pode prometer o que o índice único cumpre.
--
-- A trava de antifraude do voto grátis é
--   create unique index votes_one_free_per_session_round
--     on votes (round_id, session_id) where payment_id is null;
-- ou seja, UM voto por sessão por rodada. Configurar 2 passava na checagem da
-- RPC e estourava no índice, com a mensagem errada ("Você já votou nesta
-- rodada") para quem, pela configuração, ainda tinha voto.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner   uuid := '00000000-0000-4000-8000-000000000001';
  v_barrado boolean := false;
  v_show    uuid;
begin
  -- 0 e 1 são valores legítimos
  insert into shows (owner_id, title, status, join_code, vote_mode, free_votes_per_round)
  values (v_owner, 'Grátis Ligado', 'draft', 'GRATS9', 'free', 1);
  insert into shows (owner_id, title, status, join_code, vote_mode, free_votes_per_round)
  values (v_owner, 'Grátis Desligado', 'draft', 'GRATS8', 'free', 0);

  -- 2 não é: o banco não sabe cumprir
  begin
    insert into shows (owner_id, title, status, join_code, vote_mode, free_votes_per_round)
    values (v_owner, 'Dois Votos', 'draft', 'DVTS22', 'free', 2);
    assert false, 'o banco aceitou free_votes_per_round = 2, que o índice único não honra';
  exception when check_violation then
    v_barrado := true;
  end;

  assert v_barrado, 'a configuração impossível não foi barrada';

  -- e o índice continua sendo quem decide de verdade, numa rodada real
  select id into v_show from shows where join_code = 'FREE01';
  assert v_show is not null, 'seed não criou o show FREE01';

  raise notice 'OK — free_votes_per_round limitado ao que o índice único garante';
end $$;
