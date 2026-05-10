-- 0017_photo_url_brand_v2.sql
-- Swap the brand image: the original PNG (vthth1.png) is replaced with a
-- refined WebP version (y5fise.webp). Same wordmark, more whitespace,
-- ~14× smaller payload (74KB vs 1.0MB).
--
-- WHERE-filtered swap: only rows whose photo_url is still the v1 URL get
-- updated. Any row that was manually re-pinned to a different image after
-- 0016 keeps its custom value. Today this is identical in effect to a
-- blind overwrite — every row is on v1 — but the filter is cheap insurance.
--
-- The pre-brand snapshot from 0016 (public.photo_url_backup_20260510_brand)
-- is intentionally NOT touched. It still represents the pre-brand state,
-- which is the only rollback target worth keeping. To revert from v2 back
-- to v1 you can swap the URLs in this migration; to revert to per-event
-- imagery, apply the rollback recipe in 0016's header.
--
-- opportunity_program intentionally untouched — no photo_url column.

-- 1) Swap data ---------------------------------------------------------------

update public.opportunities
  set photo_url = 'https://files.catbox.moe/y5fise.webp'
  where photo_url = 'https://files.catbox.moe/vthth1.png';

update public.opportunity_health
  set photo_url = 'https://files.catbox.moe/y5fise.webp'
  where photo_url = 'https://files.catbox.moe/vthth1.png';

-- 2) Swap DEFAULT ------------------------------------------------------------

alter table public.opportunities
  alter column photo_url set default 'https://files.catbox.moe/y5fise.webp';

alter table public.opportunity_health
  alter column photo_url set default 'https://files.catbox.moe/y5fise.webp';
