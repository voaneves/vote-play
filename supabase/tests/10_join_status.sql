-- "Código não encontrado" só pode aparecer quando o código realmente não existe.
-- Um show em rascunho tem que dizer que está em rascunho: foi essa confusão que
-- mandou o artista caçar bug no lugar errado em 15/09.
\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_code  text;
  v_msg   text;
  v_json  json;
begin
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show de Status', 'draft', 'free')
  returning id, join_code into v_show, v_code;

  set local role anon;

  -- 1. rascunho: existe, mas não está no ar
  begin
    perform join_show(v_code, 'aparelho-status-0001');
    raise exception 'FALHA: entrou num show em rascunho';
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text;
    assert v_msg not like '%não encontrado%',
      format('rascunho não pode dizer "não encontrado": %s', v_msg);
    assert v_msg like '%não está no ar%',
      format('rascunho deveria dizer que não está no ar: %s', v_msg);
  end;

  reset role;
  update shows set status = 'ready' where id = v_show;
  set local role anon;

  -- 2. 'ready' também não é "no ar"
  begin
    perform join_show(v_code, 'aparelho-status-0001');
    raise exception 'FALHA: entrou num show em ready';
  exception when invalid_parameter_value then null;
  end;

  reset role;
  update shows set status = 'live' where id = v_show;
  set local role anon;

  -- 3. no ar: entra
  v_json := join_show(v_code, 'aparelho-status-0001');
  assert v_json -> 'show' ->> 'joinCode' = v_code, 'o join não devolveu o show certo';
  assert (v_json -> 'session' ->> 'id') is not null, 'o join não criou sessão';

  reset role;
  update shows set status = 'paused' where id = v_show;
  set local role anon;

  -- 4. pausado ainda entra: quem chega no intervalo vê a tela, não um erro
  v_json := join_show(v_code, 'aparelho-status-0002');
  assert (v_json -> 'session' ->> 'id') is not null, 'show pausado deveria aceitar entrada';

  reset role;
  update shows set status = 'ended' where id = v_show;
  set local role anon;

  -- 5. encerrado: diz que terminou, não que sumiu
  begin
    perform join_show(v_code, 'aparelho-status-0003');
    raise exception 'FALHA: entrou num show encerrado';
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text;
    assert v_msg like '%já terminou%',
      format('encerrado deveria dizer que terminou: %s', v_msg);
  end;

  -- 6. código que não existe mesmo: aí sim, "não encontrado" — e nada além disso
  begin
    perform join_show('ZZZZZZ', 'aparelho-status-0004');
    raise exception 'FALHA: entrou com código inexistente';
  exception when no_data_found then
    get stacked diagnostics v_msg = message_text;
    assert v_msg like '%não encontrado%', format('esperava "não encontrado": %s', v_msg);
  end;

  reset role;
  raise notice 'OK — join_show distingue rascunho, pausado, encerrado e inexistente';
end $$;
