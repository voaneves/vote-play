-- Rate limit: teto de proteção que não barra a plateia no pico de entrada.
-- A recusa não conta, a janela anterior pesa pelo tempo restante, e 300
-- aparelhos atrás do mesmo IP entram no primeiro minuto.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- 1. A primitiva, isolada do resto.
do $$
declare
  v_passou  int := 0;
  v_barrou  int := 0;
  -- relógio fixo no começo de uma janela: sem peso de janela anterior
  v_t       timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  i         int;
begin
  delete from rate_limit_counters where bucket like 'teste:%';

  for i in 1..5 loop
    if check_rate_limit('teste:primitiva', 3, 60, v_t) then
      v_passou := v_passou + 1;
    else
      v_barrou := v_barrou + 1;
    end if;
  end loop;

  assert v_passou = 3, format('limite 3 deveria deixar passar 3, passaram %s', v_passou);
  assert v_barrou = 2, format('as outras 2 deveriam ser barradas, foram %s', v_barrou);

  -- a recusa NÃO conta: o contador parou em 3, não em 5
  assert (select hits from rate_limit_counters where bucket = 'teste:primitiva') = 3,
    'batida recusada não pode entrar na conta';

  -- balde diferente é vida independente
  assert check_rate_limit('teste:outro-balde', 3, 60, v_t), 'um balde não pode afetar o outro';

  -- bucket vazio não limita nada (é o caso de IP indisponível)
  assert check_rate_limit(null, 1, 60), 'bucket nulo deveria ser permitido';
  assert check_rate_limit('', 1, 60),   'bucket vazio deveria ser permitido';

  raise notice 'OK — o balde conta, recusa sem contar a recusa e isola por chave';
end $$;

-- 2. A janela anterior pesa pelo tempo que falta, e some quando a atual acaba.
--    É o comportamento que importa no pico: quem foi recusado no segundo 10
--    entra alguns segundos depois, sem esperar o minuto inteiro.
do $$
declare
  v_ini timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  i     int;
begin
  delete from rate_limit_counters where bucket = 'teste:janela';

  -- enche a janela anterior até o teto (10)
  for i in 1..10 loop
    perform check_rate_limit('teste:janela', 10, 60, v_ini - interval '30 seconds');
  end loop;

  -- no começo da janela nova a anterior ainda pesa 100%: barrado
  assert not check_rate_limit('teste:janela', 10, 60, v_ini),
    'no início da janela nova a anterior ainda pesa inteira';

  -- com 45 s passados ela pesa 25% (2,5 batidas): cabe
  assert check_rate_limit('teste:janela', 10, 60, v_ini + interval '45 seconds'),
    'passada a maior parte da janela, a anterior não pode mais barrar';

  -- duas janelas depois, nada do passado conta
  for i in 1..10 loop
    assert check_rate_limit('teste:janela', 10, 60, v_ini + interval '120 seconds'),
      'janela antiga não pode contar duas janelas depois';
  end loop;

  raise notice 'OK — a janela anterior pesa pelo tempo restante e depois some';
end $$;

-- 3. purge_rate_limits limpa o velho e preserva o novo.
do $$
declare v_apagadas int; v_restam int;
begin
  delete from rate_limit_counters where bucket like 'teste:purge%';
  insert into rate_limit_counters (bucket, window_start, hits) values
    ('teste:purge', now() - interval '3 hours', 5),
    ('teste:purge', now() - interval '2 hours', 5),
    ('teste:purge', now(), 1);

  select purge_rate_limits(3600) into v_apagadas;
  assert v_apagadas = 2, format('deveria ter apagado as 2 antigas, apagou %s', v_apagadas);

  select count(*) into v_restam from rate_limit_counters where bucket = 'teste:purge';
  assert v_restam = 1, format('a janela recente tinha de sobrar, restaram %s', v_restam);

  raise notice 'OK — purge apaga o que envelheceu e preserva o que vale';
end $$;

-- 3b. O pico real: 300 pessoas atrás do MESMO IP entrando no primeiro minuto.
--     Com o teto padrão, ninguém é recusado.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_show  uuid;
  v_code  text;
  v_recusadas int := 0;
  i int;
begin
  -- o código fica por conta do trigger: inventar à mão já quebrou teste por
  -- causa do alfabeto (O, I, L e U não existem nele)
  insert into shows (owner_id, title, status, vote_mode)
  values (v_owner, 'Show Lotado', 'live', 'free')
  returning id, join_code into v_show, v_code;

  assert (select join_rate_limit from shows where id = v_show) = 600,
    'o teto padrão de entrada tem de ser 600/min';

  perform set_config('request.headers', '{"cf-connecting-ip": "177.10.10.10"}', true);
  for i in 1..300 loop
    begin
      perform join_show(v_code, 'aparelho-' || i);
    exception when too_many_connections then
      v_recusadas := v_recusadas + 1;
    end;
  end loop;
  perform set_config('request.headers', '', true);

  assert v_recusadas = 0, format('%s pessoas da mesma casa foram barradas', v_recusadas);
  assert (select count(distinct ip_hash) from audience_sessions where show_id = v_show) = 1,
    'a casa inteira devia cair no mesmo hash';

  raise notice 'OK — 300 aparelhos no mesmo IP entram no primeiro minuto sem recusa';
end $$;

-- 3c. O teto ainda existe: acima dele recusa, e a recusa não prende ninguém.
do $$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_code  text;
  v_recusadas int := 0;
  i int;
begin
  insert into shows (owner_id, title, status, vote_mode, join_rate_limit)
  values (v_owner, 'Show do Teto', 'live', 'free', 5)
  returning join_code into v_code;

  perform set_config('request.headers', '{"cf-connecting-ip": "177.20.20.20"}', true);
  for i in 1..8 loop
    begin
      perform join_show(v_code, 'aparelho-teto-' || i);
    exception when too_many_connections then
      v_recusadas := v_recusadas + 1;
    end;
  end loop;
  perform set_config('request.headers', '', true);

  assert v_recusadas = 3, format('com teto 5, 3 de 8 deviam ser recusadas; foram %s', v_recusadas);
  raise notice 'OK — acima do teto a entrada é recusada com código próprio (53300)';
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

-- 6. Com cabeçalho presente, o hash sai salgado pelo show. O IP vem do
--    cf-connecting-ip (o Cloudflare sobrescreve); sem ele, do valor mais à
--    DIREITA do x-forwarded-for. O que o cliente escreve não muda nada.
do $$
declare
  v_a text; v_b text; v_x text;
begin
  perform set_config('request.headers', '{"cf-connecting-ip": "200.1.1.1"}', true);
  v_a := request_ip_hash('show-A');
  v_b := request_ip_hash('show-B');

  assert v_a is not null, 'com cabeçalho, o hash não podia ser nulo';
  assert v_a <> v_b, 'o sal por show tinha de gerar hashes diferentes';
  assert v_a !~ '200\.1\.1\.1', 'o IP não pode aparecer no hash';
  assert length(v_a) = 64, format('sha256 em hex tem 64 chars, veio %s', length(v_a));

  -- cliente forjando o x-forwarded-for com o cf-connecting-ip presente
  perform set_config('request.headers',
    '{"cf-connecting-ip": "200.1.1.1", "x-forwarded-for": "9.9.9.9"}', true);
  assert request_ip_hash('show-A') = v_a, 'x-forwarded-for forjado não pode ganhar do cf-connecting-ip';

  -- sem cf-connecting-ip: vale o da direita
  perform set_config('request.headers', '{"x-forwarded-for": "1.2.3.4, 200.1.1.1"}', true);
  v_x := request_ip_hash('show-A');
  assert v_x = v_a, 'o valor à esquerda (forjável) não podia mudar o hash';

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
    perform check_rate_limit('x', 1, 60, now());
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
delete from rate_limit_counters where bucket like 'teste:%';
