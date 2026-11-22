"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { searchEmoji, type EmojiEntry } from "@/lib/ui/emoji";
import { EmojiGlyph } from "@/lib/ui/EmojiGlyph";
import { useCustomEmoji } from "@/lib/ui/customEmoji";

// Below sm the picker is a bottom sheet, like the message actions — a 288px popover anchored to a
// button near the screen edge doesn't fit on a phone.
const PHONE_SHEET =
  "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:z-50 max-sm:m-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:p-2 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:max-h-[85dvh] max-sm:overflow-y-auto";

export function EmojiPicker({
  onPick,
  align = "left",
  placement = "above",
}: {
  onPick: (entry: EmojiEntry) => void;
  align?: "left" | "right";
  placement?: "above" | "below";
}) {
  const [query, setQuery] = useState("");
  // On touch screens, focusing the search box would throw the keyboard up over the grid.
  const [focusSearch] = useState(() => !window.matchMedia("(pointer: coarse)").matches);
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
      className={`popover-surface absolute z-40 flex w-72 max-w-[85vw] flex-col gap-2 rounded-xl p-2 ${
        placement === "above" ? "bottom-full mb-1.5" : "top-full mt-1.5"
      } ${align === "right" ? "right-0" : "left-0"} ${PHONE_SHEET}`}
    >
      <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 focus-within:border-accent">
        <Search size={14} className="shrink-0 text-subtle" />
        <input
          autoFocus={focusSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
        />
      </label>
      <div className="grid max-h-64 grid-cols-8 gap-0.5 overflow-y-auto max-sm:max-h-[40vh] max-sm:justify-items-center">
        {results.map((entry) => (
          <button
            key={entry.name}
            type="button"
            title={`:${entry.name}:`}
            onClick={() => onPick(entry)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-xl hover:bg-surface-2"
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
          <span className="col-span-8 py-4 text-center text-xs text-subtle">No emoji match</span>
        )}
      </div>
    </div>
  );
}
