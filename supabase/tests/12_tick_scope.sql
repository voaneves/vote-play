-- tick_rounds() na mão do ARTISTA, não do pg_cron.
--
-- A função é concedida a `authenticated` porque o painel a usa como rede de
-- segurança quando o pg_cron está fora. O risco é o oposto do óbvio: não é ela
-- deixar o artista mexer em show alheio (assert_show_owner impede), é ela
-- ABORTAR ao esbarrar num show alheio — e aí a rede de segurança não existe
-- para ninguém a partir do segundo artista cadastrado.
--
-- Este teste é o par pode/não-pode: o artista faz a PRÓPRIA rodada andar e não
-- encosta na do vizinho, na mesma chamada.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_a1     uuid := '00000000-0000-4000-8000-000000000001';
  v_a2     uuid := '00000000-0000-4000-8000-0000000000a2';
  v_show1  uuid;
  v_show2  uuid;
  v_r1     rounds;
  v_r2     rounds;
  v_ids    uuid[];
  v_status round_status;
  v_n      int;
begin
  -- ------------------------------------------------ um segundo artista
  insert into auth.users (id, email) values (v_a2, 'vizinho@vote-play.test')
    on conflict (id) do nothing;
  insert into profiles (id, display_name) values (v_a2, 'Artista Vizinho')
    on conflict (id) do nothing;
  insert into songs (owner_id, title, artist_name) values
    (v_a2, 'Garota de Ipanema', 'Tom Jobim'),
    (v_a2, 'Aquarela', 'Toquinho')
  on conflict do nothing;

  -- ------------------------------------------------ um show para cada um
  insert into shows (owner_id, title, status, join_code,
                     round_duration_seconds, settlement_grace_seconds)
  values (v_a1, 'Show do Tick A', 'live', 'TCKA99', 30, 15)
  returning id into v_show1;
  insert into show_songs (show_id, song_id)
    select v_show1, id from songs where owner_id = v_a1 limit 3;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show1;
  select * into v_r1 from open_round(v_show1, v_ids, 30);

  insert into shows (owner_id, title, status, join_code,
                     round_duration_seconds, settlement_grace_seconds)
  values (v_a2, 'Show do Tick B', 'live', 'TCKB99', 30, 15)
  returning id into v_show2;
  insert into show_songs (show_id, song_id)
    select v_show2, id from songs where owner_id = v_a2;
  select array_agg(song_id) into v_ids from show_songs where show_id = v_show2;
  select * into v_r2 from open_round(v_show2, v_ids, 30);

  -- as duas vencem o prazo ao mesmo tempo (viagem no tempo, em vez de esperar)
  update rounds
     set closes_at = now() - interval '1 second',
         settle_by = now() - interval '1 second'
   where id in (v_r1.id, v_r2.id);

  -- -------------------------------- o artista 1 bate o relógio pelo painel
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_a1::text, true);

  -- ANTES da correção esta linha levantava
  -- "este show não pertence a você" por causa da rodada do artista 2
  select tick_rounds() into v_n;

  reset role;
  -- o claim é local à TRANSAÇÃO, não ao papel: sem limpar, a chamada seguinte
  -- continuaria se passando pelo artista 1
  perform set_config('request.jwt.claim.sub', '', true);

  select status into v_status from rounds where id = v_r1.id;
  assert v_status = 'settled',
    format('o artista deveria ter apurado a própria rodada; status %s', v_status);

  select status into v_status from rounds where id = v_r2.id;
  assert v_status = 'open',
    format('o tick do artista 1 encostou na rodada de outro artista (status %s)', v_status);

  -- ------------------- sem auth.uid() (pg_cron / service_role) varre tudo
  select tick_rounds() into v_n;
  assert v_n >= 2, format('o cron deveria ter encerrado e apurado a rodada pendente (tocou %s)', v_n);

  select status into v_status from rounds where id = v_r2.id;
  assert v_status = 'settled',
    format('sem auth.uid(), o tick precisa varrer o banco inteiro; status %s', v_status);

  raise notice 'OK — tick_rounds() escopado: o artista move a própria rodada, o cron move todas';
end $$;
