-- ============================================
-- AXIOM — Supabase schema
-- Run this once in your Supabase project:
-- Dashboard → SQL Editor → New query → paste all → Run
-- ============================================

-- ---- Profiles ----
-- One row per user, auto-created on signup via the trigger below.
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free','starter','pro','creator')),
  credits integer not null default 50,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

-- Existing databases: bring profiles up to date without dropping data.
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user','admin'));
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free','starter','pro','creator'));

alter table public.profiles enable row level security;

-- security definer + a fixed search_path lets this bypass RLS when called
-- from inside a policy, avoiding infinite recursion on public.profiles.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ---- Auto-create a profile row whenever someone signs up ----
-- New users start with 50 free credits (see profiles.credits default above).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---- Generations ----
-- One row per playground generation (chat/image/video/voice/code),
-- used to populate "Recent generations" on the dashboard.
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  tool text not null check (tool in ('chat','image','video','voice','code')),
  prompt text,
  thumbnail_gradient text,
  created_at timestamptz not null default now()
);

alter table public.generations enable row level security;

create policy "Users can view their own generations"
  on public.generations for select
  using (auth.uid() = user_id);

create policy "Users can insert their own generations"
  on public.generations for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own generations"
  on public.generations for delete
  using (auth.uid() = user_id);

drop policy if exists "Admins can view all generations" on public.generations;
create policy "Admins can view all generations"
  on public.generations for select
  using (public.is_admin());

create index if not exists generations_user_id_created_at_idx
  on public.generations (user_id, created_at desc);

-- ---- Usage logs ----
-- One row per AI request, written server-side by the openrouter-chat Edge
-- Function via deduct_credits(). Powers the billing usage-history table and
-- (later) the admin/user dashboards. Never written to directly by clients.
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  credits_charged integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.usage_logs enable row level security;

create policy "Users can view their own usage logs"
  on public.usage_logs for select
  using (auth.uid() = user_id);

create policy "Admins can view all usage logs"
  on public.usage_logs for select
  using (public.is_admin());

create index if not exists usage_logs_user_id_created_at_idx
  on public.usage_logs (user_id, created_at desc);

-- ---- Subscriptions ----
-- Records both one-time credit-pack purchases and recurring plan
-- subscriptions made through Razorpay. Rows are only ever written by the
-- service-role Edge Functions (create-razorpay-order,
-- create-razorpay-subscription, verify-razorpay-payment) — never directly
-- by the client, hence no insert/update policies below.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  kind text not null check (kind in ('credit_pack', 'subscription')),
  tier text check (tier in ('starter', 'pro', 'creator')),
  pack text,
  razorpay_order_id text,
  razorpay_subscription_id text,
  razorpay_payment_id text,
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'active', 'cancelled')),
  credits_purchased integer not null default 0,
  amount_paise integer not null,
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users can view their own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Admins can view all subscriptions"
  on public.subscriptions for select
  using (public.is_admin());

create index if not exists subscriptions_user_id_created_at_idx
  on public.subscriptions (user_id, created_at desc);

-- Prevents two Razorpay callbacks for the same order/subscription from ever
-- being treated as two different rows (belt-and-braces alongside the
-- conditional-update guard in verify-razorpay-payment).
create unique index if not exists subscriptions_razorpay_order_id_uidx
  on public.subscriptions (razorpay_order_id) where razorpay_order_id is not null;
create unique index if not exists subscriptions_razorpay_subscription_id_uidx
  on public.subscriptions (razorpay_subscription_id) where razorpay_subscription_id is not null;

-- ---- Credit top-up (atomic) ----
-- Mirrors deduct_credits(): called by verify-razorpay-payment after a
-- signature check passes. Adding via SQL `credits = credits + n` instead of
-- a JS read-then-write closes the lost-update race if two requests (e.g. a
-- retried webhook and the client-side confirm) land at the same time.
create or replace function public.add_credits(
  p_user_id uuid,
  p_amount integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  update public.profiles
    set credits = credits + greatest(p_amount, 0)
    where id = p_user_id
    returning credits into v_remaining;
  return v_remaining;
end;
$$;

-- ---- In-flight generation cap (race-condition guard) ----
-- openrouter-chat checks profiles.credits *before* starting a stream, but
-- credits are only deducted once the stream finishes. Without this, a user
-- could open many concurrent chats before any of them deduct, driving the
-- balance well below zero. active_generations + begin/end_generation makes
-- "claim a generation slot" atomic and caps concurrency per user.
alter table public.profiles add column if not exists active_generations integer not null default 0;

create or replace function public.begin_generation(p_user_id uuid, p_max_concurrent integer default 3)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.profiles
    set active_generations = active_generations + 1
    where id = p_user_id
      and credits > 0
      and active_generations < p_max_concurrent
    returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.end_generation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set active_generations = greatest(active_generations - 1, 0)
    where id = p_user_id;
end;
$$;

-- ---- Rate limiting (shared by any Edge Function) ----
-- Fixed-window counter per (user, action). check_rate_limit() atomically
-- increments the counter for the current window and reports whether the
-- caller is still under the limit — used by openrouter-chat and the
-- Razorpay order/subscription functions to stop burst abuse.
create table if not exists public.rate_limits (
  user_id uuid not null references auth.users on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, action, window_start)
);

create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_per_window integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (user_id, action, window_start, count)
    values (p_user_id, p_action, v_window, 1)
    on conflict (user_id, action, window_start)
    do update set count = public.rate_limits.count + 1
    returning count into v_count;

  return v_count <= p_max_per_window;
end;
$$;

-- Old windows accumulate rows; safe to prune periodically (e.g. via a daily
-- Supabase cron job / pg_cron): delete from public.rate_limits where window_start < now() - interval '1 day';

-- ---- Credit deduction ----
-- Called by the openrouter-chat Edge Function (service role) after a
-- completion finishes streaming. Computes cost from a per-model rate table
-- (credits per 1000 tokens, prompt/completion priced separately), then
-- atomically decrements the user's balance and logs the usage row so the
-- two never drift apart under concurrent requests.
create or replace function public.deduct_credits(
  p_user_id uuid,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prompt_rate numeric;   -- credits per 1000 prompt tokens
  v_completion_rate numeric; -- credits per 1000 completion tokens
  v_cost integer;
  v_remaining integer;
begin
  v_prompt_rate := case
    when p_model ilike 'openai/gpt-4o%' then 5
    when p_model ilike 'anthropic/claude-3.5%' then 5
    when p_model ilike 'anthropic/claude-3-haiku%' then 1
    when p_model ilike 'google/gemini%' then 1
    when p_model ilike 'meta-llama/%' then 1
    when p_model ilike 'mistralai/%' then 1
    else 3
  end;
  v_completion_rate := v_prompt_rate * 3;

  v_cost := greatest(
    1,
    ceil((coalesce(p_prompt_tokens, 0) / 1000.0) * v_prompt_rate
       + (coalesce(p_completion_tokens, 0) / 1000.0) * v_completion_rate)
  );

  update public.profiles
    set credits = greatest(credits - v_cost, 0)
    where id = p_user_id
    returning credits into v_remaining;

  insert into public.usage_logs (user_id, model, prompt_tokens, completion_tokens, credits_charged)
    values (p_user_id, p_model, coalesce(p_prompt_tokens, 0), coalesce(p_completion_tokens, 0), v_cost);

  return v_remaining;
end;
$$;

-- ============================================
-- AXIOM — Phase 4: AI Workspace (files, workspaces, search)
-- Adds multi-workspace file storage + metadata so uploaded documents,
-- images, audio, and video can be previewed, searched, and referenced
-- from chat. Storage bytes live in the `workspace-files` Storage bucket;
-- everything else (extracted text, transcripts, status) lives here.
-- Safe to re-run: every statement is if-not-exists / create-or-replace.
-- ============================================

-- ---- Workspaces ----
-- Each user gets a default workspace on signup (see trigger below); they
-- can create more. Every file, and eventually every chat, belongs to one.
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null default 'My Workspace',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

drop policy if exists "Users manage their own workspaces" on public.workspaces;
create policy "Users manage their own workspaces"
  on public.workspaces for all
  using (auth.uid() = owner_id or public.is_admin())
  with check (auth.uid() = owner_id);

create index if not exists workspaces_owner_idx on public.workspaces(owner_id);

-- ---- Workspace files ----
-- One row per uploaded file. `storage_path` points into the
-- `workspace-files` bucket at `{owner_id}/{workspace_id}/{id}-{filename}`.
-- `extracted_text` holds whatever text we could pull out (PDF/DOCX body,
-- OCR output, audio/video transcript) so chat and search can use it
-- without re-reading the raw bytes every time.
create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  kind text not null check (kind in ('document','image','audio','video','archive','other')),
  size_bytes bigint not null default 0,
  status text not null default 'ready' check (status in ('uploading','processing','ready','error')),
  error_message text,
  extracted_text text,           -- body text / OCR / transcript, used for search + chat context
  page_count integer,            -- PDFs / DOCX / PPTX
  duration_seconds numeric,      -- audio / video
  thumbnail_path text,           -- optional generated thumbnail in the same bucket
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_files enable row level security;

drop policy if exists "Users manage their own files" on public.workspace_files;
create policy "Users manage their own files"
  on public.workspace_files for all
  using (auth.uid() = owner_id or public.is_admin())
  with check (auth.uid() = owner_id);

create index if not exists workspace_files_owner_idx on public.workspace_files(owner_id);
create index if not exists workspace_files_workspace_idx on public.workspace_files(workspace_id);
create index if not exists workspace_files_kind_idx on public.workspace_files(kind);
-- Full-text search over filename + extracted content (Documents / PDFs /
-- transcripts). Falls back to a plain ILIKE in the client if this index
-- isn't present yet on an older database.
create index if not exists workspace_files_search_idx
  on public.workspace_files
  using gin (to_tsvector('english', coalesce(filename,'') || ' ' || coalesce(extracted_text,'')));

create or replace function public.touch_workspace_file()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workspace_files_touch on public.workspace_files;
create trigger workspace_files_touch
  before update on public.workspace_files
  for each row execute function public.touch_workspace_file();

-- ---- Give every new user a default workspace ----
create or replace function public.handle_new_user_workspace()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.workspaces (owner_id, name, is_default)
  values (new.id, 'My Workspace', true);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace
  after insert on auth.users
  for each row execute function public.handle_new_user_workspace();

-- Backfill: anyone who signed up before this migration gets a default
-- workspace too, so the app never has to handle a "zero workspaces" user.
insert into public.workspaces (owner_id, name, is_default)
select p.id, 'My Workspace', true
from public.profiles p
where not exists (select 1 from public.workspaces w where w.owner_id = p.id);

-- ---- Storage bucket ----
-- Private bucket — every object is only readable via a signed URL or by
-- the RLS policies below, never a public URL. 100MB object cap mirrors the
-- per-file limit enforced client-side in ai/workspace.js.
insert into storage.buckets (id, name, public, file_size_limit)
values ('workspace-files', 'workspace-files', false, 104857600)
on conflict (id) do update set file_size_limit = 104857600, public = false;

-- Objects are stored at `{auth.uid()}/{workspace_id}/{file_id}-{name}` so a
-- simple "first path segment == my uid" check is enough to scope access —
-- no join back to workspace_files required, and it keeps working even for
-- a file whose metadata row was already deleted (e.g. cleanup jobs).
drop policy if exists "Users read their own workspace files" on storage.objects;
create policy "Users read their own workspace files"
  on storage.objects for select
  using (bucket_id = 'workspace-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users upload their own workspace files" on storage.objects;
create policy "Users upload their own workspace files"
  on storage.objects for insert
  with check (bucket_id = 'workspace-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update their own workspace files" on storage.objects;
create policy "Users update their own workspace files"
  on storage.objects for update
  using (bucket_id = 'workspace-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own workspace files" on storage.objects;
create policy "Users delete their own workspace files"
  on storage.objects for delete
  using (bucket_id = 'workspace-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- Per-user upload rate limit ----
-- Reuses the same check_rate_limit() function as the chat endpoint so
-- there's one throttling mechanism in the whole app, not two.
-- (Called from the client before requesting a signed upload; enforced for
-- real by the analyze-file Edge Function for anything that costs credits.)

-- ============================================
-- AXIOM — Phase 6: AI Agent System
-- Custom agent definitions + per-agent favorites, recent-use, and memory.
-- Built-in agents (General, Coder, Research, ...) are shipped code
-- (ai/agents-catalog.js), never rows here — this section only stores
-- what's genuinely per-user: agents someone built themselves, which
-- built-in/custom agents they starred or used recently, and the short
-- memory notes each agent has saved about them. Nothing here touches
-- auth, billing, subscriptions, credits, or the existing Workspace
-- tables above. Safe to re-run: every statement is if-not-exists /
-- create-or-replace.
-- ============================================

-- ---- Custom agent definitions ----
-- One row per user-created agent. Built-in agents use string ids like
-- 'builtin:coder' and are never stored here; custom agents get a plain
-- uuid, which is why agent_id columns below are `text` (they hold either
-- shape) rather than a foreign key into this table.
create table if not exists public.agent_definitions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  instructions text not null default '' check (char_length(instructions) <= 200),
  system_prompt text not null check (char_length(system_prompt) <= 8000),
  icon text not null default '🤖',
  color text not null default '#6C5CE7',
  avatar_url text,
  default_model text not null default 'openai/gpt-4o-mini',
  temperature numeric not null default 0.7 check (temperature between 0 and 2),
  tools jsonb not null default '[]'::jsonb,
  quick_actions jsonb not null default '[]'::jsonb,
  memory_enabled boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_definitions enable row level security;

-- Custom agents are private to their owner — this is what the brief
-- means by "protect agent prompts / keep user-created agents private":
-- unlike workspace_files, admins do NOT get a blanket read policy here,
-- since system_prompt/instructions can contain a user's own IP or PII
-- they typed into the agent editor.
drop policy if exists "Users manage their own agents" on public.agent_definitions;
create policy "Users manage their own agents"
  on public.agent_definitions for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists agent_definitions_owner_idx on public.agent_definitions(owner_id);

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

-- ---- Favorites ----
-- Starred agents (built-in or custom) per user. agent_id is free-form
-- text on purpose (see note above) — no FK, since a favorite can point
-- at a built-in agent id that has no row in agent_definitions.
create table if not exists public.agent_favorites (
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null check (char_length(agent_id) <= 100),
  created_at timestamptz not null default now(),
  primary key (owner_id, agent_id)
);

alter table public.agent_favorites enable row level security;

drop policy if exists "Users manage their own favorites" on public.agent_favorites;
create policy "Users manage their own favorites"
  on public.agent_favorites for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---- Recent use ----
-- One row per (user, agent) tracking the last time it was made active,
-- upserted through bump_agent_recent_use() below rather than direct
-- inserts, so "Recent Agents" in the Agent Library is always correct
-- even with rapid agent-switching.
create table if not exists public.agent_recent_use (
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null check (char_length(agent_id) <= 100),
  last_used_at timestamptz not null default now(),
  primary key (owner_id, agent_id)
);

alter table public.agent_recent_use enable row level security;

drop policy if exists "Users manage their own recent agents" on public.agent_recent_use;
create policy "Users manage their own recent agents"
  on public.agent_recent_use for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists agent_recent_use_owner_idx on public.agent_recent_use(owner_id, last_used_at desc);

-- security definer only so the upsert can run as one round trip from the
-- client without a separate select-then-insert-or-update; still scoped
-- to auth.uid(), so a caller can only ever bump their own rows.
create or replace function public.bump_agent_recent_use(p_agent_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.agent_recent_use (owner_id, agent_id, last_used_at)
  values (auth.uid(), p_agent_id, now())
  on conflict (owner_id, agent_id) do update set last_used_at = excluded.last_used_at;
end;
$$;

-- ---- Memory ----
-- Short, distilled notes an agent has "remembered" about the user
-- (preferences, tone, recurring context) — never a raw chat transcript.
-- Each agent's memory is independent: a note saved under builtin:coder
-- is never folded into builtin:writer's system prompt, and vice versa.
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  agent_id text not null check (char_length(agent_id) <= 100),
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.agent_memory enable row level security;

drop policy if exists "Users manage their own agent memory" on public.agent_memory;
create policy "Users manage their own agent memory"
  on public.agent_memory for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index if not exists agent_memory_owner_agent_idx on public.agent_memory(owner_id, agent_id, created_at desc);

-- Milestone 5: lets the Memory Agent "tag memories" without a second table.
alter table public.agent_memory add column if not exists tags text[] not null default '{}';

-- Milestone 6: lets the Memory Agent support "pinned memories" and
-- "memory categories" on the SAME agent_memory table (no second store).
alter table public.agent_memory add column if not exists pinned boolean not null default false;
alter table public.agent_memory add column if not exists category text;
create index if not exists agent_memory_pinned_idx on public.agent_memory(agent_id, pinned) where pinned = true;
create index if not exists agent_memory_category_idx on public.agent_memory(agent_id, category);
