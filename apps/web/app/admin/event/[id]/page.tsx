// /admin/event/[id] — full preview + AI panel + action buttons.

import { notFound } from "next/navigation";
import { RemoteImage } from "@/components/poruch/RemoteImage";
import { requireAdmin } from "@/lib/admin";
import { serverSupabase } from "@/lib/supabase/server";
import { formatEventDateTime, formatPrice } from "@/lib/format";
import { AccessibilityStrip } from "@/components/poruch/AccessibilityStrip";
import { ModerationActions } from "./ModerationActions";
import type { EventForDisplay } from "@/lib/types";

export const dynamic = "force-dynamic";

type LogRow = {
  id: number;
  action: string;
  notes: string | null;
  created_at: string;
};

export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const supabase = serverSupabase();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, slug, title, short_description, description, photo_url, city, oblast, address, location_lat, location_lng, start_at, duration_min, categories, identity_tag, accessibility_flags, honest_absences, price_uah, organizer_contact, status, source, ai_screen_score, ai_screen_notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (!event) notFound();

  const { data: log } = await supabase
    .from("moderation_log")
    .select("id, action, notes, created_at")
    .eq("event_id", id)
    .order("created_at", { ascending: false });
  const logRows = (log ?? []) as LogRow[];

  const display = event as unknown as EventForDisplay & {
    status: string;
    ai_screen_score: number | null;
    ai_screen_notes: { red_flags?: string[]; suggested_edits?: string[] } | null;
  };
  const score = display.ai_screen_score;
  const flags = display.ai_screen_notes?.red_flags ?? [];
  const edits = display.ai_screen_notes?.suggested_edits ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <article className="bg-card border-border space-y-4 overflow-hidden rounded-xl border">
        <div className="bg-muted relative aspect-[16/10] w-full">
          <RemoteImage src={display.photo_url} alt={display.title} />
        </div>
        <div className="space-y-3 p-4">
          <h1 className="text-foreground text-2xl font-semibold leading-tight">{display.title}</h1>
          <p className="text-muted-foreground text-sm">
            {formatEventDateTime(display.start_at)} · {display.city} ·{" "}
            {formatPrice(display.price_uah)}
          </p>
          <AccessibilityStrip
            flags={display.accessibility_flags}
            honestAbsences={display.honest_absences}
          />
          {display.description ? (
            <div className="text-foreground space-y-2 whitespace-pre-line text-base">
              {display.description}
            </div>
          ) : null}
          {display.address ? (
            <p className="text-muted-foreground text-sm">📍 {display.address}</p>
          ) : null}
          {display.organizer_contact ? (
            <p className="text-muted-foreground text-sm">Контакт: {display.organizer_contact}</p>
          ) : null}
        </div>
      </article>

      <aside className="space-y-4">
        <div className="bg-card border-border space-y-3 rounded-xl border p-4">
          <h2 className="text-foreground text-lg font-semibold">AI-перевірка</h2>
          <p className="text-foreground text-3xl font-bold">{score?.toFixed(2) ?? "—"}</p>
          {flags.length > 0 ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs uppercase">Red flags</p>
              <ul className="text-destructive space-y-1 text-sm">
                {flags.map((f, i) => (
                  <li
                    key={i}
                    className="bg-destructive/5 border-destructive/20 rounded border px-2 py-1"
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {edits.length > 0 ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs uppercase">Suggestions</p>
              <ul className="text-foreground list-inside list-disc space-y-1 text-sm">
                {edits.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <ModerationActions eventId={display.id} status={display.status} />

        <div className="bg-card border-border space-y-2 rounded-xl border p-4">
          <h2 className="text-foreground text-lg font-semibold">Історія</h2>
          {logRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Поки порожньо.</p>
          ) : (
            <ul className="space-y-2">
              {logRows.map((r) => (
                <li key={r.id} className="text-foreground text-sm">
                  <span className="font-semibold">{r.action}</span>
                  {r.notes ? <span className="text-muted-foreground"> — {r.notes}</span> : null}
                  <span className="text-muted-foreground ml-2 text-xs">
                    {new Date(r.created_at).toLocaleString("uk-UA")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
