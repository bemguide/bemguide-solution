// /m/place/[id] — detail page for an `opportunity_health` row.
// Mirrors the `/m/event/[id]` shape: thin server shell, all data
// fetching happens client-side because we read the bearer from
// sessionStorage.

import { PlaceDetailClient } from "./PlaceDetailClient";

export const dynamic = "force-dynamic";

export default async function PlacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlaceDetailClient id={id} />;
}
