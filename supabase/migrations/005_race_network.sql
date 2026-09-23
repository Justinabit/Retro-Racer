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
