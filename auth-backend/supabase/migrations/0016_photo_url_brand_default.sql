-- 0016_photo_url_brand_default.sql
-- One-time backfill + ongoing default for opportunities.photo_url and
-- opportunity_health.photo_url. Stamps every existing row with the
-- "Просвіт" brand wordmark hosted at files.catbox.moe, and adds a
-- column-level DEFAULT so future inserts that omit photo_url fall back
-- to the same image.
--
-- Reversibility: the prior photo_url for every row is captured in
-- public.photo_url_backup_20260510_brand BEFORE any UPDATE runs. To roll
-- back the data change:
--   update public.opportunities o
--     set photo_url = b.photo_url
--     from public.photo_url_backup_20260510_brand b
--     where b.table_name = 'opportunities' and b.row_id = o.id;
--   (and the equivalent for opportunity_health)
-- To roll back the DEFAULT:
--   alter table public.opportunities alter column photo_url drop default;
--   alter table public.opportunity_health alter column photo_url drop default;
-- opportunity_program intentionally untouched — it has no photo_url
-- column (link-card shape, source_url + source_label only).

-- 1) Snapshot existing photo_url values --------------------------------------

create table public.photo_url_backup_20260510_brand (
  table_name text not null,
  row_id     uuid not null,
  photo_url  text,
  taken_at   timestamptz not null default now(),
  primary key (table_name, row_id)
);

insert into public.photo_url_backup_20260510_brand (table_name, row_id, photo_url)
  select 'opportunities', id, photo_url from public.opportunities;

insert into public.photo_url_backup_20260510_brand (table_name, row_id, photo_url)
  select 'opportunity_health', id, photo_url from public.opportunity_health;

-- 2) Stamp every row with the brand image -----------------------------------

update public.opportunities
  set photo_url = 'https://files.catbox.moe/vthth1.png';

update public.opportunity_health
  set photo_url = 'https://files.catbox.moe/vthth1.png';

-- 3) New rows fall back to the brand image when photo_url is omitted --------
-- Note: explicit NULL on insert still wins over a column DEFAULT; the FE
-- must OMIT the photo_url field (rather than nulling it) for the default
-- to engage. createOpportunitySchema already accepts an absent photo_url
-- via .nullish(), so this works for the standard create flow.

alter table public.opportunities
  alter column photo_url set default 'https://files.catbox.moe/vthth1.png';

alter table public.opportunity_health
  alter column photo_url set default 'https://files.catbox.moe/vthth1.png';
