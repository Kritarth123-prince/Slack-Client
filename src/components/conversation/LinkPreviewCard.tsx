"use client";

import { useEffect, useState } from "react";
import type { LinkPreviewView } from "@/server/services/linkPreview";

// Shared across every bubble on the page (and across the feed/thread panel) so the same link
// isn't re-fetched on each 4s poll re-render or when the thread panel mounts it a second time.
const previewCache = new Map<string, Promise<LinkPreviewView | null>>();

function loadPreview(url: string): Promise<LinkPreviewView | null> {
  let pending = previewCache.get(url);
  if (!pending) {
    pending = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : { preview: null }))
      .then((data: { preview: LinkPreviewView | null }) => data.preview)
      .catch(() => null);
    previewCache.set(url, pending);
  }
  return pending;
}

export function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewView | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPreview(url).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview || (!preview.title && !preview.description)) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex max-w-xs overflow-hidden rounded-xl border border-black/[.08] bg-white/60 text-left text-sm shadow-sm hover:bg-white dark:border-white/[.145] dark:bg-black/20 dark:hover:bg-black/40"
    >
      {preview.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party Open Graph image
        <img src={preview.imageUrl} alt="" className="h-auto w-20 shrink-0 object-cover" loading="lazy" />
      )}
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
        {preview.siteName && (
          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {preview.siteName}
          </span>
        )}
        {preview.title && <span className="line-clamp-2 font-medium text-zinc-800 dark:text-zinc-100">{preview.title}</span>}
        {preview.description && (
          <span className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{preview.description}</span>
        )}
      </span>
    </a>
  );
}
