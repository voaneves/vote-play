-- Vote Play — tabelas
-- Dinheiro SEMPRE em centavos (integer). Tempo SEMPRE timestamptz.

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  slug         text unique,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table payment_accounts (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references profiles(id) on delete cascade,
  provider            pix_provider not null,
  external_account_id text,
  -- ponteiro para o Supabase Vault. O segredo NUNCA fica nesta tabela.
  credentials_ref     text not null,
  pix_key_masked      text,
  is_default          boolean not null default false,
  created_at          timestamptz not null default now()
);
create unique index payment_accounts_one_default
  on payment_accounts (owner_id) where is_default;

create table songs (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references profiles(id) on delete cascade,
  title            text not null check (length(btrim(title)) > 0),
  artist_name      text not null check (length(btrim(artist_name)) > 0),
  duration_seconds int check (duration_seconds is null or duration_seconds > 0),
  tags             text[] not null default '{}',
  is_active        boolean not null default true,
  times_played     int not null default 0,
  created_at       timestamptz not null default now()
);
create unique index songs_owner_unique
  on songs (owner_id, lower(btrim(title)), lower(btrim(artist_name)));
create index songs_owner_active on songs (owner_id) where is_active;

create table shows (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references profiles(id) on delete cascade,
  payment_account_id uuid references payment_accounts(id) on delete set null,

  title         text not null check (length(btrim(title)) > 0),
  venue         text,
  city          text,
  cover_url     text,
  scheduled_for timestamptz,
  started_at    timestamptz,
  ended_at      timestamptz,
  status        show_status not null default 'draft',

  -- 6 caracteres, alfabeto Crockford sem I, L, O e U
  join_code text not null check (join_code ~ '^[0-9A-HJKMNP-TV-Z]{6}$'),

  -- votação
  vote_mode              vote_mode not null default 'paid_weighted',
  vote_min_cents         int not null default 200  check (vote_min_cents > 0),
  vote_max_cents         int not null default 20000,
  vote_suggested_cents   int[] not null default '{200,500,1000}',
  cents_per_point        int not null default 100 check (cents_per_point > 0),
  free_votes_per_session int not null default 0   check (free_votes_per_session >= 0),
  round_duration_seconds int not null default 300 check (round_duration_seconds between 30 and 3600),

  -- Janela de apuração: depois que a votação fecha, quanto tempo esperamos os Pix
  -- pendentes resolverem antes de eleger a vencedora. É o teto da tela "apurando".
  settlement_grace_seconds int not null default 90 check (settlement_grace_seconds between 15 and 600),
  -- Validade padrão do QR Pix. Na prática é encurtada para nunca ultrapassar a apuração.
  payment_ttl_seconds      int not null default 300 check (payment_ttl_seconds between 60 and 1800),

  -- pedido direto (fura-fila)
  direct_request_enabled     boolean not null default true,
  direct_request_price_cents int not null default 3000 check (direct_request_price_cents > 0),
  direct_request_auto_accept boolean not null default false,

  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shows_amount_range check (vote_max_cents >= vote_min_cents)
);

-- o código só precisa ser único entre shows que ainda podem receber gente
create unique index shows_join_code_active
  on shows (join_code) where status in ('ready', 'live', 'paused');
create index shows_owner_status on shows (owner_id, status);

create table show_songs (
  id         uuid primary key default gen_random_uuid(),
  show_id    uuid not null references shows(id) on delete cascade,
  song_id    uuid not null references songs(id) on delete restrict,
  status     show_song_status not null default 'available',
  position   int,
  played_at  timestamptz,
  created_at timestamptz not null default now(),
  unique (show_id, song_id)
);
create index show_songs_show_status on show_songs (show_id, status);

create table rounds (
  id       uuid primary key default gen_random_uuid(),
  show_id  uuid not null references shows(id) on delete cascade,
  seq      int not null,
  label    text,
  status   round_status not null default 'draft',

  opens_at   timestamptz,
  -- Fonte da verdade do cronômetro. A votação para AQUI, pontualmente.
  closes_at  timestamptz,
  -- Teto da apuração: closes_at + settlement_grace_seconds do show.
  settle_by  timestamptz,
  closed_at  timestamptz,
  settled_at timestamptz,

  winner_candidate_id uuid,
  total_weight        bigint not null default 0,
  total_amount_cents  bigint not null default 0,
  total_votes         int    not null default 0,
  created_at          timestamptz not null default now(),
  unique (show_id, seq)
);

-- invariante central: no máximo UMA rodada ativa por show
create unique index rounds_one_active_per_show
  on rounds (show_id) where status in ('open', 'closing');
create index rounds_show_status on rounds (show_id, status);
create index rounds_pending_tick on rounds (closes_at) where status in ('open', 'closing');

create table round_candidates (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  show_song_id uuid not null references show_songs(id) on delete cascade,
  -- snapshot: o histórico não muda se a música for renomeada depois
  title        text not null,
  artist_name  text not null,
  position     int not null,
  weight       bigint not null default 0,
  amount_cents bigint not null default 0,
  votes_count  int    not null default 0,
  -- desempate: vence quem recebeu o primeiro voto confirmado
  first_vote_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (round_id, show_song_id)
);
create index round_candidates_round on round_candidates (round_id);

alter table rounds
  add constraint rounds_winner_fk
  foreign key (winner_candidate_id) references round_candidates(id) on delete set null;

create table audience_sessions (
  id              uuid primary key default gen_random_uuid(),
  show_id         uuid not null references shows(id) on delete cascade,
  nickname        text check (nickname is null or length(nickname) <= 40),
  device_hash     text not null,
  ip_hash         text,
  user_agent      text,
  free_votes_used int not null default 0,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  unique (show_id, device_hash)
);

create table payments (
  id                 uuid primary key default gen_random_uuid(),
  show_id            uuid not null references shows(id) on delete cascade,
  session_id         uuid references audience_sessions(id) on delete set null,
  purpose            payment_purpose not null,
  provider           pix_provider not null,
  provider_charge_id text,
  provider_txid      text,
  end_to_end_id      text,
  amount_cents       int not null check (amount_cents > 0),
  status             payment_status not null default 'created',
  br_code            text,
  qr_png_base64      text,
  expires_at         timestamptz,
  paid_at            timestamptz,
  payer_name         text,
  raw                jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index payments_provider_charge
  on payments (provider, provider_charge_id) where provider_charge_id is not null;
create index payments_show_status on payments (show_id, status);
create index payments_pending_expiry
  on payments (expires_at) where status in ('created', 'pending');

create table votes (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references rounds(id) on delete cascade,
  candidate_id uuid not null references round_candidates(id) on delete cascade,
  session_id   uuid not null references audience_sessions(id) on delete cascade,
  payment_id   uuid references payments(id) on delete set null,
  weight       int not null check (weight > 0),
  amount_cents int not null default 0 check (amount_cents >= 0),
  status       vote_status not null default 'pending',
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);
create index votes_round_status on votes (round_id, status);
create index votes_candidate_confirmed on votes (candidate_id) where status = 'confirmed';
create index votes_session on votes (session_id);
create unique index votes_payment_unique on votes (payment_id) where payment_id is not null;
-- usado pelo tick: "ainda há voto pendente nesta rodada?"
create index votes_round_pending on votes (round_id) where status = 'pending';

create table direct_requests (
  id             uuid primary key default gen_random_uuid(),
  show_id        uuid not null references shows(id) on delete cascade,
  session_id     uuid not null references audience_sessions(id) on delete cascade,
  song_id        uuid references songs(id) on delete set null,
  title          text not null check (length(btrim(title)) > 0),
  artist_name    text not null check (length(btrim(artist_name)) > 0),
  message        text check (message is null or length(message) <= 140),
  requester_name text check (requester_name is null or length(requester_name) <= 40),
  amount_cents   int not null check (amount_cents > 0),
  payment_id     uuid references payments(id) on delete set null,
  status         request_status not null default 'pending_payment',
  queue_position int,
  decided_at     timestamptz,
  played_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index direct_requests_show_status on direct_requests (show_id, status);
create unique index direct_requests_payment_unique
  on direct_requests (payment_id) where payment_id is not null;

create table payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          pix_provider not null,
  provider_event_id text not null,
  payment_id        uuid references payments(id) on delete set null,
  event_type        text not null,
  payload           jsonb not null,
  signature_valid   boolean not null default false,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  error             text,
  -- ESTA constraint é a defesa contra webhook duplicado virar voto dobrado
  unique (provider, provider_event_id)
);

create table show_events (
  id         uuid primary key default gen_random_uuid(),
  show_id    uuid not null references shows(id) on delete cascade,
  actor      text not null,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index show_events_show on show_events (show_id, created_at desc);
