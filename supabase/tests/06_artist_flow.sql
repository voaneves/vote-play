-- O caminho completo do painel, executado como `authenticated` de verdade.
--
-- Os testes anteriores criavam shows como postgres (superusuário) e por isso
-- não enxergavam falta de GRANT nem de perfil. Este teste existe porque os dois
-- primeiros bugs do painel em produção passaram exatamente por essa fresta.
--
-- Atenção ao método: `set local role` só vale DENTRO de uma transação. Fora
-- dela é silenciosamente ignorado — e o teste roda como superusuário sem avisar.
-- Por isso tudo aqui está num bloco DO, que é uma transação.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- simula um cadastro pelo Supabase Auth
do $$
declare v_new uuid := '22222222-2222-4222-8222-222222222222';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_new, 'novo.artista@exemplo.com', '{"full_name":"Novo Artista"}'::jsonb);

  -- o trigger de cadastro precisa ter criado o perfil sozinho
  if not exists (select 1 from profiles where id = v_new) then
    raise exception 'o cadastro no Auth não criou o perfil do artista';
  end if;

  if (select display_name from profiles where id = v_new) <> 'Novo Artista' then
    raise exception 'o nome do perfil não veio dos metadados do cadastro';
  end if;

  raise notice 'OK — cadastro no Auth cria o perfil do artista';
end $$;

-- fluxo completo, com os privilégios de um artista comum
do $$
declare
  v_me    uuid := '22222222-2222-4222-8222-222222222222';
  v_show  uuid;
  v_code  text;
  v_song1 uuid;
  v_song2 uuid;
  v_round rounds;
  v_n     int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_me::text, true);

  -- repertório
  insert into songs (owner_id, title, artist_name)
  values (v_me, 'Música Um', 'Artista Um') returning id into v_song1;
  insert into songs (owner_id, title, artist_name)
  values (v_me, 'Música Dois', 'Artista Dois') returning id into v_song2;

  -- criar show: aqui morria com "permission denied for function generate_join_code"
  insert into shows (owner_id, title, venue)
  values (v_me, 'Show de Estreia', 'Bar de Teste')
  returning id, join_code into v_show, v_code;

  assert v_code ~ '^[0-9A-HJKMNP-TV-Z]{6}$',
    format('código inválido gerado pelo trigger: %s', v_code);

  -- colocar no ar
  update shows set status = 'live' where id = v_show;

  -- repertório do show
  insert into show_songs (show_id, song_id) values (v_show, v_song1), (v_show, v_song2);

  -- abrir rodada pela RPC do painel
  select * into v_round from open_round(v_show, array[v_song1, v_song2]);
  assert v_round.status = 'open', format('rodada deveria abrir; status %s', v_round.status);

  select count(*) into v_n from round_candidates where round_id = v_round.id;
  assert v_n = 2, format('esperava 2 candidatas, achei %s', v_n);

  -- encerrar e apurar, também pelo painel
  perform close_round_voting(v_round.id);
  perform settle_round(v_round.id, true);
  select status into v_round.status from rounds where id = v_round.id;
  assert v_round.status = 'settled', format('rodada deveria apurar; status %s', v_round.status);

  -- tick_rounds é liberada para o painel (rede de segurança se o pg_cron cair)
  perform tick_rounds();

  reset role;
  raise notice 'OK — artista autenticado cria repertório, show, rodada e apura';
end $$;

-- e continua sem alcançar o que não é dele
do $$
declare v_blocked int := 0;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

  -- o gerador de códigos permanece fechado para o cliente
  begin
    perform generate_join_code();
    raise exception 'FALHA: artista conseguiu chamar generate_join_code diretamente';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  -- e não enxerga o repertório de outro artista
  if exists (
    select 1 from songs where owner_id = '00000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FALHA: artista enxergou repertório de outro dono';
  end if;
  v_blocked := v_blocked + 1;

  reset role;
  assert v_blocked = 2, format('esperava 2 bloqueios, contei %s', v_blocked);
  raise notice 'OK — gerador de códigos e dados de terceiros seguem fechados';
end $$;
