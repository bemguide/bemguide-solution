-- 0012_match_score_classified.sql
-- Cut compute_match_score over to read u.classified_interest && o.classified_interest
-- now that the backfill has populated those columns across users + opportunities.
-- Until this migration runs, the matcher reads the legacy free-form `interests`
-- text[] columns; afterwards it reads the controlled enum.
--
-- Drop-in replacement: signature unchanged, return type unchanged, scoring
-- weights unchanged. The only line that changes is the interest-overlap
-- count.
--
-- Triggers (opportunities_match_recompute, users_match_recompute) re-fire
-- naturally on the next user or opportunity write. To force a full rebuild
-- of event_matches without waiting for natural writes:
--   UPDATE public.opportunities SET id = id;
--   UPDATE public.users SET id = id;

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

  -- Was: unnest(u.interests) x where x = any(o.interests)
  -- Now: same shape against the controlled enum column.
  select count(*) into overlap_count
  from unnest(u.classified_interest) x
  where x = any(o.classified_interest);
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
