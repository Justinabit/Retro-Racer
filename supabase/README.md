# Supabase Setup for Pixel Racer 3D Multiplayer

This directory contains all the database schema and setup required for the multiplayer functionality.

## Networking upgrade (existing installations)

Apply **`migrations/005_race_network.sql`** before deploying the updated client.
It creates the frozen race roster, shared server deadline/RPCs, private Realtime
sender authorization, and idempotent ranked finishes. The same SQL is included
at the end of `schema.sql` for new installations. No movement is persisted.

Private Broadcast/Presence requires the `realtime.messages` RLS policies in 005.
Audit existing policies: permissive “allow all authenticated” policies must not
grant access to `race:` topics, because permissive policies combine with OR.
Use distinct authenticated users when testing. A browser's normal tabs usually
share the same persisted Supabase login; use separate profiles/incognito/devices.

See [the networking audit, limits, and live acceptance checklist](../docs/MULTIPLAYER.md).
Eight-racer message fan-out needs an appropriately sized Realtime quota; do not
assume a free project's throughput is sufficient or raise the send rate to hide
throttling. Never use a service-role key in the frontend.

## Quick Start

### 1. Create Supabase Project

1. Go to https://supabase.com and create a new project
2. Wait for the project to be provisioned
3. Note your project URL and anon key

### 2. Enable Authentication

1. Go to Authentication > Providers in Supabase dashboard
2. Enable **Anonymous** provider (for username-only auth without email/password)
   - This allows players to get a unique user ID without email registration
3. Optionally enable Email provider if you want traditional auth later

### 3. Get Credentials

1. Go to Project Settings > API
2. Copy:
   - `Project URL` (e.g., `https://xyz.supabase.co`)
   - `anon public` key (publishable key)

### 4. Configure Environment Variables

1. Copy `.env.example` to `.env` in the project root:
   ```sh
   cp .env.example .env
   ```

2. Edit `.env` and add your Supabase credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

### 5. Run Database Migrations

1. Go to SQL Editor in Supabase dashboard
2. Run the migrations in order:

   **Option A: Run complete schema**
   ```sql
   -- Copy and run supabase/schema.sql
   ```

   **Option B: Run migrations individually**
   ```sql
   -- Run in order:
   -- 1. supabase/migrations/001_initial_schema.sql
   -- 2. supabase/migrations/002_functions_and_triggers.sql
   -- 3. supabase/migrations/003_rls_policies.sql
   -- 4. supabase/migrations/004_realtime.sql
   -- 5. supabase/migrations/005_race_network.sql
   ```

### 6. Enable Realtime

1. Go to Database > Publications in Supabase dashboard
2. Ensure `supabase_realtime` publication exists
3. Enable Realtime for these tables:
   - `profiles`
   - `lobbies`
   - `lobby_players`
   - `race_sessions`
   - `race_results`

   Or run the SQL in `004_realtime.sql` which attempts to add them automatically.

4. For Broadcast and Presence (used for position sync):
   - Apply 005 to authorize the private `race:<raceId>:<playerId>` topics
   - The game uses Broadcast for vehicle positions (not stored in DB)
   - Presence is used for online status

### 7. Start the Game

```sh
npm ci
npm run dev
```

Open http://localhost:5173

### 8. Test Multiplayer

1. **Username creation**: First visit shows username prompt (3-16 chars, letters/numbers/spaces)
2. **Create Lobby**: Click Multiplayer > Create Lobby - generates 6-digit code
3. **Join Lobby**: Open second browser/incognito, enter same 6-digit code
4. **Verify**: Both players see each other in lobby in real-time
5. **Ready**: Each player selects car/character and marks ready
6. **Start**: Host can start when all ready (min 2 players, max 8, NO AI)
7. **Race**: Test movement, collision, name tags, power-ups sync

## Architecture

### Tables

- **profiles**: User profiles (id = auth.users.id, username unique)
- **lobbies**: Multiplayer lobbies (6-digit code, host, mode, map, status)
- **lobby_players**: Players in lobbies (car, character, ready state)
- **race_sessions**: Race instances for a lobby
- **race_members**: Frozen authenticated grid and selections, private-channel authorization
- **race_results**: Finish positions for real players only

### Functions

- `generate_lobby_code()`: Generates unique 6-digit numeric code
- `can_start_race(lobby_id, user_id)`: Validates host can start (ready, min 2, max 8, valid selections)
- `start_race(lobby_uuid)`: Atomic host/ready validation, frozen roster, server-timed start
- `race_server_time()`: Clock-offset estimation
- `mark_race_started(rid)`: Acknowledge GO only after the server deadline
- `submit_race_finish(rid, seconds)`: Idempotent own finish and serialized ranking
- `race_topic_allowed(topic, writing)`: Topic owner/membership authorization
- `handle_host_migration()`: When host leaves, earliest joined becomes new host
- `cleanup_old_lobbies()`: Closes old waiting lobbies, deletes old closed ones

### Security

- **RLS enabled** on all tables
- Players can only update their own profile/selections
- Only host can update lobby settings/start race
- No service-role key exposed to browser - only anon key
- Lobby codes unique among active lobbies
- Server-side validation for race start

### Realtime

- **Postgres Changes**: For lobby membership, ready states, car selection, host changes, status
- **Broadcast**: For ephemeral position/rotation sync (20Hz, not stored in DB)
- **Presence**: For online status and disconnect handling

### Performance

- Position sync uses Broadcast, NOT database writes every frame
- Only persistent state (lobby, ready, selections, results) stored in DB
- Interpolation for remote players for smooth movement
- Local player movement is immediate (no server wait)

## Troubleshooting

### "Supabase not configured" in game

- Check `.env` exists and has correct URL and anon key
- Restart dev server after changing `.env`
- Check browser console for errors

### Realtime not working

- Ensure tables added to `supabase_realtime` publication
- Check Supabase dashboard > Database > Publications
- Check browser console for realtime connection errors

### Lobby code collision

- `generate_lobby_code()` handles collisions by retrying up to 100 times
- Database has unique index on code where status in ('waiting','starting','racing')
- Client also retries if creation fails due to collision

### Host migration not working

- Trigger `host_migration_on_leave` should auto-migrate host
- Check trigger exists: `select * from pg_trigger where tgname = 'host_migration_on_leave'`
- Manual fallback: earliest joined player becomes host

### RLS errors

- Ensure anonymous auth enabled if using anonymous sign-in
- Check policies: `select * from pg_policies where schemaname = 'public'`
- Test with `auth.uid()` in SQL editor

## Development

### Local Supabase (optional)

You can run Supabase locally with Docker:

```sh
npx supabase init
npx supabase start
```

Then use local URL and anon key in `.env`.

### Cleanup old lobbies

Run periodically (or via cron):

```sql
select public.cleanup_old_lobbies();
```

## Production

1. Set environment variables in your hosting platform (Vercel, Netlify, etc.)
2. Ensure RLS policies are enabled
3. Enable Realtime for required tables
4. Monitor `lobbies` and `lobby_players` tables for stuck lobbies
5. Consider adding cron for `cleanup_old_lobbies()`

## Security Checklist

- [ ] RLS enabled on all tables
- [ ] No service-role key in frontend
- [ ] Anon key only in `VITE_SUPABASE_ANON_KEY`
- [ ] Username validation (3-16 chars, safe chars)
- [ ] Lobby code 6-digit numeric, unique among active
- [ ] Host validation for start/map change
- [ ] Players can only update own selections
- [ ] Results only for real players (no AI rows)
- [ ] Broadcast for positions, not DB writes every frame
