// Moderation buttons for the admin event page.
// Approve / Reject; Reject opens a small inline reason field.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ModerationActions({ eventId, status }: { eventId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (status !== "pending") {
    return (
      <div className="bg-card border-border rounded-xl border p-4">
        <p className="text-muted-foreground text-sm">Поточний статус: {status}.</p>
      </div>
    );
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/event/${eventId}/approve`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Не вдалось прийняти.");
        return;
      }
      router.push("/admin/inbox");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setError("Потрібна причина.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/event/${eventId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Не вдалось відхилити.");
        return;
      }
      router.push("/admin/inbox");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border-border space-y-3 rounded-xl border p-4">
      <div className="flex flex-col gap-2">
        <Button onClick={approve} disabled={busy} className="h-12 text-base">
          ✅ Approve & Publish
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-destructive border-destructive/30 h-11"
          onClick={() => setShowReject((v) => !v)}
          disabled={busy}
        >
          ❌ Reject
        </Button>
      </div>
      {showReject ? (
        <div className="space-y-2">
          <label className="text-muted-foreground text-xs">Причина (буде надіслана автору)</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="наприклад, занадто загальний опис, бракує контактів"
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
          <Button
            type="button"
            variant="outline"
            className="text-destructive border-destructive/30 h-9"
            onClick={reject}
            disabled={busy || !reason.trim()}
          >
            Відхилити
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
