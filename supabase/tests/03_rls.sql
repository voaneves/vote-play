-- A chave anon é pública por design (bundle estático no GitHub Pages).
-- Estes testes garantem que ela não serve para nada além de ler o placar.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Bloqueio conta tanto por falta de GRANT quanto por RLS que não devolve linha.
create or replace function _assert_anon_cannot_read(p_table text) returns void
language plpgsql as $$
declare v_n int;
begin
  execute format('select count(*) from %I', p_table) into v_n;
  if v_n > 0 then
    raise exception 'FALHA DE SEGURANÇA: anon leu % linha(s) de %', v_n, p_table;
  end if;
exception when insufficient_privilege then
  return;  -- negado no GRANT: ainda melhor
end $$;

do $$
declare v_n int;
begin
  insert into shows (owner_id, title, status, join_code)
  values ('00000000-0000-4000-8000-000000000001', 'Rascunho', 'draft', 'DRAFT1');

  set local role anon;

  -- PERMITIDO: shows no ar, e somente eles
  select count(*) into v_n from shows where status not in ('live','paused');
  assert v_n = 0, format('anon enxergou %s show(s) fora do ar', v_n);
  select count(*) into v_n from shows where join_code = 'DRAFT1';
  assert v_n = 0, 'anon não pode enxergar um show em rascunho';
  select count(*) into v_n from shows where join_code = 'TESTE1';
  assert v_n = 1, 'anon precisa enxergar o show que está no ar';

  select count(*) into v_n from round_candidates;
  assert v_n > 0, 'anon precisa ler o placar';

  -- NEGADO: dinheiro, identidade e acervo do artista
  perform _assert_anon_cannot_read('payments');
  perform _assert_anon_cannot_read('votes');
  perform _assert_anon_cannot_read('audience_sessions');
  perform _assert_anon_cannot_read('songs');
  perform _assert_anon_cannot_read('payment_events');
  perform _assert_anon_cannot_read('payment_accounts');
  perform _assert_anon_cannot_read('profiles');
  perform _assert_anon_cannot_read('show_events');

  reset role;
  raise notice 'OK — anon lê o placar e nada além disso';
end $$;

-- ESCRITA: anon não escreve em lugar nenhum.
do $$
declare
  v_round uuid; v_cand uuid; v_sess uuid; v_blocked int := 0;
begin
  select r.id, c.id into v_round, v_cand
    from rounds r join round_candidates c on c.round_id = r.id
   where r.status in ('open','closing') limit 1;
  select id into v_sess from audience_sessions limit 1;

  set local role anon;

  begin
    insert into votes (round_id, candidate_id, session_id, weight, amount_cents, status)
    values (v_round, v_cand, v_sess, 9999, 0, 'confirmed');
    raise exception 'FALHA DE SEGURANÇA: anon inseriu voto';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  begin
    update round_candidates set weight = 99999;
    if found then raise exception 'FALHA DE SEGURANÇA: anon alterou o placar'; end if;
    v_blocked := v_blocked + 1;
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  begin
    insert into payments (show_id, purpose, provider, amount_cents, status)
    values ((select id from shows limit 1), 'vote', 'fake', 1, 'paid');
    raise exception 'FALHA DE SEGURANÇA: anon criou pagamento';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  begin
    update shows set vote_min_cents = 1;
    if found then raise exception 'FALHA DE SEGURANÇA: anon alterou a configuração do show'; end if;
    v_blocked := v_blocked + 1;
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  reset role;
  assert v_blocked = 4, format('esperava 4 escritas bloqueadas, contei %s', v_blocked);
  raise notice 'OK — anon não escreve em lugar nenhum';
end $$;

-- FUNÇÕES DE DINHEIRO: inacessíveis para anon (o furo do SECURITY DEFINER).
do $$
declare v_blocked int := 0; v_pay uuid;
begin
  select id into v_pay from payments limit 1;
  set local role anon;

  begin
    perform confirm_payment(v_pay);
    raise exception 'FALHA DE SEGURANÇA: anon confirmou um pagamento';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  begin
    perform create_vote_intent(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 500);
    raise exception 'FALHA DE SEGURANÇA: anon criou intenção de voto';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  begin
    perform generate_join_code();
    raise exception 'FALHA DE SEGURANÇA: anon gerou código de show';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  reset role;
  assert v_blocked = 3, format('esperava 3 funções bloqueadas, contei %s', v_blocked);
  raise notice 'OK — funções de dinheiro fechadas para anon';
end $$;

-- ARTISTA: isolamento entre donos, inclusive nas funções do painel.
do $$
declare v_n int; v_round uuid; v_blocked int := 0;
begin
  select id into v_round from rounds limit 1;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  select count(*) into v_n from shows;
  assert v_n >= 2, format('o dono deveria ver os próprios shows, vê %s', v_n);
  select count(*) into v_n from songs;
  assert v_n > 0, 'o dono deveria ver o próprio repertório';

  -- outro artista
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ff', true);
  select count(*) into v_n from songs;
  assert v_n = 0, 'outro artista não pode ver este repertório';
  perform _assert_anon_cannot_read('payments');

  begin
    perform settle_round(v_round);
    raise exception 'FALHA DE SEGURANÇA: artista apurou rodada de outro show';
  exception when insufficient_privilege then v_blocked := v_blocked + 1;
  end;

  reset role;
  assert v_blocked = 1, 'a guarda de posse do show não bloqueou';
  raise notice 'OK — isolamento entre artistas, inclusive nas funções do painel';
end $$;

drop function _assert_anon_cannot_read(text);
