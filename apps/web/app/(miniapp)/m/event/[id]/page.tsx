// /m/event/[id] — miniapp event page. Client-rendered: needs the bearer
// token from sessionStorage to fetch the personalised match_score.

import { ClientEventPage } from "./ClientEventPage";

export const dynamic = "force-dynamic";

export default async function MiniappEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientEventPage id={id} />;
}
