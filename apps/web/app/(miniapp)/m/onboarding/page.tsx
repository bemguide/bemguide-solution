// /m/onboarding — 3-question onboarding inside the Mini App.
// Skip-able. Deep-link aware (start_param=evt_<slug> bypasses onboarding).

import { OnboardingFlow } from "./OnboardingFlow";

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
