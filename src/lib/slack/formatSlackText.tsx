"use client";

import type { ReactNode } from "react";
import { EmojiText } from "@/lib/ui/EmojiGlyph";

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
// A quoted line as Slack sends it (`&gt;` once escaped) or as typed here.
const QUOTE_LINE_RE = /^(?:&gt;|>)\s?/;

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
        return <EmojiText key={k} text={seg.value} />;
      case "bold":
        return (
          <strong key={k}>
            <EmojiText text={seg.value} />
          </strong>
        );
      case "italic":
        return (
          <em key={k}>
            <EmojiText text={seg.value} />
          </em>
        );
      case "strike":
        return (
          <s key={k}>
            <EmojiText text={seg.value} />
          </s>
        );
      case "code":
        return (
          <code key={k} className="rounded bg-black/[.06] px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            {seg.value}
          </code>
        );
    }
  });
}

function renderTokens(tokens: Token[], userNames: Record<string, string>, keyPrefix: string): ReactNode {
  return tokens.map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (tok.type) {
      case "text":
        return <span key={key}>{renderInline(tok.value, key)}</span>;
      case "codeblock":
        return (
          <pre
            key={key}
            className="my-1 overflow-x-auto rounded-lg bg-black/[.06] p-2 font-mono text-[0.85em] dark:bg-white/[.08]"
          >
            {tok.value}
          </pre>
        );
      case "mention":
        return (
          <span key={key} className="rounded bg-blue-500/10 px-1 font-medium text-blue-600 dark:text-blue-400">
            @{userNames[tok.id] ?? tok.label ?? tok.id}
          </span>
        );
      case "channel":
        return (
          <span key={key} className="font-medium text-blue-600 dark:text-blue-400">
            #{tok.label ?? tok.id}
          </span>
        );
      case "broadcast":
        return (
          <span key={key} className="rounded bg-amber-500/10 px-1 font-medium text-amber-600 dark:text-amber-400">
            @{tok.value}
          </span>
        );
      case "link":
        return (
          <a
            key={key}
            href={tok.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            {tok.label}
          </a>
        );
    }
  });
}

/**
 * Groups a message into quoted and plain runs of lines. Quotes are line-based in Slack's mrkdwn,
 * so this only kicks in for messages that have a quoted line and no fenced code block (which can
 * span lines and would be broken by splitting on newlines).
 */
function splitQuotes(text: string): { quote: boolean; text: string }[] | null {
  if (text.includes("```")) return null;
  const lines = text.split("\n");
  if (!lines.some((line) => QUOTE_LINE_RE.test(line))) return null;

  const blocks: { quote: boolean; lines: string[] }[] = [];
  for (const line of lines) {
    const quote = QUOTE_LINE_RE.test(line);
    const value = quote ? line.replace(QUOTE_LINE_RE, "") : line;
    const last = blocks[blocks.length - 1];
    if (last && last.quote === quote) last.lines.push(value);
    else blocks.push({ quote, lines: [value] });
  }
  return blocks.map((b) => ({ quote: b.quote, text: b.lines.join("\n") }));
}

/** Renders Slack's mrkdwn text: emphasis, code (blocks), quotes, mentions, channel refs, links, @here/@channel, emoji. */
export function SlackText({ text, userNames }: { text: string; userNames: Record<string, string> }): ReactNode {
  const blocks = splitQuotes(text);

  if (blocks) {
    return (
      <div className="whitespace-pre-wrap break-words">
        {blocks.map((block, i) =>
          block.quote ? (
            <blockquote
              key={i}
              className="my-0.5 border-l-2 border-zinc-300 pl-2 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
            >
              {renderTokens(parseSlackText(block.text), userNames, `q${i}`)}
            </blockquote>
          ) : (
            <span key={i}>
              {renderTokens(parseSlackText(block.text), userNames, `t${i}`)}
              {i < blocks.length - 1 && !blocks[i + 1].quote ? "\n" : null}
            </span>
          )
        )}
      </div>
    );
  }

  return <div className="whitespace-pre-wrap break-words">{renderTokens(parseSlackText(text), userNames, "t")}</div>;
}
