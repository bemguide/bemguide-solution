// POST /api/admin/login (form-encoded). Verifies password and redirects.

import { NextResponse } from "next/server";
import { setAdminCookie } from "@/lib/admin";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const ok = await setAdminCookie(password);
  const url = new URL(req.url);
  return NextResponse.redirect(new URL(ok ? "/admin/inbox" : "/admin/login?error=1", url.origin), {
    status: 303,
  });
}
