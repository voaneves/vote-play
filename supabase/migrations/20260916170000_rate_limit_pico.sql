-- Vote Play — rate limit redesenhado para o pico de entrada de um show.
--
-- O QUE ESTAVA ERRADO NA VERSÃO ANTERIOR (…140000)
--
-- 1. 30 entradas novas por minuto, por IP. Num show, a casa inteira sai pelo
--    mesmo IP (wi-fi do bar) e a operadora do celular usa CGNAT, que também
--    põe centenas de aparelhos atrás de um IP só. A rodada dura 5 minutos e a
--    fila lota no começo: 80 pessoas escaneando o QR no primeiro minuto é o
--    caso NORMAL, e a 31ª era recusada.
-- 2. A batida recusada contava. Quem tentava de novo prolongava o bloqueio —
--    ou seja, a plateia inteira tentando entrar mantinha a casa trancada.
-- 3. Uma linha por batida em `rate_limit_hits`. No plano Free do Supabase
--    (500 MB de banco, disco com 250 IOPS de base) isso é escrita e inchaço de
--    tabela proporcionais ao sucesso do show.
--
-- O QUE MUDA
--
-- * Contador por janela, uma linha por (balde, minuto), com a janela anterior
--   pesada pelo tempo que falta — a aproximação de janela deslizante que o
--   Cloudflare usa. Escrita constante por balde, não por batida.
-- * Recusa NÃO conta. Quem espera e tenta de novo entra assim que a taxa cai.
-- * O limite de entrada vira TETO DE PROTEÇÃO DO BANCO, não antifraude:
--   600 sessões novas por minuto por IP (10/s sustentado). Nenhuma plateia
--   real chega nisso atrás de um IP; um script chega. O que separa pessoa de
--   script é o Turnstile (Fase 6), e o painel não diz o contrário.
-- * O front tenta de novo sozinho, com espera aleatória, em vez de mostrar
--   erro (ver src/features/show/ShowProvider.tsx).
-- * IP: `cf-connecting-ip` primeiro. O Supabase fica atrás do Cloudflare, que
--   sobrescreve esse cabeçalho com o IP de quem conectou — o cliente não o
--   forja. O `x-forwarded-for` (valor mais à direita) fica como reserva.

-- ---------------------------------------------------------------------------
-- 1. O contador
-- ---------------------------------------------------------------------------

create table if not exists rate_limit_counters (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket, window_start)
);

comment on table rate_limit_counters is
  'Rate limit em janela fixa com peso da janela anterior (≈ deslizante). Uma '
  'linha por balde por janela. Efêmera: purge_rate_limits() apaga o que envelheceu.';

alter table rate_limit_counters enable row level security;
-- sem policy: só as funções SECURITY DEFINER e o service_role enxergam
revoke all on rate_limit_counters from anon, authenticated;
grant all on rate_limit_counters to service_role;

drop function if exists check_rate_limit(text, int, int);

/**
 * Tenta consumir uma unidade do balde. true = permitido (e contado).
 *
 * Estimativa = batidas_da_janela_anterior × (fração da janela atual que ainda
 * não passou) + batidas_da_janela_atual. Recusa não incrementa.
 *
 * Sob concorrência a leitura pode estar um passo atrás do incremento, então o
 * limite pode ser ultrapassado pelo número de chamadas simultâneas. Para um
 * teto de proteção isso é aceitável; um lock por balde serializaria a entrada
 * de toda a casa (mesmo IP) — exatamente o gargalo que não queremos no pico.
 *
 * `p_agora` existe para o teste controlar o relógio.
 */
create or replace function check_rate_limit(
  p_bucket          text,
  p_limite          int,
  p_janela_segundos int,
  p_agora           timestamptz default now()
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_epoch  double precision := extract(epoch from p_agora);
  v_inicio timestamptz;
  v_frac   double precision;
  v_atual  int;
  v_ant    int;
begin
  if p_bucket is null or btrim(p_bucket) = '' then
    return true;  -- sem chave não há o que limitar (ex.: IP indisponível)
  end if;

  v_inicio := to_timestamp(floor(v_epoch / p_janela_segundos) * p_janela_segundos);
  v_frac   := (v_epoch - extract(epoch from v_inicio)) / p_janela_segundos;

  select coalesce(sum(hits) filter (where window_start = v_inicio), 0),
         coalesce(sum(hits) filter (where window_start = v_inicio - make_interval(secs => p_janela_segundos)), 0)
    into v_atual, v_ant
    from rate_limit_counters
   where bucket = p_bucket
     and window_start >= v_inicio - make_interval(secs => p_janela_segundos);

  if v_ant * (1 - v_frac) + v_atual >= p_limite then
    return false;
  end if;

  insert into rate_limit_counters (bucket, window_start, hits)
  values (p_bucket, v_inicio, 1)
  on conflict (bucket, window_start) do update set hits = rate_limit_counters.hits + 1;

  return true;
end $$;

comment on function check_rate_limit(text, int, int, timestamptz) is
  'true = permitido e contado. Recusa não conta. Janela fixa com peso da anterior.';

create or replace function purge_rate_limits(p_manter_segundos int default 3600)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  delete from rate_limit_counters
   where window_start < now() - make_interval(secs => p_manter_segundos);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function check_rate_limit(text, int, int, timestamptz) from public, anon, authenticated;
revoke all on function purge_rate_limits(int)                        from public, anon, authenticated;
grant execute on function check_rate_limit(text, int, int, timestamptz) to service_role;
grant execute on function purge_rate_limits(int)                        to service_role;

-- a tabela antiga, uma linha por batida, sai
drop table if exists rate_limit_hits;

-- ---------------------------------------------------------------------------
-- 2. De onde vem o IP
-- ---------------------------------------------------------------------------

create or replace function request_ip_hash(p_salt text)
returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_headers json;
  v_xff     text;
  v_ip      text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;      -- não estamos atrás do PostgREST
  end;

  if v_headers is null then
    return null;
  end if;

  -- Cloudflare sobrescreve este cabeçalho: é o IP de quem conectou, e o
  -- cliente não consegue forjá-lo.
  v_ip := nullif(btrim(v_headers ->> 'cf-connecting-ip'), '');

  if v_ip is null then
    -- Reserva. Proxies ACRESCENTAM à direita; o valor mais à direita é o que
    -- o proxy mais próximo escreveu. O da esquerda qualquer cliente manda.
    v_xff := v_headers ->> 'x-forwarded-for';
    if v_xff is not null and btrim(v_xff) <> '' then
      v_ip := nullif(btrim(split_part(v_xff, ',', array_length(string_to_array(v_xff, ','), 1))), '');
    end if;
  end if;

  if v_ip is null then
    return null;
  end if;

  return encode(sha256(convert_to(coalesce(p_salt, '') || '|' || v_ip, 'utf8')), 'hex');
end $$;

revoke all on function request_ip_hash(text) from public, anon, authenticated;
grant execute on function request_ip_hash(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Os tetos
-- ---------------------------------------------------------------------------

alter table shows drop constraint if exists shows_join_rate_limit_check;
alter table shows alter column join_rate_limit set default 600;
alter table shows add constraint shows_join_rate_limit_check
  check (join_rate_limit between 1 and 10000);

-- shows que ficaram com o padrão antigo passam ao novo; valor escolhido à mão fica
update shows set join_rate_limit = 600 where join_rate_limit = 30;

comment on column shows.join_rate_limit is
  'Sessões NOVAS por minuto, por IP. Teto de proteção do banco, não antifraude: '
  'a casa inteira (wi-fi, CGNAT da operadora) divide o mesmo IP e chega toda de '
  'uma vez no começo do show. Reentrada do mesmo aparelho não conta.';
comment on column shows.vote_rate_limit is
  'Chamadas de voto por minuto, por sessão. Uma pessoa vota uma vez por rodada; '
  'o teto só pega script martelando a RPC.';
