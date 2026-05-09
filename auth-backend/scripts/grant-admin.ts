// One-off CLI: grant the `admin` role to a user by email.
// Usage: npx tsx scripts/grant-admin.ts <email>
//
// The role is stored in app_metadata, which Supabase signs into JWTs and which
// the admin-guard plugin reads. There is no self-serve admin endpoint.

import { supabaseAdmin } from '../src/config/supabase.js';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/grant-admin.ts <email>');
    process.exit(1);
  }

  let userId: string | undefined;
  let page = 1;
  while (page <= 10 && !userId) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error('listUsers failed:', error.message);
      process.exit(2);
    }
    const found = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) userId = found.id;
    if (!data || data.users.length < 200) break;
    page += 1;
  }

  if (!userId) {
    console.error(`No user found with email ${email}`);
    process.exit(3);
  }

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { role: 'admin' },
  });
  if (updateErr) {
    console.error('updateUserById failed:', updateErr.message);
    process.exit(4);
  }
  console.log(`Granted admin role to ${email} (id=${userId}).`);
  console.log(
    'The user must obtain a fresh access token (re-login) for the new claim to take effect.',
  );
}

void main();
