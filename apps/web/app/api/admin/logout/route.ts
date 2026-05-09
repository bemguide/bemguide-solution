import { NextResponse } from "next/server";
import { clearAdminCookie } from "@/lib/admin";

export async function POST(req: Request) {
  await clearAdminCookie();
  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/admin/login", url.origin), { status: 303 });
}
