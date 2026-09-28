"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { ConversationListItem } from "@/app/app/ConversationList";

function score(label: string, query: string): number {
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) return 0;
  if (l.startsWith(q)) return 1;
  if (l.includes(q)) return 2;
  // Loose subsequence match ("gen" → "#general") so a few typed letters still find it.
  let qi = 0;
  for (const ch of l) if (ch === q[qi]) qi++;
  return qi === q.length ? 3 : -1;
}

/** Ctrl/Cmd+K: jump to any conversation by typing part of its name. */
export function QuickSwitcher({ items }: { items: ConversationListItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setIndex(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 8);
    return items
      .map((item) => ({ item, s: score(item.label, q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s)
      .slice(0, 8)
      .map((r) => r.item);
  }, [items, query]);

  function go(item: ConversationListItem) {
    setOpen(false);
    router.push(`/app/${item.id}`);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="card-surface w-full max-w-md rounded-2xl p-2" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Quick switcher">
        <label className="flex items-center gap-2 rounded-xl px-3 py-2">
          <Search size={18} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                go(results[index]);
              }
            }}
            placeholder="Jump to a conversation…"
            className="min-w-0 flex-1 bg-transparent text-black outline-none dark:text-zinc-50"
          />
          <kbd className="hidden rounded border border-black/[.1] px-1.5 text-[10px] text-zinc-500 sm:block dark:border-white/[.15] dark:text-zinc-400">
            Esc
          </kbd>
        </label>
        <ul className="mt-1 flex max-h-72 flex-col overflow-y-auto">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">No matches</li>}
          {results.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(item)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${
                  i === index ? "bg-[color-mix(in_srgb,var(--brand-from)_12%,transparent)]" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.unread && !item.muted && (
                  <span className="btn-primary flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white">
                    {item.unreadCount > 99 ? "99+" : item.unreadCount || ""}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
