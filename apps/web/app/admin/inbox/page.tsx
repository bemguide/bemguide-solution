// /admin/inbox — moderation queue.
// Sorted by ai_screen_score ASC (red flags surface first), then created_at ASC.

import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { serverSupabase } from "@/lib/supabase/server";
import { formatEventDateTime } from "@/lib/format";

type Row = {
  id: string;
  title: string;
  city: string;
  start_at: string;
  ai_screen_score: number | null;
  ai_screen_notes: { red_flags?: string[]; suggested_edits?: string[] } | null;
  source: string;
  created_at: string;
};

function scoreBadge(score: number | null) {
  if (score == null) return { label: "—", color: "bg-muted text-muted-foreground" };
  if (score >= 0.8) return { label: score.toFixed(2), color: "bg-accent text-accent-foreground" };
  if (score >= 0.5) return { label: score.toFixed(2), color: "bg-warning text-warning-foreground" };
  return { label: score.toFixed(2), color: "bg-destructive text-destructive-foreground" };
}

export default async function AdminInboxPage() {
  await requireAdmin();
  const supabase = serverSupabase();
  const { data } = await supabase
    .from("events")
    .select(
      "id, title, city, start_at, ai_screen_score, ai_screen_notes, source, created_at, status",
    )
    .eq("status", "pending")
    .order("ai_screen_score", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as Row[];

  return (
    <div className="space-y-4">
      <h1 className="text-foreground text-2xl font-semibold">Inbox</h1>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Поки порожньо. Перевір пізніше.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const badge = scoreBadge(r.ai_screen_score);
            const flags = r.ai_screen_notes?.red_flags ?? [];
            return (
              <li
                key={r.id}
                className="bg-card border-border flex items-center gap-4 rounded-lg border p-3"
              >
                <span
                  className={`inline-flex h-9 w-12 items-center justify-center rounded-md text-xs font-semibold ${badge.color}`}
                >
                  {badge.label}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/event/${r.id}`}
                    className="text-foreground line-clamp-1 font-semibold hover:underline"
                  >
                    {r.title}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {r.city} · {formatEventDateTime(r.start_at)} · {r.source}
                  </p>
                  {flags.length > 0 ? (
                    <p className="text-destructive mt-1 line-clamp-2 text-xs">
                      {flags.slice(0, 3).join(" · ")}
                    </p>
                  ) : null}
                </div>
                <Link
                  href={`/admin/event/${r.id}`}
                  className="text-primary text-sm underline-offset-2 hover:underline"
                >
                  Відкрити →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
