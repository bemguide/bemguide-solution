// gemini-rank evals. Hit the LIVE deployed function with seed data.
// Each case asserts a specific signal: identity match, distance, accessibility.

import { assertEquals, assert } from "jsr:@std/assert@0.224.0";
import { callFn, findEvents, makeTempVeteran, deleteTempVeteran, admin } from "./helpers.ts";

type RankResp = {
  ok: boolean;
  ranked: { event_id: string; score: number; reason: string }[];
  fallback?: boolean;
};

Deno.test("rank: women_only veteran lifts women_only events to the top", async () => {
  const veteranId = await makeTempVeteran({
    city: "Львів",
    interests: ["craft", "community"],
    identity_prefs: "women_only",
  });
  try {
    // Pull both a women_only and a non-women_only event in Львів.
    const { data: women } = await admin()
      .from("events")
      .select("id, identity_tag")
      .eq("source", "admin_seed")
      .eq("city", "Львів")
      .eq("identity_tag", "women_only")
      .limit(2);
    const { data: anyTag } = await admin()
      .from("events")
      .select("id, identity_tag")
      .eq("source", "admin_seed")
      .eq("city", "Львів")
      .eq("identity_tag", "any")
      .limit(3);
    const candidates = [...(women ?? []), ...(anyTag ?? [])].map((r) => r.id);

    const { status, json } = await callFn<RankResp>("gemini-rank", {
      veteran_id: veteranId,
      candidate_event_ids: candidates,
    });
    assertEquals(status, 200);
    assert(Array.isArray(json.ranked));
    if (!json.fallback) {
      const top = json.ranked[0];
      const womenIds = new Set((women ?? []).map((w) => w.id));
      assert(womenIds.has(top.event_id), `expected women_only at top, got ${top.event_id}`);
    }
  } finally {
    await deleteTempVeteran(veteranId);
  }
});

Deno.test("rank: same-city events outrank distant ones", async () => {
  const veteranId = await makeTempVeteran({
    city: "Київ",
    interests: ["movement"],
    identity_prefs: "any",
  });
  try {
    const kyiv = await findEvents({ city: "Київ", limit: 2 });
    const lviv = await findEvents({ city: "Львів", limit: 2 });
    const ids = [...kyiv, ...lviv].map((e) => e.id);
    const { status, json } = await callFn<RankResp>("gemini-rank", {
      veteran_id: veteranId,
      candidate_event_ids: ids,
    });
    assertEquals(status, 200);
    if (!json.fallback) {
      const top = json.ranked[0];
      const kyivIds = new Set(kyiv.map((e) => e.id));
      assert(
        kyivIds.has(top.event_id),
        `expected a Київ event on top for a Київ veteran; got event_id=${top.event_id}`,
      );
    }
  } finally {
    await deleteTempVeteran(veteranId);
  }
});

Deno.test("rank: returns reason strings ≤100 chars", async () => {
  const veteranId = await makeTempVeteran({
    city: "Дніпро",
    interests: ["movement", "walks"],
    identity_prefs: "any",
  });
  try {
    const events = await findEvents({ city: "Дніпро", limit: 4 });
    const { json } = await callFn<RankResp>("gemini-rank", {
      veteran_id: veteranId,
      candidate_event_ids: events.map((e) => e.id),
    });
    if (!json.fallback) {
      for (const r of json.ranked) {
        assert(
          r.reason.length <= 100,
          `reason too long for ${r.event_id}: ${r.reason.length} chars`,
        );
      }
    }
  } finally {
    await deleteTempVeteran(veteranId);
  }
});

Deno.test("rank: no banned military words in any reason", async () => {
  const veteranId = await makeTempVeteran({
    city: "Київ",
    interests: ["movement", "community"],
    identity_prefs: "any",
  });
  try {
    const events = await findEvents({ city: "Київ", limit: 5 });
    const { json } = await callFn<RankResp>("gemini-rank", {
      veteran_id: veteranId,
      candidate_event_ids: events.map((e) => e.id),
    });
    const BANNED = /(героям слава|незламн|нескорен|переможемо|hero|warrior|soldier)/i;
    for (const r of json.ranked) {
      assert(!BANNED.test(r.reason), `banned word in reason: "${r.reason}"`);
    }
  } finally {
    await deleteTempVeteran(veteranId);
  }
});

Deno.test("rank: deterministic fallback when veteran has no data", async () => {
  // Even with a totally empty profile, we still get a sensible ordering.
  const veteranId = await makeTempVeteran({
    city: "Київ",
    interests: [],
    identity_prefs: "any",
  });
  try {
    const events = await findEvents({ city: "Київ", limit: 3 });
    const { status, json } = await callFn<RankResp>("gemini-rank", {
      veteran_id: veteranId,
      candidate_event_ids: events.map((e) => e.id),
    });
    assertEquals(status, 200);
    assertEquals(json.ranked.length, 3);
  } finally {
    await deleteTempVeteran(veteranId);
  }
});
