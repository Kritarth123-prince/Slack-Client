"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { SlackText } from "@/lib/slack/formatSlackText";
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
      <label className="card-surface flex items-center gap-2 rounded-full px-4 py-2">
        <Search size={18} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search messages… (supports Slack syntax like in:#channel, from:@name)"
          className="min-w-0 flex-1 bg-transparent text-black outline-none dark:text-zinc-50"
        />
      </label>

      {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Searching…</p>}

      {outcome?.error === "missing_scope" && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <p>⚠️ Your Slack connection is missing the search permission.</p>
          <a href="/api/oauth/slack" className="self-start rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold hover:bg-amber-500/30">
            Reconnect Slack
          </a>
        </div>
      )}
      {outcome?.error === "failed" && <p className="text-sm text-red-500">Search didn&apos;t work just now. Try again.</p>}

      {outcome && !outcome.error && !loading && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {outcome.total === 0 ? "No messages match." : `${outcome.total} result${outcome.total === 1 ? "" : "s"}`}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {outcome?.results.map((r) => {
          const href = r.conversationId
            ? `/app/${r.conversationId}${r.messageId ? `#message-${r.messageId}` : ""}`
            : (r.permalink ?? "#");
          const external = !r.conversationId;
          const card = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-zinc-500 dark:text-zinc-400">{r.conversationLabel}</span>
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  {new Date(r.createdAt).toLocaleString("en-GB", { hour12: false })}
                </span>
              </div>
              <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{r.authorName}:</span>
                <SlackText text={r.text} userNames={{}} />
              </div>
            </>
          );
          const className = "card-surface block rounded-2xl px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-lg";
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
