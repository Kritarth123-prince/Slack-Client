import type { ReactNode } from "react";

type Token =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; label?: string }
  | { type: "channel"; id: string; label?: string }
  | { type: "broadcast"; value: string }
  | { type: "link"; url: string; label: string }
  | { type: "codeblock"; value: string };

type InlineSegment =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "code"; value: string };

const TOKEN_RE = /<([^>]+)>/g;
const CODE_BLOCK_RE = /```([\s\S]*?)```/g;
const INLINE_RE = /`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;

function unescapeSlackText(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Splits Slack's <...> tokens (mentions, channels, links, @here) out of a plain-text chunk. */
function tokenizeSpecials(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: unescapeSlackText(text.slice(lastIndex, match.index)) });
    }

    const inner = match[1];
    const pipeIndex = inner.indexOf("|");
    const head = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
    const label = pipeIndex === -1 ? undefined : inner.slice(pipeIndex + 1);

    if (head.startsWith("@")) {
      tokens.push({ type: "mention", id: head.slice(1), label });
    } else if (head.startsWith("#")) {
      tokens.push({ type: "channel", id: head.slice(1), label });
    } else if (head.startsWith("!")) {
      tokens.push({ type: "broadcast", value: head.slice(1) });
    } else if (/^https?:\/\//.test(head)) {
      tokens.push({ type: "link", url: head, label: label ?? head });
    } else {
      tokens.push({ type: "text", value: unescapeSlackText(match[0]) });
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: unescapeSlackText(text.slice(lastIndex)) });
  }

  return tokens;
}

/** Splits out ```code blocks``` first, then tokenizes the rest for Slack's <...> syntax. */
function parseSlackText(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CODE_BLOCK_RE.lastIndex = 0;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push(...tokenizeSpecials(text.slice(lastIndex, match.index)));
    tokens.push({ type: "codeblock", value: match[1] });
    lastIndex = CODE_BLOCK_RE.lastIndex;
  }

  if (lastIndex < text.length) tokens.push(...tokenizeSpecials(text.slice(lastIndex)));

  return tokens;
}

/** Parses *bold*, _italic_, ~strike~ and `code` within a plain-text token. */
function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, match.index) });

    if (match[1] !== undefined) segments.push({ type: "code", value: match[1] });
    else if (match[2] !== undefined) segments.push({ type: "bold", value: match[2] });
    else if (match[3] !== undefined) segments.push({ type: "italic", value: match[3] });
    else if (match[4] !== undefined) segments.push({ type: "strike", value: match[4] });

    lastIndex = INLINE_RE.lastIndex;
  }

  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}

function renderInline(text: string, key: string): ReactNode {
  return parseInline(text).map((seg, i) => {
    const k = `${key}-${i}`;
    switch (seg.type) {
      case "text":
        return seg.value;
      case "bold":
        return <strong key={k}>{seg.value}</strong>;
      case "italic":
        return <em key={k}>{seg.value}</em>;
      case "strike":
        return <s key={k}>{seg.value}</s>;
      case "code":
        return (
          <code key={k} className="rounded bg-black/[.06] px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            {seg.value}
          </code>
        );
    }
  });
}

/** Renders Slack's mrkdwn text: emphasis, code (blocks), mentions, channel refs, links, @here/@channel. */
export function SlackText({ text, userNames }: { text: string; userNames: Record<string, string> }): ReactNode {
  const tokens = parseSlackText(text);

  return (
    <div className="whitespace-pre-wrap break-words">
      {tokens.map((tok, i) => {
        switch (tok.type) {
          case "text":
            return <span key={i}>{renderInline(tok.value, String(i))}</span>;
          case "codeblock":
            return (
              <pre
                key={i}
                className="my-1 overflow-x-auto rounded-lg bg-black/[.06] p-2 font-mono text-[0.85em] dark:bg-white/[.08]"
              >
                {tok.value}
              </pre>
            );
          case "mention":
            return (
              <span key={i} className="rounded bg-blue-500/10 px-1 font-medium text-blue-600 dark:text-blue-400">
                @{userNames[tok.id] ?? tok.label ?? tok.id}
              </span>
            );
          case "channel":
            return (
              <span key={i} className="font-medium text-blue-600 dark:text-blue-400">
                #{tok.label ?? tok.id}
              </span>
            );
          case "broadcast":
            return (
              <span
                key={i}
                className="rounded bg-amber-500/10 px-1 font-medium text-amber-600 dark:text-amber-400"
              >
                @{tok.value}
              </span>
            );
          case "link":
            return (
              <a
                key={i}
                href={tok.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline dark:text-blue-400"
              >
                {tok.label}
              </a>
            );
        }
      })}
    </div>
  );
}
