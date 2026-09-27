// Windows has no native flag emoji — a regional-indicator pair like 🇺🇸 renders as the letters "US".
// Flags are therefore drawn from Twemoji's SVGs instead of the system font, on every platform,
// so they look the same everywhere. Everything else stays as plain text in the system font.
const FLAG_PATTERN = "(?:\\uD83C[\\uDDE6-\\uDDFF]){2}";
const TWEMOJI_BASE = "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/svg/";

function twemojiUrl(glyph: string): string {
  const codepoints = [...glyph].map((ch) => ch.codePointAt(0)!.toString(16)).join("-");
  return `${TWEMOJI_BASE}${codepoints}.svg`;
}

export function isFlag(glyph: string): boolean {
  return new RegExp(`^${FLAG_PATTERN}$`).test(glyph);
}

function FlagImage({ glyph, className }: { glyph: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN SVG, not a local/static asset
    <img
      src={twemojiUrl(glyph)}
      alt={glyph}
      draggable={false}
      className={className ?? "inline-block h-[1.2em] w-[1.2em] align-[-0.2em]"}
    />
  );
}

/** Renders one emoji glyph — a Twemoji image for flags, plain text otherwise. */
export function EmojiGlyph({ glyph, className }: { glyph: string; className?: string }) {
  return isFlag(glyph) ? <FlagImage glyph={glyph} className={className} /> : <>{glyph}</>;
}

/** Renders a run of text with any flag emoji inside it swapped for Twemoji images. */
export function TextWithFlags({ text }: { text: string }) {
  // A fresh regex per call: a module-level /g regex carries lastIndex state between renders.
  const flagRe = new RegExp(FLAG_PATTERN, "g");
  if (!flagRe.test(text)) return <>{text}</>;
  flagRe.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = flagRe.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(<FlagImage key={match.index} glyph={match[0]} />);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
