// Wire types for the bemguide-chat agent backend (V0 — `?user_id=` auth,
// see `docs/AGENT_INTEGRATION.md` reference). The SSE stream multiplexes
// five named event kinds; the discriminated union keeps the UI honest
// about which payload it's looking at.

export type AgentCitationKind = "law" | "decree" | "service" | "ngo" | "hotline" | (string & {});

export type AgentCitation = {
  id: string;
  title: string;
  url: string;
  kind: AgentCitationKind;
  /**
   * `"current"` for V0 generic chunks. Real RAG corpus will replace this
   * with ISO dates — when that lands, render "за станом на …" near old
   * citations.
   */
  effective_date: string;
};

export type CrisisCardData = {
  title: string;
  body_uk: string;
  hotlines: { label: string; phone: string; note: string }[];
  next_step_hint: string;
};

/**
 * V0 only ships `crisis_handoff`. Future kinds (`suggest_event`,
 * `open_diia`, etc.) get matched by name; unknown `kind` is silently
 * ignored per the integration guide's "treat as no-op" guidance.
 */
export type AgentAction =
  | { kind: "crisis_handoff"; card: CrisisCardData }
  | { kind: string; [k: string]: unknown };

export type AgentDoneData = {
  /** "stop" (normal), "length" (max_tokens hit, rare), or "crisis_handoff". */
  finish_reason: "stop" | "length" | "crisis_handoff" | (string & {});
  /** Empty `{}` on the crisis path. */
  usage?: Partial<{
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cached_input_tokens: number;
  }>;
};

export type AgentErrorData = {
  /** Machine code (e.g. `upstream_timeout`, `unsafe_input`). */
  error: string;
  /** Debug info — DO NOT show to users verbatim per the integration guide. */
  message: string;
};

/**
 * One event the agent referenced via a tool call (list_upcoming_events,
 * list_my_events, get_event_details). Render as a tappable card under
 * the assistant message, linking to `/m/event/<id>`. The backend emits
 * one `event_refs` SSE frame per tool call; the UI dedupes by id.
 *
 * Field shape is a deliberate subset of the full OpportunityCard that
 * `/m/event/[id]` loads — just enough to render a compact row without
 * needing a second round-trip.
 */
export type AgentEventRef = {
  id: string;
  title: string;
  short_description: string | null;
  /** ISO 8601, or null for recurring services without a fixed time. */
  start_at: string | null;
  city: string | null;
  address: string | null;
  photo_url: string | null;
};

export type AgentEventRefsData = { events: AgentEventRef[] };

export type AgentSseEvent =
  | { event: "conversation"; data: { conversation_id: string } }
  | { event: "token"; data: { text: string } }
  | { event: "citation"; data: AgentCitation }
  | { event: "action"; data: AgentAction }
  | { event: "event_refs"; data: AgentEventRefsData }
  | { event: "done"; data: AgentDoneData }
  | { event: "error"; data: AgentErrorData };

// ----------------------------------------------------------------
// Non-streaming endpoints (memory + conversations)
// ----------------------------------------------------------------

export type AgentFact = {
  id: string;
  /** Free-form label; spec recommends `service_branch`, `dependents`,
   *  `applied_for`, `pending_status`. */
  kind: string;
  value: string;
  source: "user_said" | (string & {});
  /** Unix epoch seconds. */
  added_at: number;
};

export type AgentConversationSummary = {
  id: string;
  /** Unix epoch seconds. */
  created_at: number;
  /** Unix epoch seconds. */
  updated_at: number;
  message_count: number;
};

export type AgentTranscript = {
  id: string;
  created_at: number;
  updated_at: number;
  messages: { role: "user" | "assistant"; content: string }[];
};
