alter table public.profiles enable row level security;

create policy "profiles_self_read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_admin_read"
  on public.profiles for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
