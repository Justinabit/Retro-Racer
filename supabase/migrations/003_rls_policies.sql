-- Migration 003: Row Level Security Policies

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
