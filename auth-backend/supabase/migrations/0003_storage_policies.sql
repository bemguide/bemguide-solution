-- Apply this AFTER the storage schema has been provisioned. On a brand-new
-- Supabase project, storage.buckets and storage.objects don't exist until the
-- first Storage API call (e.g. createBucket from supabase-js). The
-- scripts/bootstrap-storage.ts script triggers that bootstrap and then this
-- file can be applied via the Supabase SQL editor or `apply_migration`.

create policy "user_documents_owner_read"
  on storage.objects for select
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_documents_admin_read"
  on storage.objects for select
  using (
    bucket_id = 'user-documents'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- No insert / update / delete policy: writes only via service role (server-only).
