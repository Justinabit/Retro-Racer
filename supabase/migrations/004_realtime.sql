-- Migration 004: Realtime Configuration
-- Enable realtime for required tables
-- Note: In Supabase dashboard, you also need to enable Realtime in Database > Publications

-- Add tables to supabase_realtime publication
-- This allows realtime subscriptions to these tables

do $$
begin
  -- Check if publication exists and add tables
  -- Profiles
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then
    -- Table already in publication, ignore
    null;
  end;
  
  -- Lobbies
  begin
    alter publication supabase_realtime add table public.lobbies;
  exception when duplicate_object then
    null;
  end;
  
  -- Lobby players
  begin
    alter publication supabase_realtime add table public.lobby_players;
  exception when duplicate_object then
    null;
  end;
  
  -- Race sessions
  begin
    alter publication supabase_realtime add table public.race_sessions;
  exception when duplicate_object then
    null;
  end;
  
  -- Race results
  begin
    alter publication supabase_realtime add table public.race_results;
  exception when duplicate_object then
    null;
  end;
end $$;

-- Note for manual setup:
-- 1. Go to Supabase Dashboard > Database > Publications
-- 2. Ensure supabase_realtime publication includes:
--    - profiles
--    - lobbies
--    - lobby_players
--    - race_sessions
--    - race_results
-- 3. Enable Realtime for these tables if not already enabled
-- 4. For Broadcast and Presence (used for position sync), no additional setup needed
--    - Broadcast channels are ephemeral and don't require table configuration
--    - Presence is also ephemeral

-- Optional: Create a function to check realtime status
create or replace function public.check_realtime_tables()
returns table(table_name text, is_in_publication boolean)
language plpgsql
as $$
begin
  return query
  select 
    t.tablename::text,
    exists(
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = t.tablename
    ) as is_in_publication
  from pg_tables t
  where t.schemaname = 'public'
  and t.tablename in ('profiles', 'lobbies', 'lobby_players', 'race_sessions', 'race_results');
end;
$$;
