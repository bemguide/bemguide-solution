import crypto from 'node:crypto';
import { buildApp } from './app.js';
import { env } from './config/env.js';

// SHA-256 prefix is enough to compare two values without exposing them.
// Reproduce locally with:
//   node -e "require('dotenv').config(); const c=require('crypto'); \
//     console.log(c.createHash('sha256').update(process.env.SUPABASE_SERVICE_ROLE_KEY).digest('hex').slice(0,12))"
function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

async function main(): Promise<void> {
  const app = await buildApp();
  app.log.info(
    {
      supabase_url: env.SUPABASE_URL,
      service_role_key_len: env.SUPABASE_SERVICE_ROLE_KEY.length,
      service_role_key_fp: fingerprint(env.SUPABASE_SERVICE_ROLE_KEY),
      anon_key_len: env.SUPABASE_ANON_KEY.length,
      anon_key_fp: fingerprint(env.SUPABASE_ANON_KEY),
      node_env: env.NODE_ENV,
    },
    'supabase env fingerprint at boot',
  );
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void main();
