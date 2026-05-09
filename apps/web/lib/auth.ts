// Server-side helper: verify the X-Telegram-InitData header on an incoming
// API request and return the matching veterans row (creating it on first contact).

import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { verifyInitData, type TgInitData } from "@/lib/telegram/initdata";

export type AuthedVeteran = {
  veteran_id: string;
  tg_user_id: number;
  display_name: string | null;
  city: string | null;
  initData: TgInitData;
};

export async function authedVeteran(
  req: Request,
): Promise<{ ok: true; veteran: AuthedVeteran } | { ok: false; response: Response }> {
  const initDataRaw = req.headers.get("x-telegram-initdata");
  const initData = await verifyInitData(initDataRaw);
  if (!initData?.user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }
  const supabase = serverSupabase();
  const tgUserId = initData.user.id;

  // Upsert by tg_user_id. We never trust client-provided display_name beyond
  // the initial first_name. Profile edits go through /api/veteran/update.
  const { data: existing } = await supabase
    .from("veterans")
    .select("id, display_name, city")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();

  let veteranId: string;
  let displayName: string | null;
  let city: string | null;
  if (!existing) {
    const { data: created, error } = await supabase
      .from("veterans")
      .insert({
        tg_user_id: tgUserId,
        display_name: initData.user.first_name ?? null,
        language: initData.user.language_code ?? "uk",
        last_active_at: new Date().toISOString(),
      })
      .select("id, display_name, city")
      .single();
    if (error || !created) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "create failed" }, { status: 500 }),
      };
    }
    veteranId = created.id;
    displayName = created.display_name;
    city = created.city;
  } else {
    veteranId = existing.id;
    displayName = existing.display_name;
    city = existing.city;
    void supabase
      .from("veterans")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", veteranId);
  }

  return {
    ok: true,
    veteran: {
      veteran_id: veteranId,
      tg_user_id: tgUserId,
      display_name: displayName,
      city,
      initData,
    },
  };
}
