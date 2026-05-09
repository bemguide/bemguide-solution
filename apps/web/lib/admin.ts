// Tiny admin auth: a single HTTP-only cookie that stores the user-provided
// password. Server compares to ADMIN_PASSWORD on every admin request.
// Acceptable for a 1–2 person moderator tool; revisit if more users need access.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverEnv } from "@/lib/env";

const COOKIE = "poruch_admin";
const COOKIE_MAX_AGE = 60 * 60 * 12; // 12 hours

export async function setAdminCookie(password: string) {
  const env = serverEnv();
  if (password !== env.ADMIN_PASSWORD) return false;
  const cookieJar = await cookies();
  cookieJar.set(COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return true;
}

export async function clearAdminCookie() {
  const cookieJar = await cookies();
  cookieJar.delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const env = serverEnv();
  const jar = await cookies();
  return jar.get(COOKIE)?.value === env.ADMIN_PASSWORD;
}

export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}
