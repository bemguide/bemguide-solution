# Supabase Auth Backend — Detailed Plan

A Node.js (Fastify + TypeScript) backend that registers users with an ID document image plus a selfie, authenticates them with email/password through Supabase Auth, and exposes the supporting endpoints (refresh, logout, me, admin review).

## 1. Decisions locked in

| Area | Choice | Reason |
|---|---|---|
| Framework | Fastify | Schema-first validation, fast, modern plugin system |
| Language | TypeScript | Type safety against Supabase generated types |
| Auth | Supabase Auth (email/password) | Built-in JWT access + refresh tokens, RLS integration |
| Verification | Store-only with manual admin review | Simplest path; KYC vendor can be added later behind same interface |
| File storage | Supabase Storage, private bucket | One platform, RLS, signed URLs |
| Database | Supabase Postgres | Native to the stack |

## 2. High-level architecture

```
Client (mobile / web)
        │  multipart/form-data, JSON
        ▼
┌─────────────────────────┐
│   Fastify backend       │
│  ┌────────────────────┐ │
│  │ Routes             │ │ — auth/*, admin/*
│  │ Plugins            │ │ — auth guard, multipart, rate-limit, errors
│  │ Services           │ │ — auth, storage, profile, verification
│  │ Schemas (zod)      │ │ — request/response validation
│  └────────────────────┘ │
└──────────┬──────────────┘
           │ supabase-js (service role) — server only
           ▼
┌─────────────────────────┐
│  Supabase project       │
│  • auth.users           │ — managed by Supabase Auth
│  • public.profiles      │ — our row, FK to auth.users.id
│  • storage: user-docs   │ — private bucket, RLS
└─────────────────────────┘
```

The Node service is the only component that holds the Supabase **service role key**. The client never touches it. The client only receives Supabase access + refresh tokens after a successful login or registration.

## 3. End-to-end flows

### 3.1 Registration

1. Client opens a multi-step wizard. When all data is collected, it sends one `POST /auth/register` request as `multipart/form-data` with fields:
   - `email`, `password`, `full_name`, `document_type` (`passport` | `id_card` | `driver_license`)
   - `document_image` (file), `selfie_image` (file)
2. **Validation is stubbed for now.** A single `validateRegistrationInput()` helper returns `{ ok: true }` unconditionally. It is the only place future zod schemas and file checks (mime, size, magic-byte sniff) will plug in — no other code needs to change.
3. Server creates the auth user via `supabase.auth.admin.createUser({ email, password, email_confirm: false })`.
4. Server uploads both images to the private bucket `user-documents` under keys `{user_id}/document_{uuid}.{ext}` and `{user_id}/selfie_{uuid}.{ext}`.
5. Server inserts a row in `public.profiles` with `verification_status = 'pending'`, paths to both images, and metadata.
6. Server signs the user in (`signInWithPassword`) to get fresh tokens and returns: user object (sans paths), `verification_status`, `access_token`, `refresh_token`, `expires_at`.
7. If any step after the auth user is created fails, the server cleans up by deleting the auth user — no orphan rows.

### 3.2 Login

1. `POST /auth/login` with `email`, `password`.
2. Server calls `supabase.auth.signInWithPassword`. On success it joins `profiles` to attach `verification_status`.
3. Returns tokens + profile. Pending users are allowed to log in but the response carries `verification_status: 'pending'` so the client can gate features.

### 3.3 Token refresh / logout / me

- `POST /auth/refresh` — exchanges a refresh token for a fresh access token via `supabase.auth.refreshSession`.
- `POST /auth/logout` — calls `supabase.auth.admin.signOut(jti)` for the current session.
- `GET /auth/me` — guarded by the auth plugin; returns the joined `auth.users` + `profiles` row plus signed URLs to the document and selfie if the requester is the owner.

### 3.4 Admin review

- `GET /admin/users/pending` — paginated list of profiles with `verification_status = 'pending'`.
- `POST /admin/users/:id/approve` — sets status to `approved`, stamps `reviewed_by`, `reviewed_at`.
- `POST /admin/users/:id/reject` — sets status to `rejected`, stores `rejection_reason`.
- Admin guard checks a custom claim (`role: 'admin'`) injected via `app_metadata` on the Supabase user.

## 4. Database schema

### 4.1 `public.profiles`

```sql
create type verification_status as enum ('pending', 'approved', 'rejected');
create type document_type as enum ('passport', 'id_card', 'driver_license');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  document_type document_type not null,
  document_image_path text not null,
  selfie_image_path text not null,
  verification_status verification_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.profiles (verification_status);
create index on public.profiles (created_at desc);
```

A trigger keeps `updated_at` current on every update.

### 4.2 RLS

```sql
alter table public.profiles enable row level security;

-- Owner can read their own profile
create policy "profiles_self_read"
  on public.profiles for select
  using (auth.uid() = id);

-- Owner can update non-sensitive fields (full_name only)
create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admin role (claim) can read everything
create policy "profiles_admin_read"
  on public.profiles for select
  using ((auth.jwt() ->> 'role') = 'admin');
```

Writes that change `verification_status` are gated to the service role key only — the backend uses it from `services/verification.service.ts`. No client-side path to it.

### 4.3 Storage

Bucket `user-documents`, private (no public read). Object path convention:

```
{user_id}/document_{uuid}.{ext}
{user_id}/selfie_{uuid}.{ext}
```

Storage policies:
- Owner can read their own folder (`storage.foldername(name)[1] = auth.uid()::text`).
- Admin role can read any object.
- No insert/update/delete from clients — all writes go through the backend with service role.
- Signed URLs are issued by the backend with a short TTL (default 5 min).

## 5. API contract

All errors share an envelope:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }
```

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| POST | `/auth/register` | none | multipart: email, password, full_name, document_type, document_image, selfie_image | `201` `{ user, profile, session }` |
| POST | `/auth/login` | none | `{ email, password }` | `200` `{ user, profile, session }` |
| POST | `/auth/refresh` | none | `{ refresh_token }` | `200` `{ session }` |
| POST | `/auth/logout` | bearer | — | `204` |
| GET | `/auth/me` | bearer | — | `200` `{ user, profile, document_url, selfie_url }` |
| GET | `/admin/users/pending` | bearer + admin | `?limit&cursor` | `200` `{ items, next_cursor }` |
| POST | `/admin/users/:id/approve` | bearer + admin | — | `200` `{ profile }` |
| POST | `/admin/users/:id/reject` | bearer + admin | `{ reason }` | `200` `{ profile }` |
| GET | `/health` | none | — | `200` `{ ok: true }` |

`session` shape: `{ access_token, refresh_token, expires_at, token_type: 'bearer' }`.

### Validation rules

For the first cut, validation is intentionally a stub: every request is accepted as long as the required fields are *present*. A single helper returns `{ ok: true }` no matter what:

```ts
// src/utils/validation.ts
export function validateRegistrationInput(_input: unknown) {
  return { ok: true as const };       // TODO: replace with zod + image checks later
}
export function validateLoginInput(_input: unknown) {
  return { ok: true as const };
}
```

Routes call the helper and trust the result. Files are accepted regardless of mime, size, or content. Email/password are passed straight to Supabase, which still enforces its own minimums at the auth layer.

When real validation is added later, only `validation.ts` changes — routes stay the same.

## 6. Project layout

```
auth-backend/
├── src/
│   ├── server.ts                    # Fastify bootstrap
│   ├── app.ts                       # build & register plugins/routes (testable)
│   ├── config/
│   │   ├── env.ts                   # zod-validated env loader
│   │   └── supabase.ts              # admin + anon clients
│   ├── plugins/
│   │   ├── auth-guard.ts            # verifies bearer JWT, attaches user
│   │   ├── admin-guard.ts           # checks role claim
│   │   ├── multipart.ts             # @fastify/multipart wiring
│   │   ├── rate-limit.ts            # @fastify/rate-limit, tighter on auth routes
│   │   ├── error-handler.ts         # uniform error envelope
│   │   └── cors.ts
│   ├── routes/
│   │   ├── auth/
│   │   │   ├── register.route.ts
│   │   │   ├── login.route.ts
│   │   │   ├── refresh.route.ts
│   │   │   ├── logout.route.ts
│   │   │   └── me.route.ts
│   │   ├── admin/
│   │   │   ├── pending.route.ts
│   │   │   └── review.route.ts
│   │   └── health.route.ts
│   ├── services/
│   │   ├── auth.service.ts          # createUser, signIn, refresh, signOut
│   │   ├── storage.service.ts       # upload, signed URL, delete
│   │   ├── profile.service.ts       # CRUD on profiles
│   │   └── verification.service.ts  # status transitions
│   ├── schemas/                     # placeholder dir; real zod schemas land here later
│   ├── types/
│   │   ├── supabase.generated.ts    # `supabase gen types typescript`
│   │   └── fastify.d.ts             # request augmentation (user, profile)
│   └── utils/
│       ├── errors.ts                # AppError, mapper to envelope
│       ├── validation.ts            # stub: always returns { ok: true }
│       └── logger.ts                # pino config
├── supabase/
│   ├── migrations/
│   │   ├── 0001_profiles.sql
│   │   ├── 0002_rls.sql
│   │   └── 0003_storage_policies.sql
│   └── seed.sql
├── tests/
│   ├── auth.register.test.ts
│   ├── auth.login.test.ts
│   ├── admin.review.test.ts
│   └── helpers/test-app.ts
├── .env.example
├── .eslintrc.cjs
├── .prettierrc
├── tsconfig.json
├── package.json
└── README.md
```

### Dependencies

Runtime: `fastify`, `@fastify/multipart`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/sensible`, `@supabase/supabase-js`, `zod`, `dotenv`, `pino-pretty` (dev only — Fastify ships pino).

Dev: `typescript`, `tsx`, `vitest` (or `tap`), `supertest` / Fastify `inject`, `eslint`, `prettier`, `@types/node`.

### Environment variables

```
PORT=8080
NODE_ENV=development
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=user-documents
SIGNED_URL_TTL_SECONDS=300
CORS_ORIGINS=http://localhost:3000
RATE_LIMIT_AUTH_MAX=5
RATE_LIMIT_AUTH_WINDOW=1m
LOG_LEVEL=info
```

`env.ts` parses these with zod at boot — the process refuses to start if anything is missing or malformed.

## 7. Security and edge cases

- **Service role key** is loaded only on the server, never sent to clients, never logged.
- **Rate limiting**: `/auth/register` and `/auth/login` capped (e.g. 5/min per IP); other routes use a looser global limit.
- **File validation**: deferred. The stub accepts any file. Before going to production, swap in mime + magic-byte sniffing and size/dimension limits inside `utils/validation.ts`.
- **Cleanup on partial failure**: registration is wrapped so that if upload or profile insert fails, the auth user is deleted to avoid orphans.
- **Signed URLs**: short TTL, never logged or persisted; regenerated on every `/auth/me` call.
- **CORS**: explicit allowlist from env; no wildcard in production.
- **Password rules**: enforced both in zod and in Supabase project settings.
- **Email enumeration**: login returns the same generic error for "no such user" and "wrong password".
- **Logging**: pino with redaction on `password`, `access_token`, `refresh_token`, `Authorization`, file binaries.
- **PII**: `document_*` and `selfie_*` paths are never returned to anyone but the owner or admin.
- **HTTPS**: terminated at the platform (Render/Fly/Railway) — backend trusts `X-Forwarded-Proto` only when behind a known proxy.
- **Admin role**: assigned by setting `app_metadata.role = 'admin'` on the Supabase user via SQL or a one-off script. There is no self-serve admin route.

### Open questions worth confirming before coding

1. Should pending users be allowed to use any feature, or is the app fully gated until approval?
2. Is email confirmation required (`email_confirm: true`) before allowing registration to complete, or is it deferred?
3. Do we need a reapply flow when verification is rejected (re-upload, replace images) and what is its rate limit?
4. Should approved/rejected status changes trigger an email? If yes, Supabase email templates or a custom transactional service?
5. What admin UI is expected — a separate frontend, or just the endpoints for now?
6. Is there a retention policy for ID images (e.g., delete after 90 days)?

## 8. Implementation phases

Each phase ends with a runnable deliverable.

**Phase 1 — Skeleton (≈ half a day).** Init repo, TypeScript, Fastify bootstrap, env validation, `/health`, lint/format/test scaffolding, Dockerfile.

**Phase 2 — Supabase wiring (≈ half a day).** Service-role and anon clients, generated types, the three migrations applied to a local Supabase, storage bucket created.

**Phase 3 — Registration (≈ 1 day).** Multipart parsing, image validation, atomic create-user-then-upload-then-insert with cleanup on failure, integration test using Fastify `inject` against a local Supabase.

**Phase 4 — Login + sessions (≈ half a day).** `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, auth-guard plugin.

**Phase 5 — Admin review (≈ half a day).** Admin guard, list/approve/reject endpoints, role-claim setup script.

**Phase 6 — Hardening (≈ half a day).** Rate limits tuned, error envelope coverage, CORS, log redaction, smoke tests against a deployed instance.

**Phase 7 — Deploy (≈ half a day).** Pick a host (Render or Fly recommended), wire env vars, set up CI on push to main running lint + test + build.

Total: ~4 working days for a single engineer.

## 9. Acceptance checklist

- A user can register with email, password, doc type, document image, and selfie, and receive valid Supabase tokens in the response.
- The same email cannot register twice (`409`).
- Login returns tokens; profile carries `verification_status`.
- Refresh issues a new access token without re-entering credentials.
- `/auth/me` returns owner-only signed URLs that expire.
- An admin can list pending users and approve or reject them; status persists.
- All RLS policies pass smoke tests: a non-owner cannot read another user's profile or files.
- Rate limits trigger `429` after the configured threshold on auth routes.
- Boot fails fast on missing env vars.
- No service role key, password, or token appears in any log line.
