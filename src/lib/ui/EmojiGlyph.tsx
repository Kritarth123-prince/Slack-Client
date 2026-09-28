"use client";

import { lookupEmojiGlyph, emojiGlyph } from "@/lib/ui/emoji";
import { useCustomEmoji } from "@/lib/ui/customEmoji";

// Windows has no native flag emoji — a regional-indicator pair like 🇺🇸 renders as the letters "US".
// Flags are therefore drawn from Twemoji's SVGs instead of the system font, on every platform,
// so they look the same everywhere. Everything else stays as plain text in the system font.
const FLAG_PATTERN = "(?:\\uD83C[\\uDDE6-\\uDDFF]){2}";
// :shortcode: as Slack writes it in message text — needs at least one letter so "10:30:45" isn't one.
const SHORTCODE_PATTERN = ":([a-z0-9_+\\-']*[a-z_][a-z0-9_+\\-']*):";
const TWEMOJI_BASE = "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/svg/";

function twemojiUrl(glyph: string): string {
  const codepoints = [...glyph].map((ch) => ch.codePointAt(0)!.toString(16)).join("-");
  return `${TWEMOJI_BASE}${codepoints}.svg`;
}

export function isFlag(glyph: string): boolean {
  return new RegExp(`^${FLAG_PATTERN}$`).test(glyph);
}

const INLINE_IMG = "inline-block h-[1.2em] w-[1.2em] align-[-0.2em]";

function FlagImage({ glyph, className }: { glyph: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN SVG, not a local/static asset
    <img src={twemojiUrl(glyph)} alt={glyph} draggable={false} className={className ?? INLINE_IMG} />
  );
}

function CustomImage({ name, url, className }: { name: string; url: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Slack-hosted custom emoji image
    <img src={url} alt={`:${name}:`} title={`:${name}:`} draggable={false} className={className ?? INLINE_IMG} />
  );
}

/** Renders one emoji glyph — a Twemoji image for flags, plain text otherwise. */
export function EmojiGlyph({ glyph, className }: { glyph: string; className?: string }) {
  return isFlag(glyph) ? <FlagImage glyph={glyph} className={className} /> : <>{glyph}</>;
}

/** Renders a reaction by Slack shortcode: custom workspace emoji image, standard glyph, or the `:name:` fallback. */
export function ReactionEmoji({ name, className }: { name: string; className?: string }) {
  const custom = useCustomEmoji();
  const url = custom[name];
  if (url) return <CustomImage name={name} url={url} className={className} />;
  return <EmojiGlyph glyph={emojiGlyph(name)} className={className} />;
}

/**
 * Renders a run of message text with flags swapped for Twemoji images and `:shortcode:` tokens
 * swapped for the custom emoji image or standard glyph they stand for.
 */
export function EmojiText({ text }: { text: string }) {
  const custom = useCustomEmoji();
  // Fresh regexes per call: a module-level /g regex carries lastIndex state between renders.
  const re = new RegExp(`${FLAG_PATTERN}|${SHORTCODE_PATTERN}`, "g");
  if (!re.test(text)) return <>{text}</>;
  re.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const shortcode = match[1];
    if (shortcode) {
      const url = custom[shortcode];
      const glyph = url ? null : lookupEmojiGlyph(shortcode);
      if (url) parts.push(<CustomImage key={match.index} name={shortcode} url={url} />);
      else if (glyph) parts.push(<EmojiGlyph key={match.index} glyph={glyph} />);
      else parts.push(token);
    } else {
      parts.push(<FlagImage key={match.index} glyph={token} />);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
