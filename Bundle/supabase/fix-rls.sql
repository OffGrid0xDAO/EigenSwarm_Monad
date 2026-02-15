-- Run in Supabase Dashboard → SQL Editor. Fixes "new row violates row-level security policy".
-- The error can come from: (1) image upload = storage.objects, (2) saving launch = public.launches.
-- This script fixes both.

-- ========== 1. LAUNCHES TABLE ==========
alter table public.launches disable row level security;
grant usage on schema public to anon, authenticated;
grant insert, select on public.launches to anon, authenticated;

-- ========== 2. STORAGE (image upload) ==========
-- If your bucket name is NOT 'logos', change both 'logos' below to your bucket id (same as in .env VITE_SUPABASE_LOGOS_BUCKET).
drop policy if exists "Allow anon upload logos" on storage.objects;
drop policy if exists "Allow public read logos" on storage.objects;
drop policy if exists "Allow anon insert storage" on storage.objects;
drop policy if exists "Allow anon select storage" on storage.objects;
drop policy if exists "Allow authenticated insert storage" on storage.objects;
drop policy if exists "Allow authenticated select storage" on storage.objects;

create policy "Allow anon insert storage"
  on storage.objects for insert to anon with check (bucket_id = 'logos');
create policy "Allow anon select storage"
  on storage.objects for select to anon using (bucket_id = 'logos');
create policy "Allow authenticated insert storage"
  on storage.objects for insert to authenticated with check (bucket_id = 'logos');
create policy "Allow authenticated select storage"
  on storage.objects for select to authenticated using (bucket_id = 'logos');
