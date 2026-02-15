-- Run this in Supabase Dashboard → SQL Editor (once).
-- If you get "policy already exists", drop the policy first or skip that block.

-- Table: launch records (creator, token details, tx hash, recipients)
create table if not exists public.launches (
  id uuid primary key default gen_random_uuid(),
  creator_address text not null,
  name text not null,
  symbol text not null,
  token_uri text not null,
  tx_hash text not null,
  recipients jsonb not null default '[]',
  total_mon text not null,
  slippage_bps integer not null,
  created_at timestamptz not null default now()
);

-- Optional: allow anonymous inserts (anon key) and reads for your app
alter table public.launches enable row level security;

create policy "Allow anonymous insert"
  on public.launches for insert
  to anon
  with check (true);

create policy "Allow anonymous select"
  on public.launches for select
  to anon
  using (true);

-- Storage: public bucket for token logos (run after table above)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'logos',
  'logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

-- Allow anyone (anon) to upload to logos bucket
create policy "Allow anon upload logos"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'logos');

-- Allow anyone to read from logos bucket
create policy "Allow public read logos"
  on storage.objects for select
  to anon
  using (bucket_id = 'logos');
