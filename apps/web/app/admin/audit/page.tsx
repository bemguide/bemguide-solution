// /admin/audit — moderation_log timeline.

import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { serverSupabase } from "@/lib/supabase/server";

type Row = {
  id: number;
  event_id: string;
  action: string;
  notes: string | null;
  created_at: string;
  events: { title: string | null } | null;
};

export default async function AdminAuditPage() {
  await requireAdmin();
  const supabase = serverSupabase();
  const { data } = await supabase
    .from("moderation_log")
    .select("id, event_id, action, notes, created_at, events(title)")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-4">
      <h1 className="text-foreground text-2xl font-semibold">Audit log</h1>
      <ul className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">Поки порожньо.</p>
        ) : (
          rows.map((r) => (
            <li
              key={r.id}
              className="bg-card border-border flex items-start gap-4 rounded-lg border p-3"
            >
              <span className="text-muted-foreground w-32 shrink-0 text-xs">
                {new Date(r.created_at).toLocaleString("uk-UA")}
              </span>
              <span className="bg-secondary text-secondary-foreground inline-flex shrink-0 items-center rounded px-2 text-xs font-semibold">
                {r.action}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/event/${r.event_id}`}
                  className="text-foreground line-clamp-1 font-medium hover:underline"
                >
                  {r.events?.title ?? r.event_id}
                </Link>
                {r.notes ? <p className="text-muted-foreground mt-1 text-sm">{r.notes}</p> : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
