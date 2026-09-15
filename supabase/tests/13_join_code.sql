-- O código de entrada do show é único enquanto o show pode receber gente —
-- rascunho incluído — e join_show nunca devolve o show errado.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- 1. Dois RASCUNHOS não dividem o mesmo código.
--
-- Antes da correção o índice só cobria ('ready','live','paused'), então dois
-- rascunhos com o mesmo código entravam sem reclamar — e o conflito só
-- aparecia quando o segundo subisse para o ar, no meio do show.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_barrado boolean := false;
begin
  insert into shows (owner_id, title, status, join_code)
  values (v_owner, 'Rascunho A', 'draft', 'REPET9');

  begin
    insert into shows (owner_id, title, status, join_code)
    values (v_owner, 'Rascunho B', 'draft', 'REPET9');
  exception when unique_violation then
    v_barrado := true;
  end;

  assert v_barrado, 'dois rascunhos conseguiram dividir o mesmo código de entrada';
  raise notice 'OK — código de entrada é exclusivo desde o rascunho';
end $$;

-- 2. Código reciclado: o show NO AR ganha do homônimo encerrado.
--
-- Shows 'ended' liberam o código de volta de propósito (é o que mantém 6
-- caracteres viável). O preço é que join_show pode encontrar duas linhas — e
-- sem ordem explícita o Postgres devolve qualquer uma.
do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_antigo uuid;
  v_novo   uuid;
  v_json   json;
begin
  insert into shows (owner_id, title, status, join_code, ended_at)
  values (v_owner, 'Show de Ontem', 'ended', 'RECYC1', now() - interval '1 day')
  returning id into v_antigo;

  insert into shows (owner_id, title, status, join_code)
  values (v_owner, 'Show de Hoje', 'live', 'RECYC1')
  returning id into v_novo;

  v_json := join_show('RECYC1', 'device-hash-reciclado');

  assert (v_json -> 'show' ->> 'id')::uuid = v_novo,
    'join_show devolveu o show encerrado no lugar do que está no ar';
  assert v_json -> 'show' ->> 'title' = 'Show de Hoje',
    'join_show devolveu o título errado para um código reciclado';

  raise notice 'OK — código reciclado devolve o show que está no ar';
end $$;

-- 3. As três mensagens continuam distintas: não existe, ainda não abriu, já terminou.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_msg   text;
begin
  insert into shows (owner_id, title, status, join_code)
  values (v_owner, 'Ainda Fechado', 'draft', 'FECHA9');
  insert into shows (owner_id, title, status, join_code, ended_at)
  values (v_owner, 'Já Foi', 'ended', 'PASSD9', now());

  begin
    perform join_show('ZZZZZZ', 'device-hash-inexistente');
    assert false, 'código inexistente deveria falhar';
  exception when no_data_found then null;
  end;

  begin
    perform join_show('FECHA9', 'device-hash-rascunho');
    assert false, 'show em rascunho deveria recusar a entrada';
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text;
    assert v_msg like '%ainda não está no ar%',
      format('mensagem errada para show em rascunho: %s', v_msg);
  end;

  begin
    perform join_show('PASSD9', 'device-hash-encerrado');
    assert false, 'show encerrado deveria recusar a entrada';
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text;
    assert v_msg like '%já terminou%',
      format('mensagem errada para show encerrado: %s', v_msg);
  end;

  raise notice 'OK — join_show distingue não existe, ainda não abriu e já terminou';
end $$;
