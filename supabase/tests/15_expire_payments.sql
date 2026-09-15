-- `expire_stale_payments()` devolve quantos PAGAMENTOS expiraram — e derruba
-- junto o voto pendente e o pedido direto não pago.
--
-- A versão anterior lia `row_count` depois do UPDATE em `votes`, então uma
-- cobrança de pedido direto expirando não contava nada e o log do cron mostrava
-- 0 num minuto em que houve expiração.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_show   uuid;
  v_round  rounds;
  v_ids    uuid[];
  v_sess   uuid;
  v_cand   uuid;
  v_vote   uuid;
  v_pay1   uuid;
  v_pay2   uuid;
  v_n      int;
  v_status vote_status;
  v_req    request_status;
begin
  -- drena o que os testes anteriores deixaram, para a contagem abaixo ser exata
  perform expire_stale_payments();

  insert into shows (owner_id, title, status, join_code, vote_mode)
  values (v_owner, 'Show do Vencimento', 'live', 'VENCE9', 'pix')
  returning id into v_show;

  insert into show_songs (show_id, song_id)
    select v_show, id from songs where owner_id = v_owner limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids);

  insert into audience_sessions (show_id, device_hash)
  values (v_show, 'device-vencimento') returning id into v_sess;

  select id into v_cand from round_candidates where round_id = v_round.id order by position limit 1;

  -- 1. cobrança de VOTO, vencida
  select vote_id, payment_id into v_vote, v_pay1
    from create_vote_intent(v_round.id, v_cand, v_sess, 500);
  update payments set expires_at = now() - interval '1 minute' where id = v_pay1;

  -- 2. cobrança de PEDIDO DIRETO, vencida
  insert into payments (show_id, session_id, purpose, provider, amount_cents, status, expires_at)
  values (v_show, v_sess, 'direct_request', 'fake', 3000, 'pending', now() - interval '1 minute')
  returning id into v_pay2;

  insert into direct_requests (show_id, session_id, title, artist_name, amount_cents,
                               payment_id, status)
  values (v_show, v_sess, 'Asa Branca', 'Luiz Gonzaga', 3000, v_pay2, 'pending_payment');

  -- ------------------------------------------------------------ a passada
  select expire_stale_payments() into v_n;
  assert v_n = 2, format('deveria ter expirado 2 pagamentos (voto e pedido), contou %s', v_n);

  select status into v_status from votes where id = v_vote;
  assert v_status = 'expired', format('o voto pendente deveria ter expirado junto; está %s', v_status);

  select status into v_req from direct_requests where payment_id = v_pay2;
  assert v_req = 'refunded', format('o pedido não pago deveria virar refunded; está %s', v_req);

  -- ------------------------------------------------- rodar de novo é inócuo
  select expire_stale_payments() into v_n;
  assert v_n = 0, format('não havia nada para expirar; contou %s', v_n);

  raise notice 'OK — expire_stale_payments conta pagamentos e derruba voto e pedido junto';
end $$;
