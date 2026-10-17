-- UU Bus ERP — Supabase schema. Run once: Supabase dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.uubus_records (
  collection text        not null,          -- students, staff, sessions, attendance, chats, notices, events, audit, buses, _kv, _lease
  id         text        not null,          -- enrollment no., login ID, record ID, or setting name
  data       jsonb       not null,
  pos        integer,                       -- list order (students, staff, buses, notices)
  bus        text,
  day        date,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists uubus_records_bus_day on public.uubus_records (collection, bus, day);

-- Lock the table: only the server (using the SECRET key, which bypasses RLS) can read or write.
-- The publishable/anon key gets no access at all.
alter table public.uubus_records enable row level security;
revoke all on public.uubus_records from anon, authenticated;

-- Readable views for browsing in the Table Editor / SQL Editor (also server-only).
create or replace view public.uubus_students with (security_invoker = true) as
  select id as enrollment, data->>'name' as name, data->>'bus' as bus, data->>'stop' as stop,
         data->>'programme' as programme, coalesce((data->>'active')::boolean, true) as active,
         (data ? 'deviceId') as phone_linked, pos
  from public.uubus_records where collection = 'students';

create or replace view public.uubus_attendance with (security_invoker = true) as
  select a.id, a.data->>'date' as date, a.data->>'time' as time, a.data->>'trip' as trip, a.bus,
         a.data->>'enroll' as enrollment, s.data->>'name' as student,
         case when a.data->>'method' = 'SELF' then 'Student (self)' else 'Admin: ' || (a.data->>'markedBy') end as marked_by,
         (a.data->>'dist')::int as distance_m
  from public.uubus_records a
  left join public.uubus_records s on s.collection = 'students' and s.id = a.data->>'enroll'
  where a.collection = 'attendance';

create or replace view public.uubus_security_events with (security_invoker = true) as
  select id, data->>'at' as at, bus, data->>'enroll' as enrollment, data->>'name' as student,
         data->>'type' as type, data->>'detail' as detail
  from public.uubus_records where collection = 'events';

revoke all on public.uubus_students, public.uubus_attendance, public.uubus_security_events from anon, authenticated;
