-- Vote Play — dados de desenvolvimento.
-- Cria repertório e um show NO AR com código TESTE1, para o app rodar contra o
-- Supabase exatamente como roda contra o mock.
--
-- NÃO rode isto em produção.
--
-- Sobre o dono: o `auth.users` é gerenciado pelo Supabase Auth. Em vez de forçar
-- um usuário sintético (que pode esbarrar em constraints do projeto hospedado e
-- nem conseguiria fazer login), o seed REUTILIZA o primeiro usuário que existir.
-- Se não houver nenhum, ele tenta criar um e, falhando, avisa em vez de quebrar.

do $$
declare
  v_owner  uuid;
  v_show   uuid;
  v_ids    uuid[];
  v_title  text;
  v_artist text;
begin
  -- 1. dono: prefere um usuário real já cadastrado
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

  -- 2. repertório
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

  -- 3. show de demonstração (idempotente: não duplica se o seed rodar de novo)
  select id into v_show from shows where join_code = 'TESTE1';
  if v_show is not null then
    raise notice 'O show TESTE1 já existe (%). Seed não fez nada.', v_show;
    return;
  end if;

  insert into shows (
    owner_id, title, venue, city, status, join_code,
    vote_mode, vote_min_cents, vote_max_cents, vote_suggested_cents,
    cents_per_point, round_duration_seconds, direct_request_price_cents
  )
  values (
    v_owner, 'Ensaio Aberto', 'Bar do Zé', 'Palmas, TO', 'live', 'TESTE1',
    'paid_weighted', 200, 20000, '{200,500,1000}', 100, 300, 3000
  )
  returning id into v_show;

  insert into show_songs (show_id, song_id)
  select v_show, id from songs where owner_id = v_owner;

  select array_agg(song_id) into v_ids
    from (select song_id from show_songs where show_id = v_show limit 4) t;

  perform open_round(v_show, v_ids);

  raise notice 'Seed pronto: show % com código TESTE1, rodada aberta, dono %.', v_show, v_owner;
end $$;
