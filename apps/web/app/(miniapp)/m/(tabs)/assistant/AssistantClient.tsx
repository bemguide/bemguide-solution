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
import { AlertCircle, ArrowUp, Loader2, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { CrisisCard } from "@/components/poruch/CrisisCard";
import { EmptyState } from "@/components/poruch/EmptyState";
import { cn } from "@/lib/utils";
import {
  AgentApiError,
  type AgentCitation,
  type AgentSseEvent,
  type CrisisCardData,
  clearConversationId,
  getAgentBaseUrl,
  readConversationId,
  streamChat,
  streamChatBuffered,
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

const TAP_STYLE = { touchAction: "manipulation" } as const;

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    const meId = me.id;

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

    let convId = readConversationId(meId);
    let attempted404Recovery = false;

    // Reset the in-flight assistant bubble — used when we fall back
    // from streaming to buffered mode and want to start "fresh"
    // (avoids interleaving any partial pre-fallback render).
    const resetAssistantBubble = () => {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId && msg.role === "assistant"
            ? {
                ...msg,
                text: "",
                citations: [],
                pending: true,
                error: undefined,
              }
            : msg,
        ),
      );
    };

    // Centralised event handler — both stream and buffered modes
    // route every parsed `AgentSseEvent` through here so the
    // rendering logic only lives in one place.
    const applyEvent = (evt: AgentSseEvent) => {
      if (evt.event === "conversation") {
        convId = evt.data.conversation_id;
        writeConversationId(meId, evt.data.conversation_id);
        return;
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
        return;
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
        return;
      }
      if (evt.event === "action") {
        if (evt.data.kind === "crisis_handoff") {
          const card = (evt.data as { card: CrisisCardData }).card;
          setCrisis(card);
          setMessages((m) => m.filter((msg) => msg.id !== assistantId));
        }
        return;
      }
      if (evt.event === "done") {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId && msg.role === "assistant"
              ? { ...msg, pending: false }
              : msg,
          ),
        );
        return;
      }
      if (evt.event === "error") {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId && msg.role === "assistant"
              ? {
                  ...msg,
                  pending: false,
                  error: "Щось пішло не так. Спробуй ще раз — і я знову поруч.",
                }
              : msg,
          ),
        );
      }
    };

    const setBubbleError = (errMsg: string) => {
      setMessages((m) =>
        m.map((mm) =>
          mm.id === assistantId && mm.role === "assistant"
            ? { ...mm, pending: false, error: errMsg }
            : mm,
        ),
      );
    };

    // Try streaming first. If no SSE events arrive within 4s, the
    // proxy/WebView is buffering the response — abort and fall back
    // to buffered (await response.text() for the entire body). The
    // buffered path is slower per-turn but works on iOS Telegram
    // where progressive readable streams are unreliable.
    //
    // 4s is short enough that the user barely notices the fallback
    // happen; long enough that a real but slow stream (cold OpenAI
    // call hitting the cache miss path, ~1-3s for first token) isn't
    // killed prematurely.
    type Mode = "stream" | "buffered";
    const MODES: Mode[] = ["stream", "buffered"];

    let success = false;
    let userAborted = false;

    modeLoop: for (let i = 0; i < MODES.length; i++) {
      const mode = MODES[i]!;
      const watchdogMs = mode === "stream" ? 4_000 : 30_000;

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      let watchdogFired = false;
      let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        watchdog = null;
        watchdogFired = true;
        controller.abort();
      }, watchdogMs);
      const clearWatchdog = () => {
        if (watchdog !== null) {
          clearTimeout(watchdog);
          watchdog = null;
        }
      };
      const armWatchdog = () => {
        clearWatchdog();
        watchdog = setTimeout(() => {
          watchdog = null;
          watchdogFired = true;
          controller.abort();
        }, watchdogMs);
      };

      if (mode === "buffered" && i > 0) {
        resetAssistantBubble();
      }

      try {
        const iter =
          mode === "stream"
            ? streamChat({
                userId: meId,
                conversationId: convId,
                userMessage: trimmed,
                signal: controller.signal,
              })
            : streamChatBuffered({
                userId: meId,
                conversationId: convId,
                userMessage: trimmed,
                signal: controller.signal,
              });

        for await (const evt of iter) {
          if (controller.signal.aborted) break;
          // Reset the watchdog on every received event in stream
          // mode — a slow but flowing stream stays alive. In
          // buffered mode the iterator yields the full event list
          // synchronously after the body lands, so resetting is a
          // no-op there.
          if (mode === "stream") armWatchdog();
          applyEvent(evt);
        }
        clearWatchdog();
        if (controller.signal.aborted) {
          if (watchdogFired) {
            // Stream → buffered fallback. Buffered → give up.
            if (mode === "stream") continue modeLoop;
            break modeLoop;
          }
          // External abort (component unmount, new send()).
          userAborted = true;
          break modeLoop;
        }
        success = true;
        break modeLoop;
      } catch (err) {
        clearWatchdog();
        if ((err as { name?: string } | null)?.name === "AbortError") {
          if (watchdogFired) {
            if (mode === "stream") continue modeLoop;
            break modeLoop;
          }
          userAborted = true;
          break modeLoop;
        }
        if (
          err instanceof AgentApiError &&
          err.status === 404 &&
          !attempted404Recovery
        ) {
          // Stale conv_id — server forgot it. Drop and retry the
          // same mode with a fresh conversation.
          attempted404Recovery = true;
          clearConversationId(meId);
          convId = null;
          i--;
          continue modeLoop;
        }
        logApiError(`assistant.${mode}`, err);
        const msg =
          err instanceof AgentApiError && err.status === 0
            ? "Помічник не відповідає. Перевір зʼєднання."
            : "Щось пішло не так. Спробуй ще раз.";
        setBubbleError(msg);
        break modeLoop;
      }
    }

    if (!success && !userAborted) {
      setBubbleError(
        "Помічник не відповідає. Спробуй ще раз — зазвичай це проходить з другого разу.",
      );
    }

    abortRef.current = null;
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
    // Return focus to the composer so keyboard users can resume typing.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function onPickPrompt(text: string) {
    void send(text);
  }

  const composerDisabled = pending || crisis !== null;
  const trimmedDraft = draft.trim();
  const sendDisabled = composerDisabled || trimmedDraft.length === 0;

  return (
    <main className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-6"
      >
        {messages.length === 0 && !crisis ? (
          <Welcome onPick={onPickPrompt} />
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

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        textareaRef={textareaRef}
        disabled={composerDisabled}
        sendDisabled={sendDisabled}
        pending={pending}
        placeholder={
          crisis
            ? "Натисни «Зрозуміло» вище, коли будеш готовий."
            : "Запитай помічника…"
        }
      />
    </main>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 pt-8 pb-2 text-center">
      <div className="bg-primary/10 flex h-14 w-14 items-center justify-center rounded-full">
        <Sparkles className="text-primary h-6 w-6" aria-hidden />
      </div>
      <div className="space-y-2">
        <h1 className="text-foreground text-2xl font-semibold leading-tight tracking-tight">
          Помічник Просвіту
        </h1>
        <p className="text-muted-foreground mx-auto max-w-xs text-sm leading-relaxed">
          Розберуся зі статусом ветерана, пільгами, послугами Дії і куди
          звернутись. Пиши простою мовою — як тобі зручно.
        </p>
      </div>
      <ul className="w-full space-y-2 pt-2 text-left">
        {DRAFT_PROMPTS.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent/30 group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors"
              style={TAP_STYLE}
            >
              <Sparkles
                className="text-primary/60 group-hover:text-primary h-4 w-4 shrink-0 transition-colors"
                aria-hidden
              />
              <span className="leading-snug">{p}</span>
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
      {/* `rounded-xl` (16px) for the bubble; the project's
          `rounded-2xl` resolves to 999px (pill) per globals.css and
          turns long bubbles into ovals. Bottom-right gets a tighter
          radius so the bubble points back at the speaker. */}
      <div className="bg-primary text-primary-foreground max-w-[85%] whitespace-pre-line break-words rounded-xl rounded-br-sm px-4 py-2.5 text-[15px] leading-relaxed shadow-sm">
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

  // Stream failed before any tokens streamed → render the error in
  // place of the bubble. Don't show an empty bubble + floating error
  // pill, that always looks broken.
  if (message.error && !visibleText) {
    return (
      <div className="flex justify-start">
        <div className="bg-destructive/10 text-destructive border-destructive/30 inline-flex max-w-[92%] items-start gap-2 rounded-xl rounded-bl-sm border px-4 py-2.5 text-sm leading-relaxed">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{message.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] space-y-2">
        <div
          className={cn(
            "bg-card text-foreground border-border break-words rounded-xl rounded-bl-sm border px-4 py-3 text-[15px] leading-relaxed shadow-sm",
            // Markdown styling — applied via descendant selectors so
            // we don't need the @tailwindcss/typography plugin.
            // Order matters: more specific rules later override.
            "[&>*]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            "[&_p]:leading-relaxed",
            "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline",
            "[&_strong]:font-semibold [&_em]:italic",
            "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1",
            "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1",
            "[&_li]:my-1 [&_li>p]:my-0",
            "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:font-mono",
            "[&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-[13px]",
            "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
            "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3",
            "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3",
            "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
            "[&_hr]:border-border [&_hr]:my-3",
            // Tap-to-call: any phone-number-styled link in the
            // message body should look like the inline links above
            // — and Streamdown auto-links phone numbers when the
            // model writes them as `[label](tel:...)`.
          )}
        >
          {visibleText ? (
            <Streamdown parseIncompleteMarkdown>
              {visibleText}
            </Streamdown>
          ) : (
            <TypingDots />
          )}
        </div>

        {message.error ? (
          <p className="text-destructive inline-flex items-start gap-1.5 px-1 text-xs">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{message.error}</span>
          </p>
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
    <span
      aria-label="Помічник друкує"
      className="inline-flex items-center gap-1 py-1.5"
    >
      <span className="bg-foreground/40 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
      <span className="bg-foreground/40 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
      <span className="bg-foreground/40 h-1.5 w-1.5 animate-bounce rounded-full" />
    </span>
  );
}

function CitationsRow({ citations }: { citations: AgentCitation[] }) {
  return (
    <div className="space-y-1.5 pl-1">
      <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
        Джерела
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((c) => (
          <li key={c.id}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-accent text-accent-foreground hover:bg-accent/70 inline-flex max-w-[260px] items-baseline gap-1.5 rounded-md px-2 py-1 text-xs leading-snug transition-colors"
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

function Composer({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  textareaRef,
  disabled,
  sendDisabled,
  pending,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  sendDisabled: boolean;
  pending: boolean;
  placeholder: string;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="bg-background border-border/60 shrink-0 border-t px-3 pb-3 pt-2.5"
    >
      <div
        className={cn(
          "bg-card border-border flex items-end gap-1 rounded-2xl border p-1 transition-[border-color,box-shadow]",
          "focus-within:border-primary/40 focus-within:ring-primary/15 focus-within:ring-2",
          disabled && "opacity-70",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="send"
          className={cn(
            "placeholder:text-muted-foreground/80 field-sizing-content max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-snug outline-none",
            "disabled:cursor-not-allowed disabled:placeholder:text-muted-foreground/60",
          )}
        />
        <button
          type="submit"
          disabled={sendDisabled}
          aria-label={pending ? "Помічник відповідає" : "Надіслати"}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:bg-muted disabled:text-muted-foreground/60 disabled:hover:bg-muted",
          )}
          style={TAP_STYLE}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          )}
        </button>
      </div>
    </form>
  );
}
