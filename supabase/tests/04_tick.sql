-- tick_rounds() é o que o pg_cron executa a cada 10 segundos.
-- Se ela não fizer a rodada andar sozinha, o show trava no meio.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_show   uuid;
  v_round  rounds;
  v_ids    uuid[];
  v_status round_status;
  v_winner text;
  v_n      int;
begin
  insert into shows (owner_id, title, status, join_code,
                     round_duration_seconds, settlement_grace_seconds)
  values ('00000000-0000-4000-8000-000000000001', 'Show do Tick', 'live', 'TCK999', 30, 15)
  returning id into v_show;

  insert into show_songs (show_id, song_id) select v_show, id from songs limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show;
  select * into v_round from open_round(v_show, v_ids, 30);

  -- rodada ainda no ar: o tick não pode mexer nela
  select tick_rounds() into v_n;
  select status into v_status from rounds where id = v_round.id;
  assert v_status = 'open', format('tick não podia encerrar rodada no prazo; status %s', v_status);

  -- viaja no tempo em vez de esperar de verdade
  update rounds set closes_at = now() - interval '1 second',
                    settle_by = now() - interval '1 second'
   where id = v_round.id;

  select tick_rounds() into v_n;
  assert v_n >= 2, format('o tick deveria ter encerrado e apurado (tocou %s)', v_n);

  select r.status, c.title into v_status, v_winner
    from rounds r left join round_candidates c on c.id = r.winner_candidate_id
   where r.id = v_round.id;

  assert v_status = 'settled', format('tick_rounds deveria ter apurado; status %s', v_status);
  assert v_winner is not null, 'apurou sem eleger vencedora';

  -- e é inofensivo rodar de novo
  select tick_rounds() into v_n;
  assert v_n = 0, format('tick repetido não podia mexer em nada (tocou %s)', v_n);

  raise notice 'OK — tick_rounds() conduz a rodada sozinha (vencedora: %)', v_winner;
end $$;
