// /m/assistant — chat with the bemguide-chat agent backend.
//
// Force-dynamic because the page mounts AssistantClient which needs the
// browser session token to fetch /me before it can attach `?user_id=` to
// agent requests. Same posture as feed/me — no SSR savings, no SEO needs.

import { AssistantClient } from "./AssistantClient";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return <AssistantClient />;
}
