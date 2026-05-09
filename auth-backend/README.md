# auth-backend

Fastify + TypeScript service for Supabase-backed user auth with manual identity review. Implements `auth-backend-plan.md` Phases 1–5.

## Setup

```bash
cd auth-backend
npm install
cp .env.example .env
# .env is already populated with SUPABASE_URL and SUPABASE_ANON_KEY for the
# linked project (rwpzgsooevcmfcjaiqsy). You still need the service role key:
#   Supabase Dashboard → Project Settings → API → service_role secret
# Paste it into SUPABASE_SERVICE_ROLE_KEY (replacing the PASTE_ placeholder).
```

Until the service role key is real, integration tests skip themselves automatically — the suite stays green but only exercises offline paths.

## Run

```bash
npm run dev          # tsx watch on :8080
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # emits dist/
npm start            # node dist/server.js
```

## Storage bucket bootstrap

The Supabase project is brand-new, so the `storage` schema isn't materialized until something calls the Storage API. The first time the backend runs `ensureBucketExists()` (called inside the integration tests, and you can call it from a one-off script), the bucket is created and the storage tables come into existence. Once that happens, apply `supabase/migrations/0003_storage_policies.sql` via the Supabase SQL editor (or `mcp__supabase__apply_migration`) to lock down RLS on `storage.objects`.

Note: the backend uses the **service role** key for all uploads, signed URLs, and reads, which bypasses RLS by design. The 0003 policies are defense-in-depth, not a correctness gate.

## Granting admin

There is no self-serve admin endpoint. To promote a user:

```bash
npx tsx scripts/grant-admin.ts user@example.com
```

Stores `app_metadata.role = 'admin'` on the Supabase user. The user must obtain a fresh access token (re-login) for the new claim to take effect.

## API summary

| Method | Path                       | Auth           | Notes                                                                                          |
| ------ | -------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `GET`  | `/health`                  | none           | liveness                                                                                       |
| `POST` | `/auth/register`           | none           | multipart: `email`, `password`, `full_name`, `document_type`, `document_image`, `selfie_image` |
| `POST` | `/auth/login`              | none           | JSON: `{ email, password }` — generic 401 message                                              |
| `POST` | `/auth/refresh`            | none           | JSON: `{ refresh_token }`                                                                      |
| `POST` | `/auth/logout`             | bearer         | revokes session                                                                                |
| `GET`  | `/auth/me`                 | bearer         | profile + signed URLs                                                                          |
| `GET`  | `/admin/users/pending`     | bearer + admin | `?limit&cursor` keyset pagination                                                              |
| `POST` | `/admin/users/:id/approve` | bearer + admin | —                                                                                              |
| `POST` | `/admin/users/:id/reject`  | bearer + admin | JSON: `{ reason }`                                                                             |

All errors share the envelope `{ "error": { "code", "message", "details?" } }`.

## Layout

Mirrors `auth-backend-plan.md` §6. Routes are thin; logic lives in `src/services/*`. Validation is a stub in `src/utils/validation.ts` per plan §5 — only that file changes when real zod schemas + image checks land.

## Out of scope (deferred to Phase 6+)

- Real input validation (zod + magic-byte sniffing)
- Production CORS allowlist & rate-limit tuning
- Dockerfile, CI, deploy config
- Email notifications on approve/reject
- Reapply flow after rejection
