// /admin/analytics — KPI tiles + recent-events table.

import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { serverSupabase } from "@/lib/supabase/server";
import { formatEventDateTime } from "@/lib/format";

export default async function AdminAnalyticsPage() {
  await requireAdmin();
  const supabase = serverSupabase();
  const now = Date.now();
  const since30d = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  const [
    { count: activeVeterans },
    { count: publishedEvents },
    { count: pendingEvents },
    { count: rsvps7d },
  ] = await Promise.all([
    supabase
      .from("veterans")
      .select("*", { head: true, count: "exact" })
      .gte("last_active_at", since30d),
    supabase.from("events").select("*", { head: true, count: "exact" }).eq("status", "approved"),
    supabase.from("events").select("*", { head: true, count: "exact" }).eq("status", "pending"),
    supabase
      .from("rsvps")
      .select("*", { head: true, count: "exact" })
      .gte("created_at", since7d)
      .eq("is_ghost", false),
  ]);

  const { data: cityRows } = await supabase.from("events").select("city").eq("status", "approved");
  const byCity = new Map<string, number>();
  for (const r of (cityRows ?? []) as { city: string }[]) {
    byCity.set(r.city, (byCity.get(r.city) ?? 0) + 1);
  }
  const topCities = [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const { data: recent } = await supabase
    .from("events")
    .select("id, title, city, start_at, status")
    .order("created_at", { ascending: false })
    .limit(8);
  type Recent = { id: string; title: string; city: string; start_at: string; status: string };

  return (
    <div className="space-y-6">
      <h1 className="text-foreground text-2xl font-semibold">Analytics</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Активні ветерани (30d)" value={activeVeterans ?? 0} />
        <Tile label="Опубліковано подій" value={publishedEvents ?? 0} />
        <Tile label="На модерації" value={pendingEvents ?? 0} />
        <Tile label="RSVP за тиждень" value={rsvps7d ?? 0} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="bg-card border-border rounded-xl border p-4">
          <h2 className="text-foreground mb-3 text-lg font-semibold">Топ міст</h2>
          <ul className="space-y-1 text-sm">
            {topCities.map(([city, n]) => (
              <li key={city} className="flex justify-between">
                <span className="text-foreground">{city}</span>
                <span className="text-muted-foreground">{n}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="bg-card border-border rounded-xl border p-4">
          <h2 className="text-foreground mb-3 text-lg font-semibold">Останні події</h2>
          <ul className="space-y-1 text-sm">
            {((recent ?? []) as Recent[]).map((r) => (
              <li key={r.id} className="flex flex-col">
                <Link
                  href={`/admin/event/${r.id}`}
                  className="text-foreground line-clamp-1 hover:underline"
                >
                  {r.title}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {r.city} · {formatEventDateTime(r.start_at)} · {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border-border rounded-xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}
