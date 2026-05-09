-- Verification status of a profile under manual review.
create type public.verification_status as enum ('pending', 'approved', 'rejected');

-- Acceptable identity document types.
create type public.document_type as enum ('passport', 'id_card', 'driver_license');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  document_type public.document_type not null,
  document_image_path text not null,
  selfie_image_path text not null,
  verification_status public.verification_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_verification_status_idx on public.profiles (verification_status);
create index profiles_created_at_idx on public.profiles (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
