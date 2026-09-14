-- Vote Play — tipos do domínio
-- Ver plan.md, seção 5.2.

create extension if not exists pgcrypto;

create type show_status      as enum ('draft', 'ready', 'live', 'paused', 'ended', 'cancelled');
create type vote_mode        as enum ('paid_weighted', 'free_plus_boost', 'free_with_tip');

-- draft -> open -> closing -> settled
--   open    : aceita votos, cronômetro correndo
--   closing : votação encerrada no horário; aguardando os Pix pendentes resolverem
--   settled : vencedora eleita, nenhum voto pode mais entrar
create type round_status     as enum ('draft', 'open', 'closing', 'settled', 'cancelled');

create type show_song_status as enum ('available', 'candidate', 'queued', 'playing', 'played', 'skipped');
create type vote_status      as enum ('pending', 'confirmed', 'expired', 'refunded', 'voided');
create type request_status   as enum ('pending_payment', 'paid', 'accepted', 'declined', 'played', 'refunded');
create type payment_status   as enum ('created', 'pending', 'paid', 'expired', 'cancelled', 'refunded');
create type payment_purpose  as enum ('vote', 'direct_request', 'tip');
create type pix_provider     as enum ('mercadopago', 'openpix', 'asaas', 'fake');
