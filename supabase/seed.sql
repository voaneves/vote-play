-- Vote Play — dados de desenvolvimento.
--
-- Cria repertório e TRÊS shows no ar, um por modo de votação, para o app rodar
-- contra o Supabase exatamente como roda contra o provider em memória:
--
--   PAGAR1 — pix        — todo voto passa pelo Pix
--   GRAM99 — instagram  — voto grátis atrás do portão do perfil
--   FREE01 — free       — voto grátis e direto
--
-- Os códigos são os MESMOS do mock (`src/lib/api/mock.ts`), de propósito: no
-- QA ninguém precisa lembrar de dois conjuntos, e trocar o provider deixa de
-- exigir trocar o que se digita na tela de entrada.
--
-- Os códigos respeitam o alfabeto Crockford — sem I, L, O e U. Isso já custou
-- caro quatro vezes neste projeto (DEMO01 e PAGO01 têm a letra O, que o
-- alfabeto não tem), então o bloco abaixo VALIDA os três antes de usar, em vez
-- de confiar em revisão humana.
--
-- NÃO rode isto em produção.
--
-- Sobre o dono: `auth.users` é gerenciado pelo Supabase Auth. Em vez de forçar
-- um usuário sintético (que pode esbarrar em constraints do projeto hospedado
-- e nem conseguiria fazer login), o seed REUTILIZA o primeiro usuário que
-- existir. Se não houver nenhum, ele tenta criar um e, falhando, avisa em vez
-- de quebrar.

do $$
declare
  v_owner  uuid;
  v_show   uuid;
  v_ids    uuid[];
  v_title  text;
  v_artist text;
  v_criados int := 0;
  s        record;
begin
  ---------------------------------------------------------------- 1. o dono
  select id into v_owner from auth.users order by created_at nulls first limit 1;

  if v_owner is null then
    v_owner := '00000000-0000-4000-8000-000000000001';
    begin
      insert into auth.users (id, email) values (v_owner, 'artista@vote-play.test');
    exception when others then
      raise notice 'Não foi possível criar um usuário de teste (%).', sqlerrm;
      raise notice 'Cadastre-se pelo app (ou em Authentication > Users) e rode o seed de novo.';
      return;
    end;
  end if;

  insert into profiles (id, display_name, slug)
  values (v_owner, 'Artista de Teste', 'artista-teste')
  on conflict (id) do update set display_name = excluded.display_name;

  ---------------------------------------------------------- 2. o repertório
  for v_title, v_artist in
    select * from (values
      ('Bohemian Rhapsody', 'Queen'),
      ('Evidências', 'Chitãozinho & Xororó'),
      ('Hotel California', 'Eagles'),
      ('Sozinho', 'Caetano Veloso'),
      ('Wonderwall', 'Oasis'),
      ('Tempo Perdido', 'Legião Urbana')
    ) as t(title, artist)
  loop
    insert into songs (owner_id, title, artist_name) values (v_owner, v_title, v_artist)
    on conflict do nothing;
  end loop;

  -------------------------------------------------- 3. um show por modo
  for s in
    select * from (values
      ('PAGAR1', 'Ensaio Aberto',    'pix'::vote_mode,       null::text,      0),
      ('GRAM99', 'Quinta Acústica',  'instagram'::vote_mode, 'banda.oficial', 1),
      ('FREE01', 'Sarau da Casa',    'free'::vote_mode,      null::text,      1)
    ) as t(code, title, mode, handle, free_votes)
  loop
    -- a trava que o projeto aprendeu a ter: código fora do alfabeto entra no
    -- banco e só falha quando alguém tenta digitá-lo no celular
    if s.code !~ '^[0-9A-HJKMNP-TV-Z]{6}$' then
      raise exception 'código de seed inválido: "%" usa letra fora do alfabeto (I, L, O e U não existem)', s.code;
    end if;

    -- idempotente: rodar o seed de novo não duplica nem sobrescreve
    if exists (select 1 from shows where join_code = s.code) then
      raise notice 'O show % já existe. Seed não mexeu nele.', s.code;
      continue;
    end if;

    insert into shows (
      owner_id, title, venue, city, status, join_code,
      vote_mode, instagram_handle, free_votes_per_round,
      vote_min_cents, vote_max_cents, vote_suggested_cents,
      cents_per_point, round_duration_seconds, direct_request_price_cents
    )
    values (
      v_owner, s.title, 'Bar do Zé', 'Palmas, TO', 'live', s.code,
      s.mode, s.handle, s.free_votes,
      200, 20000, '{200,500,1000}', 100, 300, 3000
    )
    returning id into v_show;

    insert into show_songs (show_id, song_id)
    select v_show, id from songs where owner_id = v_owner;

    -- 4 candidatas na primeira rodada; as outras 2 ficam disponíveis, para
    -- dar o que escolher na próxima rodada sem precisar mexer no repertório
    select array_agg(song_id) into v_ids
      from (select song_id from show_songs where show_id = v_show order by created_at limit 4) t;

    perform open_round(v_show, v_ids);

    v_criados := v_criados + 1;
    raise notice 'Show % (%) no ar, rodada aberta: %', s.code, s.mode, v_show;
  end loop;

  raise notice 'Seed pronto: % show(s) criado(s), dono %.', v_criados, v_owner;
end $$;
