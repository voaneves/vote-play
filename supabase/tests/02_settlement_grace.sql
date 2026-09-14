-- A decisão nº 1: nenhum Pix confirma depois da apuração.
-- Testa que (a) a apuração espera o pendente dentro da carência,
-- (b) estourada a carência o pendente é anulado, e
-- (c) o QR nunca vive além da janela de apuração.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_round rounds;
  v_sess  uuid;
  v_cand  round_candidates;
  v_pay   uuid;
  v_exp   timestamptz;
  v_n     int;
  v_ids   uuid[];
begin
  -- show com carência curta para o teste não depender de relógio de parede
  insert into shows (owner_id, title, status, join_code, round_duration_seconds,
                     settlement_grace_seconds, payment_ttl_seconds)
  values (v_owner, 'Show Carência', 'live', 'GRACE1', 30, 15, 300)
  returning id into v_show;

  insert into show_songs (show_id, song_id)
  select v_show, id from songs where owner_id = v_owner limit 3;

  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids, 30);

  insert into audience_sessions (show_id, device_hash) values (v_show, 'device-grace')
    returning id into v_sess;
  select * into v_cand from round_candidates where round_id = v_round.id order by position limit 1;

  -- (c) o QR expira no máximo junto com a apuração, mesmo com TTL de 300s
  select payment_id, expires_at into v_pay, v_exp
    from create_vote_intent(v_round.id, v_cand.id, v_sess, 500);
  assert v_exp <= v_round.settle_by,
    format('QR expira em %s, depois da apuração em %s', v_exp, v_round.settle_by);
  assert v_exp < now() + interval '300 seconds',
    'o TTL de 300s deveria ter sido encurtado pela janela da rodada';

  perform close_round_voting(v_round.id);

  -- (a) com voto pendente e dentro da carência, não apura
  perform settle_round(v_round.id);
  select * into v_round from rounds where id = v_round.id;
  assert v_round.status = 'closing',
    format('com Pix pendente na carência não podia apurar; status %s', v_round.status);

  -- (b) carência estourada: anula o pendente e apura
  update rounds set settle_by = now() - interval '1 second' where id = v_round.id;
  perform settle_round(v_round.id);
  select * into v_round from rounds where id = v_round.id;
  assert v_round.status = 'settled',
    format('passada a carência deveria apurar; status %s', v_round.status);

  select count(*) into v_n from votes
   where round_id = v_round.id and status = 'voided';
  assert v_n = 1, format('o voto não pago deveria virar voided, achei %s', v_n);

  -- e o placar não pode ter contado esse voto
  select weight into v_n from round_candidates where id = v_cand.id;
  assert v_n = 0, format('voto anulado não pode pesar no placar; peso %s', v_n);

  -- confirmação tardia (webhook atrasado) não entra no placar
  perform confirm_payment(v_pay);
  select weight into v_n from round_candidates where id = v_cand.id;
  assert v_n = 0, format('Pix confirmado após a apuração não pode contar; peso %s', v_n);

  select count(*) into v_n from show_events
   where show_id = v_show and type = 'payment_after_settlement';
  assert v_n = 1, 'o pagamento tardio deveria ter sido registrado para estorno';

  raise notice 'OK — janela de apuração e Pix tardio validados';
end $$;
