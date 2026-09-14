-- Vote Play — correções do primeiro uso real do painel.
--
-- Dois bugs que só aparecem quando um ARTISTA AUTENTICADO age, e não o postgres:
-- os testes anteriores criavam shows como superusuário e passavam por cima deles.

-- ---------------------------------------------------------------------------
-- 1. "permission denied for function generate_join_code"
--
-- O trigger que preenche o código do show chama generate_join_code(), que por
-- segurança só é executável por service_role. Funções de trigger rodam com os
-- privilégios de quem disparou — então o artista esbarrava na trava.
--
-- A correção NÃO é liberar generate_join_code para o cliente: é fazer o trigger
-- rodar como dono. Assim o gerador de códigos continua inacessível de fora, e
-- ninguém consegue sondar quais códigos estão livres.
-- ---------------------------------------------------------------------------

create or replace function shows_default_join_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.join_code is null or btrim(new.join_code) = '' then
    new.join_code := generate_join_code();
  else
    new.join_code := upper(btrim(new.join_code));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Perfil do artista não existia
--
-- `shows.owner_id` referencia `profiles`, mas quem se cadastra pelo Auth nasce
-- só em `auth.users`. O primeiro "criar show" quebraria em chave estrangeira.
-- O padrão do Supabase é criar o perfil por trigger no cadastro.
-- ---------------------------------------------------------------------------

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
      split_part(coalesce(new.email, 'artista'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Retroativo: quem já se cadastrou antes desta migration também ganha perfil.
insert into public.profiles (id, display_name)
select u.id,
       coalesce(
         nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
         split_part(coalesce(u.email, 'artista'), '@', 1)
       )
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null;
