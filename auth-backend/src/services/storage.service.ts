import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export type FileKind = 'document' | 'selfie';

function extFromFilename(filename: string | undefined): string {
  if (!filename) return 'bin';
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'bin';
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : 'bin';
}

export interface UploadInput {
  buffer: Buffer;
  filename?: string;
  mimetype?: string;
}

export async function uploadUserFile(
  userId: string,
  kind: FileKind,
  file: UploadInput,
): Promise<string> {
  const path = `${userId}/${kind}_${randomUUID()}.${extFromFilename(file.filename)}`;
  const { error } = await supabaseAdmin.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .upload(path, file.buffer, {
      contentType: file.mimetype ?? 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw AppError.upstream(`Failed to upload ${kind}`, error.message);
  }
  return path;
}

export async function signedUrlFor(
  path: string,
  ttlSeconds = env.SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(path, ttlSeconds);

  if (error || !data?.signedUrl) {
    throw AppError.upstream('Failed to sign URL', error?.message);
  }
  return data.signedUrl;
}

export async function deleteUserFolder(userId: string): Promise<void> {
  const bucket = supabaseAdmin.storage.from(env.SUPABASE_STORAGE_BUCKET);
  const { data, error } = await bucket.list(userId, { limit: 1000 });
  if (error || !data) return;
  if (data.length === 0) return;
  const paths = data.map((entry) => `${userId}/${entry.name}`);
  await bucket.remove(paths);
}

export async function ensureBucketExists(): Promise<void> {
  const bucketName = env.SUPABASE_STORAGE_BUCKET;
  const { data } = await supabaseAdmin.storage.getBucket(bucketName);
  if (data) return;
  const { error: createErr } = await supabaseAdmin.storage.createBucket(bucketName, {
    public: false,
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    throw AppError.upstream('Failed to create storage bucket', createErr.message);
  }
}
