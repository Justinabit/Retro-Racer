-- Pixel Racer 3D - Complete Supabase Schema
-- This file contains the full database schema for multiplayer functionality
-- Run this in your Supabase SQL editor or via migrations

-- Enable necessary extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ============================================
-- PROFILES TABLE
-- ============================================
-- Stores user profiles with unique usernames
-- ID corresponds to Supabase auth.users.id

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint username_length check (char_length(username) >= 3 and char_length(username) <= 16),
  constraint username_format check (username ~ '^[a-zA-Z0-9 ]+$')
);

-- Unique username index (case-insensitive)
create unique index if not exists profiles_username_unique on public.profiles (lower(username));

-- ============================================
-- LOBBIES TABLE
-- ============================================
-- Stores multiplayer lobbies with 6-digit codes

create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  host_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null default 'classic' check (mode in ('classic', 'kart')),
  map_id text not null default 'coast',
  status text not null default 'waiting' check (status in ('waiting', 'starting', 'racing', 'finished', 'closed')),
  max_players integer not null default 8 check (max_players >= 2 and max_players <= 8),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint code_format check (code ~ '^[0-9]{6}$')
);

-- Unique code among active lobbies (waiting, starting, racing)
create unique index if not exists lobbies_code_unique_active on public.lobbies (code) where status in ('waiting', 'starting', 'racing');

-- Index for code lookups
create index if not exists lobbies_code_idx on public.lobbies (code);
create index if not exists lobbies_host_idx on public.lobbies (host_id);
create index if not exists lobbies_status_idx on public.lobbies (status);

-- ============================================
-- LOBBY_PLAYERS TABLE
-- ============================================
-- Stores players in lobbies with their selections

create table if not exists public.lobby_players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  selected_car text not null default 'gt',
  selected_character text,
  is_ready boolean not null default false,
  joined_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  unique(lobby_id, player_id)
);

create index if not exists lobby_players_lobby_idx on public.lobby_players (lobby_id);
create index if not exists lobby_players_player_idx on public.lobby_players (player_id);

-- ============================================
-- RACE_SESSIONS TABLE
-- ============================================
-- Stores race sessions for a lobby

create table if not exists public.race_sessions (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  mode text not null check (mode in ('classic', 'kart')),
  map_id text not null,
  status text not null default 'starting' check (status in ('starting', 'racing', 'finished', 'cancelled'))
);

create index if not exists race_sessions_lobby_idx on public.race_sessions (lobby_id);

-- ============================================
-- RACE_RESULTS TABLE
-- ============================================
-- Stores race results for real players only (NO AI)

create table if not exists public.race_results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.race_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  finishing_position integer not null check (finishing_position >= 1 and finishing_position <= 8),
  finish_time double precision,
  created_at timestamp with time zone default now() not null,
  unique(race_id, player_id),
  unique(race_id, finishing_position)
);

create index if not exists race_results_race_idx on public.race_results (race_id);
create index if not exists race_results_player_idx on public.race_results (player_id);

-- ============================================
-- FUNCTIONS
-- ============================================

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
    -- Generate random 6-digit code
    new_code := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
    
    -- Check if it exists in active lobbies
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
  -- Only handle when a player leaves (DELETE)
  if TG_OP = 'DELETE' then
    -- Get lobby host
    select host_id into lobby_host from public.lobbies where id = OLD.lobby_id;
    
    -- If deleted player was host
    if lobby_host = OLD.player_id then
      -- Find earliest joined player remaining
      select player_id into new_host_id 
      from public.lobby_players 
      where lobby_id = OLD.lobby_id 
      order by joined_at asc 
      limit 1;
      
      -- If there's a new host candidate
      if new_host_id is not null then
        update public.lobbies 
        set host_id = new_host_id, updated_at = now()
        where id = OLD.lobby_id;
      else
        -- No players left, close lobby
        update public.lobbies 
        set status = 'closed', updated_at = now()
        where id = OLD.lobby_id;
      end if;
    end if;
  end if;
  
  return OLD;
end;
$$;

-- Function to validate lobby start (host, ready, min players, etc)
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
  -- Get lobby
  select * into lobby_record from public.lobbies where id = lobby_uuid;
  
  if not found then
    return false;
  end if;
  
  -- Check if requester is host
  if lobby_record.host_id != requester_id then
    return false;
  end if;
  
  -- Check lobby status
  if lobby_record.status != 'waiting' then
    return false;
  end if;
  
  -- Count players
  select count(*) into player_count from public.lobby_players where lobby_id = lobby_uuid;
  
  -- At least 2 players
  if player_count < 2 then
    return false;
  end if;
  
  -- Max 8 players (enforced by constraint but double-check)
  if player_count > 8 then
    return false;
  end if;
  
  -- Count ready players
  select count(*) into ready_count from public.lobby_players where lobby_id = lobby_uuid and is_ready = true;
  
  -- All players must be ready
  if ready_count != player_count then
    return false;
  end if;
  
  -- Check all players have valid cars
  select count(*) into valid_cars from public.lobby_players where lobby_id = lobby_uuid and selected_car is not null and selected_car != '';
  
  if valid_cars != player_count then
    return false;
  end if;
  
  -- For kart mode, check characters
  if lobby_record.mode = 'kart' then
    select count(*) into valid_cars from public.lobby_players where lobby_id = lobby_uuid and selected_character is not null and selected_character != '';
    if valid_cars != player_count then
      return false;
    end if;
  end if;
  
  return true;
end;
$$;

-- ============================================
-- TRIGGERS
-- ============================================

-- Updated_at triggers
drop trigger if exists update_profiles_updated_at on public.profiles;
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

drop trigger if exists update_lobbies_updated_at on public.lobbies;
create trigger update_lobbies_updated_at
  before update on public.lobbies
  for each row execute function public.update_updated_at();

-- Host migration trigger
drop trigger if exists host_migration_on_leave on public.lobby_players;
create trigger host_migration_on_leave
  after delete on public.lobby_players
  for each row execute function public.handle_host_migration();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_players enable row level security;
alter table public.race_sessions enable row level security;
alter table public.race_results enable row level security;

-- Profiles policies
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Lobbies policies
drop policy if exists "Lobbies are viewable by everyone" on public.lobbies;
create policy "Lobbies are viewable by everyone"
  on public.lobbies for select
  using (true);

drop policy if exists "Authenticated users can create lobbies" on public.lobbies;
create policy "Authenticated users can create lobbies"
  on public.lobbies for insert
  with check (auth.uid() = host_id and auth.role() = 'authenticated');

drop policy if exists "Hosts can update own lobbies" on public.lobbies;
create policy "Hosts can update own lobbies"
  on public.lobbies for update
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

drop policy if exists "Hosts can delete own lobbies" on public.lobbies;
create policy "Hosts can delete own lobbies"
  on public.lobbies for delete
  using (auth.uid() = host_id);

-- Lobby players policies
drop policy if exists "Lobby players are viewable by everyone" on public.lobby_players;
create policy "Lobby players are viewable by everyone"
  on public.lobby_players for select
  using (true);

drop policy if exists "Authenticated users can join lobbies" on public.lobby_players;
create policy "Authenticated users can join lobbies"
  on public.lobby_players for insert
  with check (
    auth.uid() = player_id 
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.lobbies 
      where id = lobby_id 
      and status = 'waiting'
      and (select count(*) from public.lobby_players where lobby_id = lobby_players.lobby_id) < 8
    )
  );

drop policy if exists "Users can update own lobby player" on public.lobby_players;
create policy "Users can update own lobby player"
  on public.lobby_players for update
  using (auth.uid() = player_id)
  with check (auth.uid() = player_id);

drop policy if exists "Users can delete own lobby membership" on public.lobby_players;
create policy "Users can delete own lobby membership"
  on public.lobby_players for delete
  using (auth.uid() = player_id);

drop policy if exists "Hosts can delete any lobby membership" on public.lobby_players;
create policy "Hosts can delete any lobby membership"
  on public.lobby_players for delete
  using (
    exists (
      select 1 from public.lobbies 
      where id = lobby_id 
      and host_id = auth.uid()
    )
  );

-- Race sessions policies
drop policy if exists "Race sessions are viewable by lobby members" on public.race_sessions;
create policy "Race sessions are viewable by lobby members"
  on public.race_sessions for select
  using (
    exists (
      select 1 from public.lobby_players 
      where lobby_id = race_sessions.lobby_id 
      and player_id = auth.uid()
    )
    or exists (
      select 1 from public.lobbies 
      where id = race_sessions.lobby_id 
      and host_id = auth.uid()
    )
  );

drop policy if exists "Hosts can create race sessions" on public.race_sessions;
create policy "Hosts can create race sessions"
  on public.race_sessions for insert
  with check (
    exists (
      select 1 from public.lobbies 
      where id = lobby_id 
      and host_id = auth.uid()
    )
  );

drop policy if exists "Hosts can update race sessions" on public.race_sessions;
create policy "Hosts can update race sessions"
  on public.race_sessions for update
  using (
    exists (
      select 1 from public.lobbies 
      where id = lobby_id 
      and host_id = auth.uid()
    )
  );

-- Race results policies
drop policy if exists "Race results are viewable by everyone" on public.race_results;
create policy "Race results are viewable by everyone"
  on public.race_results for select
  using (true);

drop policy if exists "Players can insert own results" on public.race_results;
create policy "Players can insert own results"
  on public.race_results for insert
  with check (auth.uid() = player_id);

drop policy if exists "Hosts can insert results for lobby" on public.race_results;
create policy "Hosts can insert results for lobby"
  on public.race_results for insert
  with check (
    exists (
      select 1 from public.race_sessions rs
      join public.lobbies l on l.id = rs.lobby_id
      where rs.id = race_id
      and l.host_id = auth.uid()
    )
  );

-- ============================================
-- REALTIME
-- ============================================
-- Enable realtime for required tables
-- Note: This needs to be run in Supabase dashboard or via API
-- The following is for documentation; actual enabling is done via dashboard

-- For Supabase Realtime, ensure these tables are in the realtime publication:
-- alter publication supabase_realtime add table public.lobbies;
-- alter publication supabase_realtime add table public.lobby_players;
-- alter publication supabase_realtime add table public.race_sessions;
-- alter publication supabase_realtime add table public.race_results;
-- alter publication supabase_realtime add table public.profiles;

-- ============================================
-- CLEANUP FUNCTION (for old lobbies)
-- ============================================
create or replace function public.cleanup_old_lobbies()
returns void
language plpgsql
as $$
begin
  -- Close lobbies older than 24 hours that are still waiting/starting
  update public.lobbies
  set status = 'closed', updated_at = now()
  where created_at < now() - interval '24 hours'
  and status in ('waiting', 'starting');
  
  -- Delete closed lobbies older than 7 days
  delete from public.lobbies
  where created_at < now() - interval '7 days'
  and status = 'closed';
end;
$$;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
create index if not exists idx_profiles_username_lower on public.profiles (lower(username));
create index if not exists idx_lobbies_code_status on public.lobbies (code, status);
create index if not exists idx_lobby_players_lobby_player on public.lobby_players (lobby_id, player_id);
create index if not exists idx_race_sessions_lobby_status on public.race_sessions (lobby_id, status);

-- Migration 005: race synchronization
-- Ephemeral movement stays in Realtime, never in these tables.
alter table public.lobbies add column if not exists race_id uuid references public.race_sessions(id);
alter table public.lobbies add column if not exists race_start_at timestamptz;
create table if not exists public.race_members (
  race_id uuid not null references public.race_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  selected_car text not null,
  selected_character text,
  grid_index integer not null check (grid_index between 0 and 7),
  primary key (race_id, player_id)
);
alter table public.race_members enable row level security;
create or replace function public.is_race_member(rid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.race_members where race_id = rid and player_id = pid); $$;
revoke all on function public.is_race_member(uuid, uuid) from public;
grant execute on function public.is_race_member(uuid, uuid) to authenticated;
drop policy if exists "Read own race roster" on public.race_members;
create policy "Read own race roster" on public.race_members for select to authenticated
using (public.is_race_member(race_id, auth.uid()));
grant select on public.race_members to authenticated;

create or replace function public.race_server_time() returns timestamptz
language sql volatile as $$ select clock_timestamp(); $$;
grant execute on function public.race_server_time() to authenticated;

-- One transaction creates a frozen grid and shared start deadline, not a host
-- setTimeout. The row lock serializes concurrent start requests.
create or replace function public.start_race(lobby_uuid uuid) returns public.lobbies
language plpgsql security definer set search_path = public as $$
declare l public.lobbies; rid uuid; deadline timestamptz;
begin
  select * into l from public.lobbies where id = lobby_uuid for update;
  if auth.uid() is null or l.host_id is distinct from auth.uid() or not public.can_start_race(lobby_uuid, auth.uid()) then
    raise exception 'Host only; need 2-8 ready players with valid selections';
  end if;
  if exists(select 1 from public.lobby_players where lobby_id = lobby_uuid and
    (selected_car not in ('gt','demon','drift','rally','muscle','hyper') or
    (l.mode = 'kart' and selected_character not in ('vex','bolt','rush','slide','grip','titan','zip','nova')))) then
    raise exception 'Invalid selection';
  end if;
  deadline := clock_timestamp() + interval '10 seconds';
  insert into public.race_sessions(lobby_id, mode, map_id, status, started_at)
    values(l.id, l.mode, l.map_id, 'racing', deadline) returning id into rid;
  insert into public.race_members(race_id, player_id, selected_car, selected_character, grid_index)
    select rid, player_id, selected_car, selected_character, row_number() over(order by joined_at, player_id) - 1
    from public.lobby_players where lobby_id = l.id;
  update public.lobbies set status = 'starting', race_id = rid, race_start_at = deadline where id = l.id returning * into l;
  return l;
end; $$;
revoke all on function public.start_race(uuid) from public;
grant execute on function public.start_race(uuid) to authenticated;

-- Realtime authorization is evaluated for topics, NOT each payload. Bind
-- write permission to a sender-specific topic so spoofed playerId is rejected.
create or replace function public.race_topic_allowed(topic text, writing boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; rid uuid; sender uuid;
begin
  parts := string_to_array(topic, ':');
  if array_length(parts, 1) <> 3 or parts[1] <> 'race' then return false; end if;
  rid := parts[2]::uuid; sender := parts[3]::uuid;
  return public.is_race_member(rid, auth.uid()) and public.is_race_member(rid, sender)
    and (not writing or sender = auth.uid());
exception when invalid_text_representation then return false;
end; $$;
revoke all on function public.race_topic_allowed(text, boolean) from public;
grant execute on function public.race_topic_allowed(text, boolean) to authenticated;
drop policy if exists "Race members receive" on realtime.messages;
create policy "Race members receive" on realtime.messages for select to authenticated
using (public.race_topic_allowed(realtime.topic(), false));
drop policy if exists "Race owner sends" on realtime.messages;
create policy "Race owner sends" on realtime.messages for insert to authenticated
with check (public.race_topic_allowed(realtime.topic(), true));

-- Results are persisted once per authenticated finisher. Derive place on read
-- from finish_time rather than allowing competing clients to claim one slot.
alter table public.race_results drop constraint if exists race_results_race_id_finishing_position_key;
drop policy if exists "Players can insert own results" on public.race_results;
drop policy if exists "Hosts can insert results for lobby" on public.race_results;
create policy "Players can insert own results" on public.race_results for insert to authenticated
with check (player_id = auth.uid() and public.is_race_member(race_id, auth.uid()) and finish_time >= 0 and finish_time < 86400);
create or replace function public.submit_race_finish(rid uuid, seconds double precision)
returns void language plpgsql security definer set search_path = public as $$
declare started timestamptz;
begin
  select started_at into started from public.race_sessions where id = rid for update;
  if not public.is_race_member(rid, auth.uid()) or seconds is null or not (seconds >= 0 and seconds < 86400) then
    raise exception 'Invalid race finish';
  end if;
  if clock_timestamp() < started or seconds > extract(epoch from clock_timestamp() - started) + 2 then
    raise exception 'Finish precedes the shared race clock';
  end if;
  insert into public.race_results(race_id, player_id, finishing_position, finish_time)
    values(rid, auth.uid(), 1, seconds) on conflict(race_id, player_id) do nothing;
  update public.race_results result set finishing_position = ranked.place
  from (select player_id, row_number() over(order by finish_time, player_id)::integer as place
    from public.race_results where race_id = rid) ranked
  where result.race_id = rid and result.player_id = ranked.player_id;
  if (select count(*) from public.race_results where race_id = rid) =
     (select count(*) from public.race_members where race_id = rid) then
    update public.race_sessions set status = 'finished', finished_at = clock_timestamp() where id = rid;
    update public.lobbies set status = 'finished' where race_id = rid;
  end if;
end; $$;
revoke all on function public.submit_race_finish(uuid, double precision) from public;
grant execute on function public.submit_race_finish(uuid, double precision) to authenticated;

-- Only the idempotent finish RPC writes results; it enforces clock bounds and
-- derives standings under a race-row lock, including simultaneous finishes.
revoke insert, update, delete on public.race_results from authenticated, anon;

-- Serialize membership/selection mutations against start_race's lobby lock.
-- This also fixes concurrent "eighth seat" joins and movement of membership
-- records to another lobby via the old broad UPDATE policy.
create or replace function public.guard_race_roster()
returns trigger language plpgsql security definer set search_path = public as $$
declare l public.lobbies;
begin
  select * into l from public.lobbies where id = new.lobby_id for update;
  if tg_op = 'INSERT' then
    if l.status <> 'waiting' or (select count(*) from public.lobby_players where lobby_id = new.lobby_id) >= l.max_players then
      raise exception 'Lobby is full or race has started';
    end if;
  else
    if new.lobby_id <> old.lobby_id or new.player_id <> old.player_id then
      raise exception 'Membership identity is immutable';
    end if;
    if l.status <> 'waiting' and (new.selected_car is distinct from old.selected_car or
      new.selected_character is distinct from old.selected_character or new.is_ready is distinct from old.is_ready) then
      raise exception 'Race selections are locked';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists guard_race_roster on public.lobby_players;
create trigger guard_race_roster before insert or update on public.lobby_players
for each row execute function public.guard_race_roster();

-- Any roster member can acknowledge GO, but only once the server deadline has
-- elapsed. A slow/disconnected host cannot prevent the persistent transition.
create or replace function public.mark_race_started(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_race_member(rid, auth.uid()) then raise exception 'Not a race member'; end if;
  update public.lobbies set status = 'racing'
    where race_id = rid and status = 'starting' and race_start_at <= clock_timestamp();
end; $$;
revoke all on function public.mark_race_started(uuid) from public;
grant execute on function public.mark_race_started(uuid) to authenticated;

-- The old invoker trigger attempted to set host_id to a different user under
-- the departing host's UPDATE WITH CHECK policy, which rejects that update.
-- The trigger has fixed scope (the deleted membership's lobby) and no arguments.
create or replace function public.handle_host_migration()
returns trigger language plpgsql security definer set search_path = public as $$
declare next_host uuid; previous_host uuid;
begin
  select host_id into previous_host from public.lobbies where id = old.lobby_id for update;
  if previous_host = old.player_id then
    select player_id into next_host from public.lobby_players
      where lobby_id = old.lobby_id order by joined_at, player_id limit 1;
    if next_host is null then
      update public.lobbies set status = 'closed' where id = old.lobby_id;
    else
      update public.lobbies set host_id = next_host where id = old.lobby_id;
    end if;
  end if;
  return old;
end; $$;
