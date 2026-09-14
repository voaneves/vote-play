-- Exercita o ciclo de vida completo de uma rodada. Qualquer desvio aborta.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_show   uuid;
  v_round  rounds;
  v_sess   uuid;
  v_cand   round_candidates;
  v_cand2  round_candidates;
  v_vote   uuid;
  v_pay    uuid;
  v_w      int;
  v_exp    timestamptz;
  v_n      int;
begin
  select id into v_show from shows where join_code = 'TESTE1';
  assert v_show is not null, 'seed não criou o show TESTE1';

  select * into v_round from rounds where show_id = v_show and status = 'open';
  assert v_round.id is not null, 'seed não deixou uma rodada aberta';
  assert v_round.seq = 1, 'a primeira rodada deveria ser seq 1';

  select count(*) into v_n from round_candidates where round_id = v_round.id;
  assert v_n = 4, format('esperava 4 candidatas, achei %s', v_n);

  -- settle_by = closes_at + carência do show
  assert v_round.settle_by > v_round.closes_at, 'settle_by precisa ser depois de closes_at';

  insert into audience_sessions (show_id, device_hash) values (v_show, 'device-a')
    returning id into v_sess;

  select * into v_cand  from round_candidates where round_id = v_round.id order by position limit 1;
  select * into v_cand2 from round_candidates where round_id = v_round.id order by position offset 1 limit 1;

  -- ---------------------------------------------------------------- voto pago
  select vote_id, payment_id, weight, expires_at
    into v_vote, v_pay, v_w, v_exp
    from create_vote_intent(v_round.id, v_cand.id, v_sess, 500);

  assert v_w = 5, format('R$5,00 com cents_per_point=100 deveria valer 5 pontos, deu %s', v_w);
  assert v_exp <= v_round.settle_by,
    'o QR Pix NÃO pode expirar depois da apuração — é isso que impede voto pago fora de hora';

  -- antes de confirmar, o placar não pode ter mexido
  select weight into v_n from round_candidates where id = v_cand.id;
  assert v_n = 0, format('voto pendente não pode contar no placar (peso %s)', v_n);

  perform confirm_payment(v_pay);

  select weight into v_n from round_candidates where id = v_cand.id;
  assert v_n = 5, format('após confirmar, o peso deveria ser 5, está %s', v_n);

  select total_weight into v_n from rounds where id = v_round.id;
  assert v_n = 5, format('total da rodada deveria ser 5, está %s', v_n);

  -- ------------------------------------------- webhook duplicado é inofensivo
  perform confirm_payment(v_pay);
  perform confirm_payment(v_pay);
  select weight into v_n from round_candidates where id = v_cand.id;
  assert v_n = 5, format('webhook repetido dobrou o voto: peso %s', v_n);

  -- ------------------------------------------------- valor fora do permitido
  begin
    perform create_vote_intent(v_round.id, v_cand.id, v_sess, 50);
    assert false, 'deveria ter recusado valor abaixo do mínimo do show';
  exception when others then null;
  end;

  -- ---------------------------------------------- candidata de outra rodada
  begin
    perform create_vote_intent(v_round.id, gen_random_uuid(), v_sess, 500);
    assert false, 'deveria ter recusado candidata inexistente';
  exception when others then null;
  end;

  -- --------------------------------------- empate resolvido pelo 1º voto
  -- cand2 empata em peso, mas votou depois: cand deve vencer.
  select vote_id, payment_id into v_vote, v_pay
    from create_vote_intent(v_round.id, v_cand2.id, v_sess, 500);
  perform confirm_payment(v_pay);

  select weight into v_n from round_candidates where id = v_cand2.id;
  assert v_n = 5, format('cand2 deveria ter peso 5, tem %s', v_n);

  -- ------------------------------------------------ encerra a votação
  perform close_round_voting(v_round.id);
  select * into v_round from rounds where id = v_round.id;
  assert v_round.status = 'closing', format('status deveria ser closing, é %s', v_round.status);

  -- votar depois do fechamento é recusado
  begin
    perform create_vote_intent(v_round.id, v_cand.id, v_sess, 500);
    assert false, 'não pode aceitar voto com a votação encerrada';
  exception when others then null;
  end;

  -- ------------------------------------------------ apuração sem pendências
  perform settle_round(v_round.id);
  select * into v_round from rounds where id = v_round.id;
  assert v_round.status = 'settled', format('sem pendências, deveria apurar na hora; está %s', v_round.status);

  assert v_round.winner_candidate_id = v_cand.id,
    'desempate errado: deveria vencer quem recebeu o primeiro voto confirmado';

  -- vencedora vai para a fila do show
  select count(*) into v_n from show_songs
   where show_id = v_show and status = 'queued' and id = v_cand.show_song_id;
  assert v_n = 1, 'a música vencedora deveria ficar com status queued';

  select count(*) into v_n from show_songs where show_id = v_show and status = 'candidate';
  assert v_n = 0, 'as candidatas perdedoras deveriam voltar para available';

  -- apurar de novo é inofensivo
  perform settle_round(v_round.id);

  raise notice 'OK — ciclo completo da rodada validado';
end $$;
