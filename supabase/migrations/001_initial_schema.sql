-- Migration 001: Initial Schema
-- Creates core tables for Pixel Racer 3D multiplayer

-- Enable extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint username_length check (char_length(username) >= 3 and char_length(username) <= 16),
  constraint username_format check (username ~ '^[a-zA-Z0-9 ]+$')
);

create unique index if not exists profiles_username_unique on public.profiles (lower(username));
create index if not exists idx_profiles_username_lower on public.profiles (lower(username));

-- Lobbies table
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

create unique index if not exists lobbies_code_unique_active on public.lobbies (code) where status in ('waiting', 'starting', 'racing');
create index if not exists lobbies_code_idx on public.lobbies (code);
create index if not exists lobbies_host_idx on public.lobbies (host_id);
create index if not exists lobbies_status_idx on public.lobbies (status);
create index if not exists idx_lobbies_code_status on public.lobbies (code, status);

-- Lobby players table
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
create index if not exists idx_lobby_players_lobby_player on public.lobby_players (lobby_id, player_id);

-- Race sessions table
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
create index if not exists idx_race_sessions_lobby_status on public.race_sessions (lobby_id, status);

-- Race results table
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
