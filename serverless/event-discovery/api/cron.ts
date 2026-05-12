import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runDailySync } from "../lib/orchestrator.js";

export const config = { maxDuration: 300 };

/**
 * Vercel Cron entry. Schedule defined in vercel.json (`0 4 * * *` — daily at 04:00 UTC).
 *
 * Vercel signs cron requests with `Authorization: Bearer <CRON_SECRET>` header
 * (the CRON_SECRET env var you set in the Vercel project settings). We reject
 * anything else so the endpoint isn't a public trigger.
 *
 * For ad-hoc runs you can call this endpoint manually with the same header.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  const expectedAuth = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || req.headers.authorization !== expectedAuth) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const stats = await runDailySync();
    console.log("[cron] done", JSON.stringify(stats));
    return res.status(200).json({ ok: true, stats });
  } catch (e) {
    const err = e as Error;
    console.error("[cron] failed", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
