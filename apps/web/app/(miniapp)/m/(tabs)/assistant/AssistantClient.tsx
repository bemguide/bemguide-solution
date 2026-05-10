// /m/assistant — chat with the bemguide-chat agent backend.
//
// Architecture:
//   - One conversation_id per (tab session × user_id) — held in
//     sessionStorage, NOT loaded eagerly. We only restore it when
//     the user starts typing again, because the V0 backend may have
//     restarted and 404'd it; the 404 handler clears the stored ID
//     and silently retries with `null`.
//   - Streaming UI: token events grow the in-flight assistant
//     bubble; citations stack underneath. The send button is
//     disabled while a stream is in flight (spec: don't fire
//     concurrent chats — burns budget + confuses the user).
//   - Crisis path replaces 99% of the UI: the composer locks, a
//     full-bleed CrisisCard renders verbatim per spec §8. Tapping
//     "Зрозуміло" returns the user to a clean composer.
//
// `ДЖЕРЕЛА: …` line: the model writes its sources inline at the end
// of every reply (OpenAI lacks a native citations channel). We strip
// it from display and rely on the parallel `citation` events for the
// canonical source list — same data, properly structured.

"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CrisisCard } from "@/components/poruch/CrisisCard";
import { EmptyState } from "@/components/poruch/EmptyState";
import {
  AgentApiError,
  type AgentCitation,
  type CrisisCardData,
  clearConversationId,
  getAgentBaseUrl,
  readConversationId,
  streamChat,
  writeConversationId,
} from "@/lib/agent";
import { getCurrentUser, isNoTelegramEnv, logApiError } from "@/lib/api";
import type { V2User } from "@/lib/api";

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      citations: AgentCitation[];
      pending: boolean;
      error?: string;
    };

const DRAFT_PROMPTS = [
  "Як оформити УБД?",
  "Що дає Дія для ветеранів?",
  "Куди звернутися по психологічну допомогу?",
];

const SOURCES_LINE_RE = /^[ \t]*ДЖЕРЕЛА:.*$/m;

function stripSourcesLine(text: string): string {
  return text.replace(SOURCES_LINE_RE, "").replace(/\n{3,}$/, "\n\n").trimEnd();
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function AssistantClient() {
  const baseUrl = useMemo(() => getAgentBaseUrl(), []);

  const [me, setMe] = useState<V2User | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [crisis, setCrisis] = useState<CrisisCardData | null>(null);
  const [pending, setPending] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Bootstrap: who am I? The agent backend identifies users by their
  // public.users.id UUID (== V2User.id), so we need /me before the
  // user can chat. /me is cached by the auth client; on a warm tab
  // it returns instantly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setMe(user);
      } catch (e) {
        if (cancelled) return;
        logApiError("assistant.bootstrap", e);
        if (isNoTelegramEnv(e)) setBootstrapError("no_telegram_environment");
        else setBootstrapError("Не вдалось завантажити твій профіль.");
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  // Auto-scroll to the latest message as the assistant streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, crisis, pending]);

  if (!baseUrl) {
    // Should be unreachable when the tab is hidden — keep a defensive
    // path in case someone navigates to /m/assistant directly via URL.
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <EmptyState
          title="Помічник вимкнений"
          body="NEXT_PUBLIC_AGENT_BASE_URL не сконфігуровано. Звернись до техкоманди."
        />
      </main>
    );
  }

  if (bootstrapError === "no_telegram_environment") {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <EmptyState
          title="Відкрий у Telegram"
          body="Помічник працює всередині Telegram-додатка — там ми бачимо твій профіль."
        />
      </main>
    );
  }

  if (bootstrapError) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <EmptyState title="Не вдалось завантажити" body={bootstrapError} />
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4">
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
        <div className="bg-muted h-24 w-full animate-pulse rounded-xl" />
        <div className="bg-muted h-24 w-3/4 animate-pulse rounded-xl" />
      </main>
    );
  }

  async function send(text: string) {
    if (!me || pending) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = { id: newId(), role: "user", text: trimmed };
    const assistantId = newId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      citations: [],
      pending: true,
    };

    setMessages((m) => [...m, userMsg, assistantMsg]);
    setDraft("");
    setPending(true);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    // Try with the stored convId; if the V0 server has forgotten it
    // (in-memory store on a fresh process), clear and retry once.
    let convId = readConversationId(me.id);
    let attempted404Recovery = false;

    runStream: while (true) {
      try {
        for await (const evt of streamChat({
          userId: me.id,
          conversationId: convId,
          userMessage: trimmed,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break runStream;

          if (evt.event === "conversation") {
            convId = evt.data.conversation_id;
            writeConversationId(me.id, evt.data.conversation_id);
            continue;
          }
          if (evt.event === "token") {
            const piece = evt.data.text;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId && msg.role === "assistant"
                  ? { ...msg, text: msg.text + piece }
                  : msg,
              ),
            );
            continue;
          }
          if (evt.event === "citation") {
            const citation = evt.data;
            setMessages((m) =>
              m.map((msg) => {
                if (msg.id !== assistantId || msg.role !== "assistant") return msg;
                if (msg.citations.some((c) => c.id === citation.id)) return msg;
                return { ...msg, citations: [...msg.citations, citation] };
              }),
            );
            continue;
          }
          if (evt.event === "action") {
            if (evt.data.kind === "crisis_handoff") {
              const card = (evt.data as { card: CrisisCardData }).card;
              setCrisis(card);
              // Drop the in-flight assistant bubble — the card replaces it.
              setMessages((m) => m.filter((msg) => msg.id !== assistantId));
            }
            // Unknown action kinds are no-ops per spec.
            continue;
          }
          if (evt.event === "done") {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId && msg.role === "assistant"
                  ? { ...msg, pending: false }
                  : msg,
              ),
            );
            continue;
          }
          if (evt.event === "error") {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId && msg.role === "assistant"
                  ? {
                      ...msg,
                      pending: false,
                      error:
                        "Щось пішло не так. Спробуй ще раз — і я знову поруч.",
                    }
                  : msg,
              ),
            );
          }
        }
        break runStream;
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") {
          break runStream;
        }
        if (
          err instanceof AgentApiError &&
          err.status === 404 &&
          !attempted404Recovery
        ) {
          // V0 backend restarted and lost our conversation. Drop the
          // stale id and retry once, silently — the user shouldn't
          // see a 404 just because a process bounced.
          attempted404Recovery = true;
          clearConversationId(me.id);
          convId = null;
          continue runStream;
        }
        logApiError("assistant.stream", err);
        const msg =
          err instanceof AgentApiError && err.status === 0
            ? "Помічник не відповідає. Перевір зʼєднання."
            : "Щось пішло не так. Спробуй ще раз.";
        setMessages((m) =>
          m.map((mm) =>
            mm.id === assistantId && mm.role === "assistant"
              ? { ...mm, pending: false, error: msg }
              : mm,
          ),
        );
        break runStream;
      }
    }

    if (abortRef.current === controller) abortRef.current = null;
    setPending(false);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline. Mobile keyboards differ;
    // the send button stays the canonical action.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  function dismissCrisis() {
    setCrisis(null);
  }

  const composerDisabled = pending || crisis !== null;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4"
      >
        {messages.length === 0 && !crisis ? (
          <Welcome onPick={(t) => void send(t)} />
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <UserBubble key={m.id} text={m.text} />
          ) : (
            <AssistantBubble key={m.id} message={m} />
          ),
        )}

        {crisis ? <CrisisCard card={crisis} onDismiss={dismissCrisis} /> : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="bg-background/95 border-border shrink-0 border-t backdrop-blur"
      >
        <div className="flex items-end gap-2 px-3 py-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              crisis
                ? "Натисни «Зрозуміло» вище, коли будеш готовий."
                : "Запитай помічника…"
            }
            disabled={composerDisabled}
            rows={1}
            className="max-h-32 min-h-[44px] flex-1 resize-none"
          />
          <Button
            type="submit"
            size="lg"
            className="h-11 w-11 shrink-0 px-0"
            disabled={composerDisabled || !draft.trim()}
            aria-label="Надіслати"
          >
            <Send className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </form>
    </main>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-4 py-6 text-center">
      <h1 className="text-foreground text-xl font-semibold">Помічник Поруч</h1>
      <p className="text-muted-foreground mx-auto max-w-sm text-sm leading-relaxed">
        Я допоможу розібратися зі статусом ветерана, пільгами, послугами Дії та
        куди звернутись. Пиши простою мовою — українською або як тобі зручно.
      </p>
      <ul className="mx-auto max-w-sm space-y-2">
        {DRAFT_PROMPTS.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="bg-accent text-accent-foreground hover:bg-accent/80 w-full rounded-xl px-3 py-2 text-left text-sm transition-colors"
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
        {text}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
}: {
  message: Extract<ChatMessage, { role: "assistant" }>;
}) {
  const visibleText = stripSourcesLine(message.text);
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] space-y-2">
        <div className="bg-card text-foreground border-border whitespace-pre-line rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm leading-relaxed">
          {visibleText || (message.pending ? <TypingDots /> : "")}
          {message.pending && visibleText ? (
            <span className="text-muted-foreground"> ▍</span>
          ) : null}
        </div>

        {message.error ? (
          <div className="text-destructive bg-destructive/5 border-destructive/30 rounded-md border px-3 py-2 text-xs">
            {message.error}
          </div>
        ) : null}

        {message.citations.length > 0 ? (
          <CitationsRow citations={message.citations} />
        ) : null}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span aria-label="Помічник друкує" className="inline-flex items-center gap-1">
      <span className="bg-muted-foreground h-1.5 w-1.5 animate-pulse rounded-full" />
      <span
        className="bg-muted-foreground h-1.5 w-1.5 animate-pulse rounded-full"
        style={{ animationDelay: "100ms" }}
      />
      <span
        className="bg-muted-foreground h-1.5 w-1.5 animate-pulse rounded-full"
        style={{ animationDelay: "200ms" }}
      />
    </span>
  );
}

function CitationsRow({ citations }: { citations: AgentCitation[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        Джерела
      </p>
      <ul className="space-y-1">
        {citations.map((c) => (
          <li key={c.id}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-accent text-accent-foreground hover:bg-accent/80 inline-flex max-w-full items-baseline gap-1.5 rounded-md px-2 py-1 text-xs leading-snug"
            >
              <span className="text-muted-foreground shrink-0 text-[10px] uppercase">
                {c.kind}
              </span>
              <span className="line-clamp-2">{c.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
