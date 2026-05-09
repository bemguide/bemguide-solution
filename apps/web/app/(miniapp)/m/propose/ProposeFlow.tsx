// Client-side chat for the NL propose flow.
//
// Flow:
//  1. System bubble asks for the event description.
//  2. User sends text → POST /api/propose/parse → render parsed preview.
//  3. If clarifying_questions exist, show one at a time until none remain or 3 rounds passed.
//  4. Show preview card with [Подаю на модерацію] / [Виправити].
//  5. On confirm → POST /api/propose/submit → success screen.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { fetchWithInitData } from "@/lib/telegram/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACCESSIBILITY_LABELS_UK,
  IDENTITY_LABELS_UK,
  INTEREST_LABELS_UK,
  type AccessibilityFlag,
  type IdentityPref,
  type InterestCategory,
} from "@poruch/shared";

type Parsed = {
  title: string;
  description: string;
  city: string;
  address?: string | null;
  start_at_iso?: string | null;
  duration_min: number;
  categories: InterestCategory[];
  identity_tag: IdentityPref;
  accessibility_flags: AccessibilityFlag[];
  price_uah: number;
};

type ParseResp = {
  ok: boolean;
  result?: {
    parsed: Parsed;
    missing: string[];
    clarifying_questions: string[];
    confidence: number;
  };
  error?: string;
};

type Bubble =
  | { kind: "bot"; text: string }
  | { kind: "user"; text: string }
  | { kind: "preview"; parsed: Parsed }
  | { kind: "question"; text: string };

export function ProposeFlow() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      kind: "bot",
      text: "Опиши коротко, яку подію хочеш провести. Що, де, коли, для кого. Можна одним повідомленням.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([]);
  const [submitted, setSubmitted] = useState<{ slug: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles, parsed, questions, submitted]);

  async function callParse(rawText: string) {
    setBusy(true);
    setError(null);
    try {
      const { status, json } = await fetchWithInitData<ParseResp>("/api/propose/parse", {
        method: "POST",
        body: JSON.stringify({ raw_text: rawText, prior_user_answers: answers }),
      });
      if (status !== 200 || !json?.ok || !json.result) {
        setError(json?.error ?? "Не вдалось розібрати. Спробуй ще раз.");
        return;
      }
      const r = json.result;
      setParsed(r.parsed);
      setQuestions(r.clarifying_questions ?? []);
      // Push a preview-or-question bubble depending on what's left.
      if (r.clarifying_questions.length > 0) {
        setBubbles((b) => [
          ...b,
          { kind: "bot", text: previewText(r.parsed) },
          { kind: "question", text: r.clarifying_questions[0]! },
        ]);
      } else {
        setBubbles((b) => [...b, { kind: "preview", parsed: r.parsed }]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSendInitial() {
    const text = input.trim();
    if (!text) return;
    setBubbles((b) => [...b, { kind: "user", text }]);
    setInput("");
    await callParse(text);
  }

  async function onAnswer(answer: string) {
    if (!parsed || !questions.length) return;
    const q = questions[0]!;
    const newAnswers = [...answers, { question: q, answer }];
    setAnswers(newAnswers);
    setBubbles((b) => [...b, { kind: "user", text: answer }]);
    // Re-parse with the original text + appended answers.
    const concat =
      bubblesUserSeed(bubbles) +
      "\n" +
      newAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n");
    setBusy(true);
    setError(null);
    try {
      const { status, json } = await fetchWithInitData<ParseResp>("/api/propose/parse", {
        method: "POST",
        body: JSON.stringify({ raw_text: concat, prior_user_answers: newAnswers }),
      });
      if (status !== 200 || !json?.ok || !json.result) {
        setError(json?.error ?? "Не вдалось.");
        return;
      }
      setParsed(json.result.parsed);
      const remaining = json.result.clarifying_questions ?? [];
      setQuestions(remaining);
      if (remaining.length > 0 && newAnswers.length < 3) {
        setBubbles((b) => [...b, { kind: "question", text: remaining[0]! }]);
      } else {
        setBubbles((b) => [...b, { kind: "preview", parsed: json.result!.parsed }]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!parsed) return;
    if (!parsed.start_at_iso) {
      setError("Не вистачає дати або часу. Виправ і спробуй ще.");
      return;
    }
    setBusy(true);
    try {
      const { status, json } = await fetchWithInitData<{
        ok: boolean;
        slug?: string;
        error?: string;
      }>("/api/propose/submit", {
        method: "POST",
        body: JSON.stringify({ parsed }),
      });
      if (status !== 200 || !json.ok || !json.slug) {
        setError(json?.error ?? "Не вдалось подати.");
        return;
      }
      setSubmitted({ slug: json.slug });
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-10 text-center">
        <h1 className="text-foreground text-2xl font-semibold">На модерації.</h1>
        <p className="text-muted-foreground">Зазвичай протягом доби. Скажу, як буде готово.</p>
        <Button asChild className="mx-auto h-12">
          <Link href="/m/feed">До стрічки</Link>
        </Button>
      </main>
    );
  }

  const showInputForInitial = !parsed;
  const showInputForAnswer = parsed && questions.length > 0;

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Link
          href="/m/feed"
          aria-label="Назад"
          className="text-muted-foreground hover:bg-muted -ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-foreground text-lg font-semibold">Запропонувати подію</h1>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {bubbles.map((b, i) => (
          <BubbleView key={i} bubble={b} />
        ))}
        {busy ? (
          <div className="bg-muted text-muted-foreground inline-block rounded-2xl px-3 py-2 text-sm">
            <TypingDots />
          </div>
        ) : null}
        {error ? <div className="text-destructive text-sm">{error}</div> : null}
        {parsed && questions.length === 0 ? (
          <div className="space-y-2 pt-2">
            <Button
              type="button"
              size="lg"
              className="h-12 w-full text-base font-semibold"
              onClick={onSubmit}
              disabled={busy}
            >
              ✅ Подаю на модерацію
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 w-full"
              onClick={() => {
                setParsed(null);
                setQuestions([]);
                setBubbles((b) => [
                  ...b,
                  { kind: "bot", text: "Гаразд. Опиши ще раз, що поправити." },
                ]);
              }}
              disabled={busy}
            >
              ✏️ Виправити
            </Button>
          </div>
        ) : null}
      </div>

      {showInputForInitial || showInputForAnswer ? (
        <div className="border-border bg-background sticky bottom-0 flex items-center gap-2 border-t px-3 py-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              showInputForInitial ? "наприклад, шахи в суботу 14 у бібліотеці" : "Твоя відповідь…"
            }
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                e.preventDefault();
                if (showInputForInitial) onSendInitial();
                else onAnswer(input.trim());
                setInput("");
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => {
              if (!input.trim()) return;
              if (showInputForInitial) onSendInitial();
              else {
                onAnswer(input.trim());
                setInput("");
              }
            }}
            disabled={busy || !input.trim()}
            aria-label="Надіслати"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </main>
  );
}

function BubbleView({ bubble }: { bubble: Bubble }) {
  if (bubble.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground max-w-[80%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm">
          {bubble.text}
        </div>
      </div>
    );
  }
  if (bubble.kind === "bot") {
    return (
      <div className="flex justify-start">
        <div className="bg-muted text-foreground max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm">
          {bubble.text}
        </div>
      </div>
    );
  }
  if (bubble.kind === "question") {
    return (
      <div className="bg-accent text-accent-foreground rounded-xl border px-3 py-2 text-sm">
        {bubble.text}
      </div>
    );
  }
  // preview
  return <PreviewCard parsed={bubble.parsed} />;
}

function PreviewCard({ parsed }: { parsed: Parsed }) {
  const date = parsed.start_at_iso
    ? new Date(parsed.start_at_iso).toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "не вказано";
  return (
    <div className="bg-card border-border space-y-3 rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">Як я зрозумів:</p>
      <h3 className="text-foreground font-semibold">{parsed.title}</h3>
      <ul className="text-foreground space-y-1 text-sm">
        <li>
          📍 {parsed.city}
          {parsed.address ? `, ${parsed.address}` : ""}
        </li>
        <li>🗓 {date}</li>
        {parsed.identity_tag !== "any" ? (
          <li>👥 {IDENTITY_LABELS_UK[parsed.identity_tag]}</li>
        ) : null}
        <li>💰 {parsed.price_uah > 0 ? `${parsed.price_uah} ₴` : "Безкоштовно"}</li>
      </ul>
      {parsed.categories.length ? (
        <p className="text-muted-foreground text-xs">
          Категорії: {parsed.categories.map((c) => INTEREST_LABELS_UK[c]).join(", ")}
        </p>
      ) : null}
      {parsed.accessibility_flags.length ? (
        <p className="text-muted-foreground text-xs">
          Доступність:{" "}
          {parsed.accessibility_flags.map((f) => ACCESSIBILITY_LABELS_UK[f]).join(", ")}
        </p>
      ) : null}
      <p className="text-foreground whitespace-pre-line text-sm">{parsed.description}</p>
    </div>
  );
}

function previewText(p: Parsed): string {
  const date = p.start_at_iso
    ? new Date(p.start_at_iso).toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "не вказано";
  return [
    "Як я зрозумів:",
    `• ${p.title}`,
    `• ${p.city}${p.address ? ", " + p.address : ""}`,
    `• ${date}`,
    `• ${p.price_uah > 0 ? p.price_uah + " ₴" : "Безкоштовно"}`,
    "",
    "Кілька уточнень:",
  ].join("\n");
}

function bubblesUserSeed(bubbles: Bubble[]): string {
  // The original user description = the first user bubble.
  const u = bubbles.find((b) => b.kind === "user");
  return u && u.kind === "user" ? u.text : "";
}

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}
