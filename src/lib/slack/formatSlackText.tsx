import type { ReactNode } from "react";

type Segment =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; label?: string }
  | { type: "channel"; id: string; label?: string }
  | { type: "broadcast"; value: string }
  | { type: "link"; url: string; label: string };

const TOKEN_RE = /<([^>]+)>/g;

function unescapeSlackText(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function parseSlackText(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: unescapeSlackText(text.slice(lastIndex, match.index)) });
    }

    const inner = match[1];
    const pipeIndex = inner.indexOf("|");
    const head = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
    const label = pipeIndex === -1 ? undefined : inner.slice(pipeIndex + 1);

    if (head.startsWith("@")) {
      segments.push({ type: "mention", id: head.slice(1), label });
    } else if (head.startsWith("#")) {
      segments.push({ type: "channel", id: head.slice(1), label });
    } else if (head.startsWith("!")) {
      segments.push({ type: "broadcast", value: head.slice(1) });
    } else if (/^https?:\/\//.test(head)) {
      segments.push({ type: "link", url: head, label: label ?? head });
    } else {
      segments.push({ type: "text", value: unescapeSlackText(match[0]) });
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: unescapeSlackText(text.slice(lastIndex)) });
  }

  return segments;
}

/** Renders Slack's mrkdwn text (mentions, channel refs, links, @here/@channel) as React nodes. */
export function SlackText({ text, userNames }: { text: string; userNames: Record<string, string> }): ReactNode {
  const segments = parseSlackText(text);

  return (
    <>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case "text":
            return seg.value;
          case "mention":
            return (
              <span
                key={i}
                className="rounded bg-blue-500/10 px-1 font-medium text-blue-600 dark:text-blue-400"
              >
                @{userNames[seg.id] ?? seg.label ?? seg.id}
              </span>
            );
          case "channel":
            return (
              <span key={i} className="font-medium text-blue-600 dark:text-blue-400">
                #{seg.label ?? seg.id}
              </span>
            );
          case "broadcast":
            return (
              <span
                key={i}
                className="rounded bg-amber-500/10 px-1 font-medium text-amber-600 dark:text-amber-400"
              >
                @{seg.value}
              </span>
            );
          case "link":
            return (
              <a
                key={i}
                href={seg.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline dark:text-blue-400"
              >
                {seg.label}
              </a>
            );
        }
      })}
    </>
  );
}
