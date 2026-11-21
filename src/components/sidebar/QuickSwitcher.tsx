"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { ConversationListItem } from "@/app/app/ConversationList";
import { ConversationGlyph } from "@/components/conversation/ConversationGlyph";

const OPEN_EVENT = "quick-switcher:open";

/** Opens the switcher from anywhere (e.g. the sidebar's "Jump to…" row), same as Ctrl/Cmd+K. */
export function openQuickSwitcher() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function score(label: string, query: string): number {
  const l = label.toLowerCase().replace(/^#/, "");
  const q = query.toLowerCase().replace(/^#/, "");
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
    function show() {
      setOpen(true);
      setQuery("");
      setIndex(0);
    }
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
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        className="popover-surface w-full max-w-lg overflow-hidden rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Jump to a conversation"
      >
        <label className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={17} className="shrink-0 text-subtle" />
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
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
          />
          <kbd className="hidden rounded border border-line px-1.5 font-sans text-[10px] text-subtle sm:block">Esc</kbd>
        </label>
        <ul className="flex max-h-80 flex-col overflow-y-auto p-1.5" role="listbox">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-subtle">No conversations match</li>}
          {results.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(item)}
                className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm ${
                  i === index ? "bg-accent-soft text-accent-text" : "text-fg"
                }`}
              >
                <ConversationGlyph type={item.type} label={item.label} avatarUrl={item.avatarUrl} seed={item.id} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.unread && !item.muted && item.unreadCount > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                    {item.unreadCount > 99 ? "99+" : item.unreadCount}
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
