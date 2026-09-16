-- Rate limit: a janela desliza, a batida recusada conta, e o limite não
-- atrapalha quem está usando o app normalmente.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- 1. A primitiva, isolada do resto.
do $$
declare
  v_ok      boolean;
  v_passou  int := 0;
  v_barrou  int := 0;
  i         int;
begin
  for i in 1..5 loop
    if check_rate_limit('teste:primitiva', 3, 60) then
      v_passou := v_passou + 1;
    else
      v_barrou := v_barrou + 1;
    end if;
  end loop;

  assert v_passou = 3, format('limite 3 deveria deixar passar 3, passaram %s', v_passou);
  assert v_barrou = 2, format('as outras 2 deveriam ser barradas, foram %s', v_barrou);

  -- a batida recusada CONTA: quem martela continua barrado
  v_ok := check_rate_limit('teste:primitiva', 3, 60);
  assert not v_ok, 'martelar não pode destravar o limite';

  -- balde diferente é vida independente
  assert check_rate_limit('teste:outro-balde', 3, 60), 'um balde não pode afetar o outro';

  -- bucket vazio não limita nada (é o caso de IP indisponível)
  assert check_rate_limit(null, 1, 60), 'bucket nulo deveria ser permitido';
  assert check_rate_limit('', 1, 60),   'bucket vazio deveria ser permitido';

  raise notice 'OK — janela deslizante conta, recusa e isola por balde';
end $$;

-- 2. A janela realmente DESLIZA (batida velha sai da conta).
do $$
begin
  delete from rate_limit_hits where bucket = 'teste:janela';

  -- duas batidas antigas, uma recente
  insert into rate_limit_hits (bucket, hit_at) values
    ('teste:janela', now() - interval '2 minutes'),
    ('teste:janela', now() - interval '90 seconds'),
    ('teste:janela', now() - interval '10 seconds');

  -- janela de 60s enxerga só a recente, então ainda cabe
  assert check_rate_limit('teste:janela', 2, 60),
    'batidas fora da janela não podiam contar';

  -- janela de 300s enxerga as três (+1 que a linha acima inseriu) e estoura
  assert not check_rate_limit('teste:janela', 2, 300),
    'batidas dentro da janela tinham de contar';

  raise notice 'OK — a janela desliza: o que envelheceu deixa de contar';
end $$;

-- 3. purge_rate_limits limpa o velho e preserva o novo.
do $$
declare v_apagadas int; v_restam int;
begin
  delete from rate_limit_hits where bucket like 'teste:purge%';
  insert into rate_limit_hits (bucket, hit_at) values
    ('teste:purge', now() - interval '3 hours'),
    ('teste:purge', now() - interval '2 hours'),
    ('teste:purge', now());

  select purge_rate_limits(3600) into v_apagadas;
  assert v_apagadas = 2, format('deveria ter apagado as 2 antigas, apagou %s', v_apagadas);

  select count(*) into v_restam from rate_limit_hits where bucket = 'teste:purge';
  assert v_restam = 1, format('a batida recente tinha de sobrar, restaram %s', v_restam);

  raise notice 'OK — purge apaga o que envelheceu e preserva o que vale';
end $$;

-- 4. join_show: entrar de novo com o MESMO aparelho nunca esbarra no limite.
--
-- É o caso que mais acontece de verdade: wi-fi ruim, a pessoa recarrega a
-- página cinco vezes. Se isso consumisse cota, o rate limit puniria justamente
-- quem está com a pior internet da casa.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_json  json;
  i       int;
begin
  insert into shows (owner_id, title, status, join_code, vote_mode, join_rate_limit)
  values (v_owner, 'Show do Rate Limit', 'live', 'RATE99', 'free', 2)
  returning id into v_show;

  -- limite é 2 por minuto; 10 reentradas do mesmo aparelho têm de passar
  for i in 1..10 loop
    v_json := join_show('RATE99', 'device-sempre-o-mesmo');
  end loop;

  assert (v_json -> 'session' ->> 'showId')::uuid = v_show,
    'reentrada devolveu sessão de outro show';

  assert (select count(*) from audience_sessions where show_id = v_show) = 1,
    'reentrada do mesmo aparelho não podia criar sessão nova';

  raise notice 'OK — recarregar a página não gasta cota de rate limit';
end $$;

-- 5. Fora do PostgREST não há cabeçalho de requisição: o IP some e o limite
--    por IP simplesmente não se aplica, em vez de quebrar a entrada.
do $$
declare v_json json; v_ip text;
begin
  assert request_ip_hash('salt-qualquer') is null,
    'sem request.headers, o hash de IP tinha de ser nulo';

  v_json := join_show('RATE99', 'device-outro-aparelho');
  select ip_hash into v_ip from audience_sessions
   where show_id = (select id from shows where join_code = 'RATE99')
     and device_hash = 'device-outro-aparelho';

  assert v_ip is null, 'sem IP disponível, a coluna tinha de ficar nula';
  raise notice 'OK — sem IP a entrada continua funcionando (limite só não se aplica)';
end $$;

-- 6. Com cabeçalho presente, o hash sai salgado pelo show e pega o IP da
--    DIREITA do x-forwarded-for — o único que o cliente não forja.
do $$
declare
  v_a text; v_b text; v_forjado text;
begin
  perform set_config(
    'request.headers',
    '{"x-forwarded-for": "200.1.1.1"}',
    true);

  v_a := request_ip_hash('show-A');
  v_b := request_ip_hash('show-B');

  assert v_a is not null, 'com cabeçalho, o hash não podia ser nulo';
  assert v_a <> v_b, 'o sal por show tinha de gerar hashes diferentes';
  assert v_a !~ '200\.1\.1\.1', 'o IP não pode aparecer no hash';
  assert length(v_a) = 64, format('sha256 em hex tem 64 chars, veio %s', length(v_a));

  -- cliente tentando se passar por outro IP acrescenta à ESQUERDA;
  -- o proxy escreve à direita. Pegamos o da direita.
  perform set_config(
    'request.headers',
    '{"x-forwarded-for": "1.2.3.4, 200.1.1.1"}',
    true);
  v_forjado := request_ip_hash('show-A');

  assert v_forjado = v_a,
    'o cabeçalho forjado pelo cliente não podia mudar o hash';

  perform set_config('request.headers', '', true);
  raise notice 'OK — hash salgado por show, e IP forjado pelo cliente é ignorado';
end $$;

-- 7. O painel enxerga sessões agrupadas por IP — e só o dono.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_n     int;
  v_barrou boolean := false;
begin
  insert into shows (owner_id, title, status, join_code, vote_mode)
  values (v_owner, 'Show Suspeito', 'live', 'SPECT9', 'free')
  returning id into v_show;

  -- três sessões no mesmo IP, uma sozinha em outro
  insert into audience_sessions (show_id, device_hash, ip_hash) values
    (v_show, 'dev-1', 'aaaaaaaaaaaaaaaa'),
    (v_show, 'dev-2', 'aaaaaaaaaaaaaaaa'),
    (v_show, 'dev-3', 'aaaaaaaaaaaaaaaa'),
    (v_show, 'dev-4', 'bbbbbbbbbbbbbbbb');

  select count(*) into v_n from show_suspicious_sessions(v_show);
  assert v_n = 1, format('só o IP com mais de uma sessão devia aparecer, vieram %s', v_n);

  select sessoes into v_n from show_suspicious_sessions(v_show) limit 1;
  assert v_n = 3, format('o grupo tinha de ter 3 sessões, tem %s', v_n);

  -- outro artista não enxerga
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ff', true);
  begin
    perform show_suspicious_sessions(v_show);
    raise exception 'FALHA DE SEGURANÇA: artista viu sessões de show alheio';
  exception when insufficient_privilege then v_barrou := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  assert v_barrou, 'a guarda de posse não bloqueou';
  raise notice 'OK — agrupamento por IP existe, e só para o dono do show';
end $$;

-- 8. anon não alcança nada disto.
do $$
declare v_barradas int := 0;
begin
  set local role anon;

  begin
    perform check_rate_limit('x', 1, 60);
    raise exception 'FALHA: anon chamou check_rate_limit';
  exception when insufficient_privilege then v_barradas := v_barradas + 1;
  end;

  begin
    perform purge_rate_limits();
    raise exception 'FALHA: anon chamou purge_rate_limits';
  exception when insufficient_privilege then v_barradas := v_barradas + 1;
  end;

  begin
    perform request_ip_hash('x');
    raise exception 'FALHA: anon chamou request_ip_hash';
  exception when insufficient_privilege then v_barradas := v_barradas + 1;
  end;

  begin
    perform show_suspicious_sessions(gen_random_uuid());
    raise exception 'FALHA: anon chamou show_suspicious_sessions';
  exception when insufficient_privilege then v_barradas := v_barradas + 1;
  end;

  reset role;
  assert v_barradas = 4, format('esperava 4 funções fechadas para anon, contei %s', v_barradas);
  raise notice 'OK — as funções de rate limit estão fechadas para a chave pública';
end $$;

-- limpeza dos baldes de teste, para não poluir outras execuções
delete from rate_limit_hits where bucket like 'teste:%';
