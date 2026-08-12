-- ============================================
-- AXIOM — AI Agent System schema (Phase 6)
-- Run once in Supabase SQL Editor, AFTER Schema.SQL.
-- Additive only — does not alter any Phase 1-5 table. Idempotent
-- (if not exists / drop-if-exists throughout), safe to re-run.
--
-- Built-in agents (General, Coder, Research, ...) are NOT stored here —
-- they live in ai/agents-catalog.js as a static, versioned catalog so
-- they load instantly with zero round trips and can't be tampered with.
-- This file only stores what's genuinely per-user: custom agents,
-- per-agent memory, favorites, and recent-use tracking.
-- ============================================

-- ---- Agent definitions (custom agents only) ----
-- One row per user-created agent. Built-in agents use ids like
-- 'builtin:coder' and never appear in this table.
create table if not exists public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  instructions text not null default '' check (char_length(instructions) <= 200),
  system_prompt text not null check (char_length(system_prompt) between 1 and 8000),
  icon text not null default '🤖' check (char_length(icon) <= 8),
  color text not null default '#6C5CE7' check (color ~* '^#[0-9a-f]{6}$'),
  avatar_url text,
  default_model text not null default 'openai/gpt-4o-mini',
  temperature numeric not null default 0.7 check (temperature >= 0 and temperature <= 2),
  tools jsonb not null default '[]'::jsonb,        -- e.g. ["document_search","calculator"]
  quick_actions jsonb not null default '[]'::jsonb, -- [{ "label": "...", "prompt": "..." }]
  memory_enabled boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_definitions enable row level security;

-- Custom agents are strictly private to their creator (spec: "Keep
-- user-created agents private") — no admin-read carve-out, unlike most
-- other tables in this app, since a system prompt can contain anything
-- the user typed, including things they don't want visible to staff.
drop policy if exists "Users manage their own custom agents" on public.agent_definitions;
create policy "Users manage their own custom agents"
  on public.agent_definitions for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists agent_definitions_owner_idx on public.agent_definitions(owner_id);
create index if not exists agent_definitions_owner_active_idx
  on public.agent_definitions(owner_id) where is_archived = false;

create or replace function public.touch_agent_definition()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_definitions_touch on public.agent_definitions;
create trigger agent_definitions_touch
  before update on public.agent_definitions
  for each row execute function public.touch_agent_definition();

-- Per-user cap so one account can't spam thousands of agent rows.
create or replace function public.enforce_agent_definitions_cap()
returns trigger
language plpgsql
as $$
declare
  agent_count integer;
begin
  select count(*) into agent_count from public.agent_definitions where owner_id = new.owner_id;
  if agent_count >= 100 then
    raise exception 'Custom agent limit reached (100). Archive or delete an agent first.';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_definitions_cap on public.agent_definitions;
create trigger agent_definitions_cap
  before insert on public.agent_definitions
  for each row execute function public.enforce_agent_definitions_cap();

-- ---- Agent memory ----
-- Long-term, per-user, per-agent recall — independent per agent, per
-- spec ("Coder remembers coding style", "Writer remembers tone", ...).
-- Small discrete notes rather than raw transcripts: the client
-- summarizes what's worth keeping (see ai/agents.js `remember()`) and
-- writes short entries here instead of dumping whole conversations,
-- which keeps prompt-injection cost bounded and avoids silently
-- retaining sensitive chat content forever.
-- agent_id is a free-form text key: either 'builtin:<slug>' or the uuid
-- of a row in agent_definitions — kept as text (not a FK) specifically
-- so built-in agents, which have no table row, can still have memory.
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null check (char_length(agent_id) <= 80),
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.agent_memory enable row level security;

drop policy if exists "Users manage their own agent memory" on public.agent_memory;
create policy "Users manage their own agent memory"
  on public.agent_memory for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists agent_memory_owner_agent_idx
  on public.agent_memory(owner_id, agent_id, created_at desc);

-- Milestone 5: lets the Memory Agent "tag memories" without a second table.
alter table public.agent_memory add column if not exists tags text[] not null default '{}';

-- Milestone 6: lets the Memory Agent support "pinned memories" and
-- "memory categories" on the SAME agent_memory table (no second store).
alter table public.agent_memory add column if not exists pinned boolean not null default false;
alter table public.agent_memory add column if not exists category text;
create index if not exists agent_memory_pinned_idx on public.agent_memory(agent_id, pinned) where pinned = true;
create index if not exists agent_memory_category_idx on public.agent_memory(agent_id, category);

-- Cap memory notes per (user, agent) at 200 — oldest gets pruned on
-- insert past the cap, so memory can't grow unbounded per agent.
create or replace function public.prune_agent_memory()
returns trigger
language plpgsql
as $$
begin
  delete from public.agent_memory
  where id in (
    select id from public.agent_memory
    where owner_id = new.owner_id and agent_id = new.agent_id
    order by created_at desc
    offset 200
  );
  return new;
end;
$$;

drop trigger if exists agent_memory_prune on public.agent_memory;
create trigger agent_memory_prune
  after insert on public.agent_memory
  for each row execute function public.prune_agent_memory();

-- ---- Favorites ----
create table if not exists public.agent_favorites (
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null check (char_length(agent_id) <= 80),
  created_at timestamptz not null default now(),
  primary key (owner_id, agent_id)
);

alter table public.agent_favorites enable row level security;

drop policy if exists "Users manage their own agent favorites" on public.agent_favorites;
create policy "Users manage their own agent favorites"
  on public.agent_favorites for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---- Recent agents ----
-- One row per (user, agent); `last_used_at` is bumped via upsert every
-- time the agent is opened in chat, powering the "Recent Agents" shelf
-- in the Agent Library without scanning generations/usage_logs.
create table if not exists public.agent_recent_use (
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null check (char_length(agent_id) <= 80),
  last_used_at timestamptz not null default now(),
  use_count integer not null default 1,
  primary key (owner_id, agent_id)
);

alter table public.agent_recent_use enable row level security;

drop policy if exists "Users manage their own agent recent-use" on public.agent_recent_use;
create policy "Users manage their own agent recent-use"
  on public.agent_recent_use for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists agent_recent_use_owner_idx
  on public.agent_recent_use(owner_id, last_used_at desc);

-- Convenience upsert used by ai/agents.js instead of a hand-rolled
-- select-then-insert-or-update round trip from the client.
create or replace function public.bump_agent_recent_use(p_agent_id text)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.agent_recent_use (owner_id, agent_id, last_used_at, use_count)
  values (auth.uid(), p_agent_id, now(), 1)
  on conflict (owner_id, agent_id)
  do update set last_used_at = now(), use_count = public.agent_recent_use.use_count + 1;
end;
$$;
