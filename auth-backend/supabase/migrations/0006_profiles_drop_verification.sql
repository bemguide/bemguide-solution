-- Verification removed entirely: no document type, no document image,
-- no selfie. Registration becomes "email + password + the 12 questions".
-- The `user-documents` storage bucket itself is killed at runtime
-- (it's created via the Storage API, not SQL), but its policies live
-- in this schema, so we drop them here.

alter table public.profiles
  drop column if exists document_type,
  drop column if exists document_image_path,
  drop column if exists selfie_image_path;

drop type if exists public.document_type;

-- storage policies for the retired bucket
drop policy if exists "user_documents_owner_read" on storage.objects;
drop policy if exists "user_documents_admin_read" on storage.objects;
