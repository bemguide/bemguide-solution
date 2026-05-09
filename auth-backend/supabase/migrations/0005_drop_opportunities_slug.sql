-- slug was the [PLACE] public URL key in 0004_opportunities. URLs will use
-- id (uuid) instead, so the column has no purpose. Dropping the column also
-- cascade-drops the implicit unique index opportunities_slug_key.

alter table public.opportunities
  drop column slug;
