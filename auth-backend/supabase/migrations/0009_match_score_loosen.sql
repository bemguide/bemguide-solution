-- Loosen the matching function so the feed always has something to rank,
-- and turn matching into a *re-ranker* rather than a gate.
--
-- Before this migration:
--   * Hard filter on same city
--   * Hard filter on accessibility (user.accessibility_flags <@ opp.accessibility_flags)
--   * Score = interest overlap count + audience bonuses
--   * Triggers only insert rows where score > 0 → users with strict accessibility
--     needs (or no interest overlap with any opportunity tag) get an empty feed.
--
-- After:
--   * Only hard filter: same city. Cross-city matches make no product sense
--     and the triggers already filter opportunities by city.
--   * Baseline = 1 for every same-city candidate so they appear in the feed
--     even with no overlapping signals. Score is purely a re-ranker.
--   * Accessibility is now a bonus (+1) when the opportunity actually declares
--     flags AND covers all user requirements. Empty opp flags = "unknown",
--     neither bonus nor penalty.
--   * Existing audience bonuses (age_range, identity_pref, veteran_status) unchanged.
--
-- Score interpretation after this migration:
--   1 = same-city baseline
--   1 + N (N = interest overlap count)
--   1 + N + (0 or 1) accessibility coverage
--   1 + N + (0 or 1) age_range bonus
--   1 + N + (0 or 1) identity / company_preference bonus
--   1 + N + (0 or 1) veteran_status bonus
--
-- Range: 1..6 in practice. Higher = better.

create or replace function public.compute_match_score(
  p_user_id        uuid,
  p_opportunity_id uuid
) returns numeric
language plpgsql
stable
as $$
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

  -- Only hard filter: same city. Treat null cities on either side as non-matching.
  if u.city is null or o.city is null or u.city <> o.city then
    return 0;
  end if;

  -- Baseline: every same-city opportunity ranks above 0 so the feed always
  -- has candidates. Bonuses below add ordering signal on top.
  base_score := 1;

  -- Bonus: interest overlap count. Each shared interest = +1.
  select count(*) into overlap_count
  from unnest(u.interests) x
  where x = any(o.interests);
  base_score := base_score + overlap_count;

  -- Bonus: accessibility coverage. Fires only when BOTH sides have non-empty
  -- flag arrays AND the opportunity covers every flag the user requires.
  -- Empty opp flags are treated as "unknown" — no bonus, no penalty (this is
  -- the change vs. the previous hard-filter behaviour).
  if array_length(o.accessibility_flags, 1) is not null
     and array_length(u.accessibility_flags, 1) is not null
     and u.accessibility_flags <@ o.accessibility_flags then
    base_score := base_score + 1;
  end if;

  -- Bonus: age range target list.
  if u.age_range is not null
     and array_length(o.target_age_range, 1) is not null
     and u.age_range = any(o.target_age_range) then
    base_score := base_score + 1;
  end if;

  -- Bonus: identity / company preference (MVP: strict text match).
  if o.target_identity_pref <> 'any'
     and u.company_preference::text = o.target_identity_pref::text then
    base_score := base_score + 1;
  end if;

  -- Bonus: veteran_status target list.
  if u.veteran_status is not null
     and array_length(o.target_veteran_status, 1) is not null
     and u.veteran_status = any(o.target_veteran_status) then
    base_score := base_score + 1;
  end if;

  return base_score;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: rebuild event_matches under the new function so existing users
-- get matches immediately without waiting on a profile edit. Safe to re-run.
-- Mirrors the delete-and-rebuild pattern the existing triggers already use.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_user  record;
  v_opp   record;
  v_score numeric;
begin
  delete from public.event_matches;

  for v_user in select id, city from public.users where city is not null loop
    for v_opp in
      select id from public.opportunities
      where city is not distinct from v_user.city
        and (start_at is null or start_at > (now() at time zone 'utc'))
    loop
      v_score := public.compute_match_score(v_user.id, v_opp.id);
      if v_score > 0 then
        insert into public.event_matches (event_id, user_id, score, computed_at)
        values (v_opp.id, v_user.id, v_score, now());
      end if;
    end loop;
  end loop;
end$$;
