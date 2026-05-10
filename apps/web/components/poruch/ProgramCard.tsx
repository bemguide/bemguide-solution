// One state-program card surfaced via `GET /feed?filter=programs`.
//
// The contract guarantees:
//   - `title`, `short_description`, `source_url` are non-null
//   - `target_veteran_status` is non-empty
//   - eligibility is already filtered server-side, so any item we
//     receive is "available to this user"
//
// Card actions per spec v2 §6.4 (subset that programs can support):
//   1. Apply / open source — primary CTA (the source_url link)
//   2. Route / open in Maps — only when address or coords are present
//   3. Save to bookmarks  — local-only V0 store; toggle state
//   4. Share — navigator.share with link, clipboard fallback
//   "Call / message" is omitted: program rows don't carry a phone
//   field. The hotlines block under the programs feed surfaces
//   tap-to-call separately.
//
// Status chips: render only the values present in
// `target_veteran_status`. Three chips = "available to everyone";
// one chip = strict eligibility. We deliberately don't add a
// `+ N more` for unknown statuses because the backend column is the
// full enum (forward-compat) but only three values are used today.

"use client";

import { useEffect, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  MapPin,
  Navigation,
  Share2,
  Sparkles,
} from "lucide-react";
import type { ProgramFeedItem, VeteranStatus } from "@/lib/api";
import { isBookmarked, toggleBookmark } from "@/lib/bookmarks";
import { prettyUrlHost } from "@/lib/url";
import { cn } from "@/lib/utils";

const STATUS_CHIP: Partial<Record<VeteranStatus, string>> = {
  ubd: "УБД",
  in_process: "В процесі",
  no_docs: "Без статусу",
};

const TOAST_MS = 2_000;

export function ProgramCard({ program }: { program: ProgramFeedItem }) {
  const linkLabel =
    program.source_label?.trim() || prettyUrlHost(program.source_url);
  const statuses = program.target_veteran_status
    .map((s) => STATUS_CHIP[s])
    .filter((s): s is string => Boolean(s));

  // 3-chip case = available to every veteran the contract serves
  // today. Render a single shorter chip instead of three repeating
  // small labels — easier to scan, less visual noise.
  const everyone = statuses.length === Object.keys(STATUS_CHIP).length;

  const hasGeo =
    Boolean(program.address) ||
    (program.location_lat !== null && program.location_lng !== null);

  return (
    <article className="bg-card border-border space-y-3 rounded-xl border p-4">
      <header className="space-y-1.5">
        <h3 className="text-foreground text-base font-semibold leading-snug">
          {program.title}
        </h3>
        <p className="text-foreground text-sm leading-relaxed">
          {program.short_description}
        </p>
      </header>

      {statuses.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {everyone ? (
            <Chip>
              <Sparkles className="h-3 w-3" aria-hidden />
              Доступно всім
            </Chip>
          ) : (
            statuses.map((label) => <Chip key={label}>{label}</Chip>)
          )}
        </div>
      ) : null}

      {program.how_to_apply ? (
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            Як отримати
          </p>
          <p className="text-foreground whitespace-pre-line text-sm leading-relaxed">
            {program.how_to_apply}
          </p>
        </div>
      ) : null}

      {program.address ? (
        <p className="text-muted-foreground inline-flex items-start gap-1.5 text-xs">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {program.address}
            {program.city ? `, ${program.city}` : null}
          </span>
        </p>
      ) : null}

      <a
        href={program.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
        style={{ touchAction: "manipulation" }}
      >
        {linkLabel}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>

      <ActionRow program={program} hasGeo={hasGeo} />
    </article>
  );
}

function ActionRow({
  program,
  hasGeo,
}: {
  program: ProgramFeedItem;
  hasGeo: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Sync local state with the persisted set on mount. Doing this in
  // `useEffect` (post-hydration) avoids the SSR/client split that
  // reading localStorage at render-time would cause.
  useEffect(() => {
    setSaved(isBookmarked("program", program.id));
  }, [program.id]);

  function flashToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), TOAST_MS);
  }

  function onSave() {
    const next = toggleBookmark("program", program.id);
    setSaved(next);
    flashToast(next ? "Збережено в обране" : "Прибрано з обраного");
  }

  async function onShare() {
    const shareData = {
      title: program.title,
      text: program.short_description,
      url: program.source_url,
    };
    // Native share when available — works in Telegram WebView on
    // mobile and falls back to the platform's share-sheet.
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* user cancelled, or unsupported scheme — fall through */
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(program.source_url);
        flashToast("Посилання скопійовано");
        return;
      } catch {
        /* clipboard refused — final fallback */
      }
    }
    window.open(program.source_url, "_blank", "noopener,noreferrer");
  }

  function buildMapsUrl(): string {
    const { location_lat: lat, location_lng: lng, address, city } = program;
    if (lat !== null && lng !== null) {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    const q = encodeURIComponent(
      [address, city].filter(Boolean).join(", "),
    );
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  return (
    <div className="border-border/60 flex items-center gap-1 border-t pt-3">
      {hasGeo ? (
        <ActionButton
          as="a"
          href={buildMapsUrl()}
          target="_blank"
          rel="noopener noreferrer"
          icon={<Navigation className="h-3.5 w-3.5" aria-hidden />}
          label="Маршрут"
        />
      ) : null}
      <ActionButton
        as="button"
        onClick={onSave}
        icon={
          saved ? (
            <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
          )
        }
        label={saved ? "В обраному" : "Зберегти"}
        active={saved}
        ariaPressed={saved}
      />
      <ActionButton
        as="button"
        onClick={() => void onShare()}
        icon={<Share2 className="h-3.5 w-3.5" aria-hidden />}
        label="Поділитися"
      />
      {toast ? (
        <span
          role="status"
          className="text-muted-foreground ml-auto text-xs"
        >
          {toast}
        </span>
      ) : null}
    </div>
  );
}

type ActionButtonCommon = {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  ariaPressed?: boolean;
};

type ActionButtonProps =
  | (ActionButtonCommon & {
      as: "a";
      href: string;
      target?: string;
      rel?: string;
      onClick?: never;
    })
  | (ActionButtonCommon & {
      as: "button";
      onClick: () => void;
      href?: never;
    });

function ActionButton(props: ActionButtonProps) {
  const className = cn(
    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
    "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    props.active && "bg-accent text-accent-foreground hover:bg-accent",
  );
  const style = { touchAction: "manipulation" } as const;
  if (props.as === "a") {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        className={className}
        style={style}
      >
        {props.icon}
        {props.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.ariaPressed}
      className={className}
      style={style}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-accent text-accent-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}
