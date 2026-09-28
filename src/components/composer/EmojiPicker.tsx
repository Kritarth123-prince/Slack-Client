"use client";

import { useState } from "react";
import { searchEmoji, type EmojiEntry } from "@/lib/ui/emoji";
import { EmojiGlyph } from "@/lib/ui/EmojiGlyph";
import { useCustomEmoji } from "@/lib/ui/customEmoji";

export function EmojiPicker({
  onPick,
  align = "left",
}: {
  onPick: (entry: EmojiEntry) => void;
  align?: "left" | "right";
}) {
  const [query, setQuery] = useState("");
  const custom = useCustomEmoji();
  const q = query.trim().toLowerCase();
  // Custom workspace emoji sit in front of the standard set so they're easy to spot; when searching,
  // they match on name like everything else.
  const customResults: EmojiEntry[] = Object.entries(custom)
    .filter(([name]) => !q || name.includes(q))
    .slice(0, q ? 24 : 48)
    .map(([name, url]) => ({ name, glyph: "", keywords: [], url }));
  const results = [...customResults, ...searchEmoji(query)];

  return (
    <div
      className={`card-surface absolute bottom-full z-20 mb-1 flex w-64 max-w-[85vw] flex-col gap-2 rounded-xl p-2 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji…"
        className="rounded-lg border border-black/[.08] bg-transparent px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] dark:border-white/[.145]"
      />
      <div className="grid max-h-64 grid-cols-6 gap-0.5 overflow-y-auto sm:grid-cols-8">
        {results.map((entry) => (
          <button
            key={entry.name}
            type="button"
            title={`:${entry.name}:`}
            onClick={() => onPick(entry)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-black/[.04] dark:hover:bg-white/[.05]"
          >
            {entry.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- Slack-hosted custom emoji image
              <img src={entry.url} alt={`:${entry.name}:`} className="h-5 w-5 object-contain" draggable={false} />
            ) : (
              <EmojiGlyph glyph={entry.glyph} />
            )}
          </button>
        ))}
        {results.length === 0 && (
          <span className="col-span-6 py-2 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:col-span-8">
            No matches
          </span>
        )}
      </div>
    </div>
  );
}
