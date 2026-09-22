-- Migration 002: Functions and Triggers

-- Function to generate unique 6-digit lobby code
create or replace function public.generate_lobby_code()
returns text
language plpgsql
as $$
declare
  new_code text;
  attempts integer := 0;
  max_attempts integer := 100;
begin
  loop
    new_code := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    
    if not exists (
      select 1 from public.lobbies 
      where code = new_code 
      and status in ('waiting', 'starting', 'racing')
    ) then
      return new_code;
    end if;
    
    attempts := attempts + 1;
    if attempts >= max_attempts then
      raise exception 'Failed to generate unique lobby code after % attempts', max_attempts;
    end if;
  end loop;
end;
$$;

-- Function to update updated_at timestamp
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Function to handle host migration when host leaves
create or replace function public.handle_host_migration()
returns trigger
language plpgsql
as $$
declare
  new_host_id uuid;
  lobby_host uuid;
begin
  if TG_OP = 'DELETE' then
    select host_id into lobby_host from public.lobbies where id = OLD.lobby_id;
    
    if lobby_host = OLD.player_id then
      select player_id into new_host_id 
      from public.lobby_players 
      where lobby_id = OLD.lobby_id 
      order by joined_at asc 
      limit 1;
      
      if new_host_id is not null then
        update public.lobbies 
        set host_id = new_host_id, updated_at = now()
        where id = OLD.lobby_id;
      else
        update public.lobbies 
        set status = 'closed', updated_at = now()
        where id = OLD.lobby_id;
      end if;
    end if;
  end if;
  
  return OLD;
end;
$$;

-- Function to validate lobby start
create or replace function public.can_start_race(lobby_uuid uuid, requester_id uuid)
returns boolean
language plpgsql
as $$
declare
  lobby_record public.lobbies%rowtype;
  player_count integer;
  ready_count integer;
  valid_cars integer;
begin
  select * into lobby_record from public.lobbies where id = lobby_uuid;
  
  if not found then
    return false;
  end if;
  
  if lobby_record.host_id != requester_id then
    return false;
  end if;
  
  if lobby_record.status != 'waiting' then
    return false;
  end if;
  
  select count(*) into player_count from public.lobby_players where lobby_id = lobby_uuid;
  
  if player_count < 2 then
    return false;
  end if;
  
  if player_count > 8 then
    return false;
  end if;
  
  select count(*) into ready_count from public.lobby_players where lobby_id = lobby_uuid and is_ready = true;
  
  if ready_count != player_count then
    return false;
  end if;
  
  select count(*) into valid_cars from public.lobby_players where lobby_id = lobby_uuid and selected_car is not null and selected_car != '';
  
  if valid_cars != player_count then
    return false;
  end if;
  
  if lobby_record.mode = 'kart' then
    select count(*) into valid_cars from public.lobby_players where lobby_id = lobby_uuid and selected_character is not null and selected_character != '';
    if valid_cars != player_count then
      return false;
    end if;
  end if;
  
  return true;
end;
$$;

-- Cleanup function for old lobbies
create or replace function public.cleanup_old_lobbies()
returns void
language plpgsql
as $$
begin
  update public.lobbies
  set status = 'closed', updated_at = now()
  where created_at < now() - interval '24 hours'
  and status in ('waiting', 'starting');
  
  delete from public.lobbies
  where created_at < now() - interval '7 days'
  and status = 'closed';
end;
$$;

-- Triggers
drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

drop trigger if exists update_lobbies_updated_at on public.lobbies;
create trigger update_lobbies_updated_at
  before update on public.lobbies
  for each row execute function public.update_updated_at();

drop trigger if exists host_migration_on_leave on public.lobby_players;
create trigger host_migration_on_leave
  after delete on public.lobby_players
  for each row execute function public.handle_host_migration();
