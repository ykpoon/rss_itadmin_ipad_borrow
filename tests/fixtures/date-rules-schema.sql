-- ONLY FOR THE ISOLATED LOCAL TEST DATABASE. Never run on an existing project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated;

create table public.teachers (
 id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
 name text not null unique, missed_count integer not null default 0,
 is_suspended boolean not null default false, suspended_until date, email text
);
create table public.admins(id serial primary key, email text not null unique);
create table public.resources(id serial primary key, name text not null unique, total_qty integer not null);
create table public.daily_adjustments (
 id uuid primary key default gen_random_uuid(), date date not null, device_type text not null,
 available_qty integer not null, reason text, created_at timestamptz default now(), unique(date,device_type)
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
 date date not null, lesson integer not null, slot integer, teacher_name text not null,
 device_type text not null, quantity integer not null check(quantity>0),
 room text not null, subject text not null, class text not null,
 status text not null default 'pending' check(status in ('pending','borrowed','returned','missed','waiting')),
 remarks text, user_email text, usage_type text not null default 'interactive'
);
-- Recreate broad legacy policies to verify the new trigger works without replacing them.
alter table public.bookings enable row level security;
alter table public.teachers enable row level security;
create policy legacy_open_bookings on public.bookings for all to public using(true) with check(true);
create policy legacy_open_teachers on public.teachers for all to public using(true) with check(true);
grant all on public.bookings,public.teachers to anon,authenticated;
