// /m/feed — miniapp home. Thin server shell + a client-side fetch
// against the v2 backend (the bearer token lives in sessionStorage so
// the request has to go through the browser).

import { FeedClient } from "./FeedClient";

export const dynamic = "force-dynamic";

export default function FeedPage() {
  return <FeedClient />;
}
