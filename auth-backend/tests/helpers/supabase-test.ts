import { env } from '../../src/config/env.js';
import { supabaseAdmin } from '../../src/config/supabase.js';

export const HAS_REAL_SERVICE_ROLE = !env.SUPABASE_SERVICE_ROLE_KEY.startsWith('PASTE_');

export async function deleteUserByEmail(email: string): Promise<void> {
  if (!HAS_REAL_SERVICE_ROLE) return;
  // The admin API doesn't expose a "find by email" endpoint cheaply, so list and filter.
  let page = 1;
  // Loop a small number of pages — test users are short-lived.
  while (page <= 5) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users.length) return;
    const target = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (target) {
      await supabaseAdmin.auth.admin.deleteUser(target.id);
      return;
    }
    if (data.users.length < 200) return;
    page += 1;
  }
}

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}+${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}
