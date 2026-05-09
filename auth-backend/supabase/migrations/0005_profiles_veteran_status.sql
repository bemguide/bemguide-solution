-- Drop the manual verification flow (assume every profile is verified for now)
-- and replace it with a veteran category drawn from Ukrainian veteran law
-- ("Про статус ветеранів війни, гарантії їх соціального захисту").

-- 1) drop verification-related columns
alter table public.profiles
  drop column if exists verification_status,
  drop column if exists reviewed_by,
  drop column if exists reviewed_at,
  drop column if exists rejection_reason;

-- 2) drop the now-unused index and enum
drop index if exists public.profiles_verification_status_idx;
drop type  if exists public.verification_status;

-- 3) veteran category enum
--    keys are short ascii; the long Ukrainian label lives in the app layer / UI
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'veteran_status' and n.nspname = 'public'
  ) then
    create type public.veteran_status as enum (
      'ubd',                    -- учасник бойових дій
      'volunteer',              -- доброволець (добровольчих формувань)
      'active_duty',            -- військовослужбовець (на службі)
      'veteran',                -- ветеран війни / демобілізований
      'war_disabled',           -- особа з інвалідністю внаслідок війни
      'former_pow',             -- колишній полонений
      'family_of_fallen',       -- член сім'ї загиблого / померлого
      'family_of_missing',      -- член сім'ї зниклого безвісти / полоненого
      'family_of_veteran',      -- член сім'ї ветерана
      'civilian_affected'       -- цивільний, постраждалий від війни
    );
  end if;
end $$;

-- 4) add the column. Nullable = "не вказано / ще не заповнив".
alter table public.profiles
  add column if not exists veteran_status public.veteran_status;

create index profiles_veteran_status_idx on public.profiles (veteran_status);
