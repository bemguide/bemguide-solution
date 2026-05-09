// /m/feed — miniapp home. Thin server shell + client-side fetch of /api/feed
// (initData lives in window.Telegram.WebApp, so the data fetch must happen client-side).

import { FeedClient } from "./FeedClient";

export const dynamic = "force-dynamic";

export default function FeedPage() {
  return <FeedClient />;
}
