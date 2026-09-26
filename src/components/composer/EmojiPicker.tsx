"use client";

import { useState } from "react";
import { searchEmoji } from "@/lib/ui/emoji";

export function EmojiPicker({
  onPick,
  align = "left",
}: {
  onPick: (name: string) => void;
  align?: "left" | "right";
}) {
  const [query, setQuery] = useState("");
  const results = searchEmoji(query);

  return (
    <div
      className={`card-surface absolute bottom-full z-20 mb-1 flex w-64 flex-col gap-2 rounded-xl p-2 ${
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
      <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
        {results.map((entry) => (
          <button
            key={entry.name}
            type="button"
            title={`:${entry.name}:`}
            onClick={() => onPick(entry.name)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-black/[.04] dark:hover:bg-white/[.05]"
          >
            {entry.glyph}
          </button>
        ))}
        {results.length === 0 && (
          <span className="col-span-8 py-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No matches
          </span>
        )}
      </div>
    </div>
  );
}
