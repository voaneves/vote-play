-- As duas funções que a plateia chama. Contrato estreito: se elas vazarem algo
-- ou aceitarem o que não deviam, a chave anon pública vira problema.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_json    json;
  v_show    uuid;
  v_session uuid;
  v_n       int;
begin
  set local role anon;

  -- código inexistente
  begin
    perform join_show('ZZZZZZ', 'device-hash-de-teste');
    assert false, 'deveria recusar código inexistente';
  exception when no_data_found then null;
  end;

  -- device_hash frágil
  begin
    perform join_show('TESTE1', 'abc');
    assert false, 'deveria recusar identificador de dispositivo curto';
  exception when invalid_parameter_value then null;
  end;

  -- entrada válida
  v_json := join_show('TESTE1', 'device-hash-de-teste', 'Victor');
  v_show := (v_json -> 'show' ->> 'id')::uuid;
  v_session := (v_json -> 'session' ->> 'id')::uuid;
  assert v_show is not null, 'join_show não devolveu o show';
  assert v_session is not null, 'join_show não devolveu a sessão';
  assert v_json -> 'show' ->> 'joinCode' = 'TESTE1', 'código errado no retorno';
  assert v_json -> 'session' ->> 'nickname' = 'Victor', 'apelido não gravou';

  -- idempotência por dispositivo: o mesmo aparelho não cria sessão nova
  v_json := join_show('TESTE1', 'device-hash-de-teste');
  assert (v_json -> 'session' ->> 'id')::uuid = v_session,
    'o mesmo dispositivo deveria recuperar a sessão anterior';

  -- a conferência abaixo lê uma tabela que anon não enxerga (e não deve mesmo)
  reset role;
  select count(*) into v_n from audience_sessions
   where device_hash = 'device-hash-de-teste';
  assert v_n = 1, format('esperava 1 sessão para o dispositivo, achei %s', v_n);
  set local role anon;

  -- snapshot
  v_json := get_show_state(v_show, v_session);
  assert v_json ->> 'serverTime' is not null, 'snapshot sem serverTime';
  assert v_json -> 'round' is not null, 'snapshot sem rodada';
  assert json_array_length(v_json -> 'round' -> 'candidates') > 0, 'snapshot sem candidatas';

  -- candidatas já vêm ordenadas pelo critério de desempate
  assert (v_json -> 'round' -> 'candidates' -> 0 ->> 'weight')::bigint
      >= (v_json -> 'round' -> 'candidates' -> 1 ->> 'weight')::bigint,
    'as candidatas não vieram ordenadas por peso';

  -- o snapshot NÃO pode vazar valor individual de pedido
  for v_n in 0 .. json_array_length(v_json -> 'queue') - 1 loop
    assert (v_json -> 'queue' -> v_n ->> 'amountCents')::int = 0,
      'o snapshot público vazou o valor pago em um pedido';
  end loop;

  reset role;
  raise notice 'OK — join_show e get_show_state com contrato estreito';
end $$;

-- show fora do ar não é alcançável por nenhuma das duas
do $$
declare v_draft uuid; v_blocked int := 0;
begin
  insert into shows (owner_id, title, status, join_code)
  values ('00000000-0000-4000-8000-000000000001', 'Fechado', 'draft', 'HDDEN1')
  returning id into v_draft;

  set local role anon;
  begin
    perform join_show('HDDEN1', 'device-hash-de-teste');
    raise exception 'FALHA: entrou em show que não está no ar';
  exception when no_data_found then v_blocked := v_blocked + 1;
  end;
  begin
    perform get_show_state(v_draft);
    raise exception 'FALHA: leu estado de show que não está no ar';
  exception when no_data_found then v_blocked := v_blocked + 1;
  end;
  reset role;

  assert v_blocked = 2, format('esperava 2 bloqueios, contei %s', v_blocked);
  raise notice 'OK — show fora do ar é inalcançável pela plateia';
end $$;
