-- Vote Play — Row Level Security
--
-- Princípio: o cliente anônimo NÃO escreve nada diretamente. Toda escrita passa
-- por Edge Function com service_role, que valida antes. A chave anon vai no
-- bundle do GitHub Pages e é pública por design — a segurança está aqui.

alter table profiles          enable row level security;
alter table payment_accounts  enable row level security;
alter table songs             enable row level security;
alter table shows             enable row level security;
alter table show_songs        enable row level security;
alter table rounds            enable row level security;
alter table round_candidates  enable row level security;
alter table audience_sessions enable row level security;
alter table votes             enable row level security;
alter table direct_requests   enable row level security;
alter table payments          enable row level security;
alter table payment_events    enable row level security;
alter table show_events       enable row level security;

-- ------------------------------------------------------------ artista (dono)

create policy profiles_self on profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy payment_accounts_owner on payment_accounts
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy songs_owner on songs
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy shows_owner on shows
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy show_songs_owner on show_songs
  for all to authenticated
  using (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()));

create policy rounds_owner on rounds
  for all to authenticated
  using (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()));

create policy round_candidates_owner on round_candidates
  for all to authenticated
  using (exists (
    select 1 from rounds r join shows s on s.id = r.show_id
     where r.id = round_id and s.owner_id = auth.uid()))
  with check (exists (
    select 1 from rounds r join shows s on s.id = r.show_id
     where r.id = round_id and s.owner_id = auth.uid()));

create policy direct_requests_owner on direct_requests
  for all to authenticated
  using (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()));

create policy payments_owner_read on payments
  for select to authenticated
  using (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()));

create policy votes_owner_read on votes
  for select to authenticated
  using (exists (
    select 1 from rounds r join shows s on s.id = r.show_id
     where r.id = round_id and s.owner_id = auth.uid()));

create policy show_events_owner_read on show_events
  for select to authenticated
  using (exists (select 1 from shows s where s.id = show_id and s.owner_id = auth.uid()));

-- `payment_events` não tem policy nenhuma: só service_role enxerga.

-- -------------------------------------------------------------- plateia (anon)
-- Leitura apenas, e apenas de show que está no ar.

create policy shows_public_read on shows
  for select to anon, authenticated
  using (status in ('live', 'paused'));

create policy rounds_public_read on rounds
  for select to anon, authenticated
  using (exists (
    select 1 from shows s where s.id = show_id and s.status in ('live', 'paused')));

create policy round_candidates_public_read on round_candidates
  for select to anon, authenticated
  using (exists (
    select 1 from rounds r join shows s on s.id = r.show_id
     where r.id = round_id and s.status in ('live', 'paused')));

-- A fila de pedidos é pública, mas sem expor valores individuais:
-- a UI consome a view `public_queue` abaixo.
create policy direct_requests_public_read on direct_requests
  for select to anon, authenticated
  using (
    status in ('paid', 'accepted', 'played')
    and exists (select 1 from shows s where s.id = show_id and s.status in ('live', 'paused'))
  );

create view public_queue
with (security_invoker = true) as
  select id, show_id, title, artist_name, message, requester_name,
         status, queue_position, created_at
    from direct_requests
   where status in ('paid', 'accepted', 'played');

-- `votes`, `payments` e `audience_sessions` permanecem invisíveis para anon:
-- o que a plateia precisa ver já está agregado em round_candidates.

-- ------------------------------------------------------------------- Realtime

alter table round_candidates replica identity full;
alter table rounds           replica identity full;
alter table direct_requests  replica identity full;
