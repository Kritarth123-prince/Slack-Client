export function TypingLine({ names }: { names: string[] }) {
  if (names.length === 0) return <div className="h-5" aria-hidden />;

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? "" : "s"} are typing`;

  return (
    <p className="flex h-5 items-center gap-1.5 px-2 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
      <span className="flex items-end gap-0.5" aria-hidden>
        <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
      </span>
      <span className="truncate">{label}…</span>
    </p>
  );
}
