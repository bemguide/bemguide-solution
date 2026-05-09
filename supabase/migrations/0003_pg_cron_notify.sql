-- 0003_pg_cron_notify.sql — schedule the notify-scheduler edge function once a minute
-- using pg_cron + pg_net. Falls back to whatever cadence Vercel cron offers
-- on the user's plan (Hobby = daily). Run AFTER the function is deployed.
--
-- Apply via Studio → SQL Editor (same path as 0001/0002).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Read the project URL + cron secret from Vault / Project settings if available.
-- For now we hard-code via psql variable substitution — replace before pasting.
-- Override these two values with your own when running this script:
--   :project_ref   e.g. 'rwpzgsooevcmfcjaiqsy'
--   :cron_secret   the VERCEL_CRON_SECRET value pushed to edge function secrets

-- Idempotent: drop the old job first.
do $$
declare
  job_id integer;
begin
  for job_id in select jobid from cron.job where jobname = 'poruch_notify_scheduler' loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

-- Replace <PROJECT_REF> and <CRON_SECRET> with your values before running.
-- (Search-and-replace in the SQL editor; pg_cron does NOT do shell-style substitution.)
select cron.schedule(
  'poruch_notify_scheduler',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <CRON_SECRET>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);
