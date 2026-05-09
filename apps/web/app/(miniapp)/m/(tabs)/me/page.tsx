// /m/me — profile tab. Thin server shell + client-rendered body
// because the bearer token + cached user live in the browser.

import { MeClient } from "./MeClient";

export const dynamic = "force-dynamic";

export default function MePage() {
  return <MeClient />;
}
