"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { SlackText } from "@/lib/slack/formatSlackText";
import { formatFullDateTime } from "@/lib/slack/messageTime";
import type { SearchOutcome } from "@/server/services/search";

const DEBOUNCE_MS = 400;

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const latestRequest = useRef(0);

  function handleChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      // Clearing the box cancels any in-flight search and empties the results immediately.
      latestRequest.current++;
      setOutcome(null);
      setLoading(false);
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (!q) return;

    const requestId = ++latestRequest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((data: SearchOutcome) => {
          if (requestId !== latestRequest.current) return;
          setOutcome(data);
        })
        .catch(() => {
          if (requestId === latestRequest.current) setOutcome({ results: [], total: 0, error: "failed" });
        })
        .finally(() => {
          if (requestId === latestRequest.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 shadow-sm focus-within:border-accent">
        <Search size={18} className="shrink-0 text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search messages — try in:#channel or from:@name"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
        />
        {loading && <LoaderCircle size={16} className="shrink-0 animate-spin text-subtle" aria-label="Searching" />}
      </label>

      {outcome?.error === "missing_scope" && (
        <div className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-1.5">
            <p>Your Slack connection is missing the search permission.</p>
            <a href="/api/oauth/slack" className="self-start font-semibold underline underline-offset-2">
              Reconnect Slack
            </a>
          </div>
        </div>
      )}
      {outcome?.error === "failed" && <p className="text-sm text-danger">Search didn&apos;t work just now. Try again.</p>}

      {outcome && !outcome.error && !loading && (
        <p className="text-xs text-subtle">
          {outcome.total === 0 ? "No messages match." : `${outcome.total} result${outcome.total === 1 ? "" : "s"}`}
        </p>
      )}

      {!query.trim() && (
        <p className="py-10 text-center text-sm text-subtle">Search everything you can see in Slack, newest first.</p>
      )}

      <ul className="flex flex-col gap-2">
        {outcome?.results.map((r) => {
          const href = r.conversationId
            ? `/app/${r.conversationId}${r.messageId ? `#message-${r.messageId}` : ""}`
            : (r.permalink ?? "#");
          const external = !r.conversationId;
          const card = (
            <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1 truncate font-medium text-muted">
                  {r.conversationLabel}
                  {external && <ExternalLink size={11} className="shrink-0" aria-label="Opens in Slack" />}
                </span>
                <span className="shrink-0 tabular-nums text-subtle">{formatFullDateTime(new Date(r.createdAt))}</span>
              </div>
              <div className="mt-1.5 text-sm text-fg">
                <span className="font-semibold">{r.authorName}</span>
                <div className="line-clamp-4 text-muted">
                  <SlackText text={r.text} userNames={{}} />
                </div>
              </div>
            </>
          );
          const className = "card-surface block rounded-xl px-4 py-3 transition-colors hover:border-line-strong";
          return (
            <li key={r.id}>
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
                  {card}
                </a>
              ) : (
                <Link href={href} className={className}>
                  {card}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
