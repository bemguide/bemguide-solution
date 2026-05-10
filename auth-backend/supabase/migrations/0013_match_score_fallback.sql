-- 0013_match_score_fallback.sql
-- Refine compute_match_score so the classified_interest path takes priority
-- but falls back to the legacy free-form `interests` text[] overlap when no
-- classified match exists. This preserves matching for:
--   • brand-new rows whose classifier hook hasn't fired yet
--   • any row the classifier coverage misses
--   • the rollback path (you can blank classified_interest without breaking
--     scoring)
--
-- Behaviour:
--   classified_overlap_count > 0  → use that
--   classified_overlap_count = 0  → recount against legacy `interests`
--                                   text[]; this matches pre-0011 logic
--
-- We deliberately do NOT sum both (would double-count rows tagged in both
-- vocabularies, inflating scores). The new column wins when it has signal;
-- the old column is the safety net.

create or replace function public.compute_match_score(p_user_id uuid, p_opportunity_id uuid)
returns numeric
language plpgsql
stable
as $function$
declare
  u             public.users%rowtype;
  o             public.opportunities%rowtype;
  base_score    numeric := 0;
  overlap_count int;
begin
  select * into u from public.users         where id = p_user_id;
  if not found then return 0; end if;

  select * into o from public.opportunities where id = p_opportunity_id;
  if not found then return 0; end if;

  if u.city is null or o.city is null or u.city <> o.city then
    return 0;
  end if;

  base_score := 1;

  -- Primary: classified_interest overlap (controlled enum, populated by the
  -- AI classifier).
  select count(*) into overlap_count
  from unnest(u.classified_interest) x
  where x = any(o.classified_interest);

  -- Fallback: if classifier coverage missed signal that the legacy free-
  -- form tags caught, count those instead. Same column shape, same scoring
  -- weight (one point per overlap), so the score scale is unchanged.
  if overlap_count = 0 then
    select count(*) into overlap_count
    from unnest(u.interests) x
    where x = any(o.interests);
  end if;

  base_score := base_score + overlap_count;

  if array_length(o.accessibility_flags, 1) is not null
     and array_length(u.accessibility_flags, 1) is not null
     and u.accessibility_flags <@ o.accessibility_flags then
    base_score := base_score + 1;
  end if;

  if u.age_range is not null
     and array_length(o.target_age_range, 1) is not null
     and u.age_range = any(o.target_age_range) then
    base_score := base_score + 1;
  end if;

  if o.target_identity_pref <> 'any'
     and u.company_preference::text = o.target_identity_pref::text then
    base_score := base_score + 1;
  end if;

  if u.veteran_status is not null
     and array_length(o.target_veteran_status, 1) is not null
     and u.veteran_status = any(o.target_veteran_status) then
    base_score := base_score + 1;
  end if;

  return base_score;
end;
$function$;
