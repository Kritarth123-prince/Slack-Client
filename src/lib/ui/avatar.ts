const PALETTE = [
  ["#6366f1", "#8b5cf6"], // indigo -> violet
  ["#ec4899", "#f43f5e"], // pink -> rose
  ["#06b6d4", "#3b82f6"], // cyan -> blue
  ["#f59e0b", "#ef4444"], // amber -> red
  ["#10b981", "#14b8a6"], // emerald -> teal
  ["#8b5cf6", "#d946ef"], // violet -> fuchsia
  ["#f97316", "#ec4899"], // orange -> pink
  ["#22c55e", "#0ea5e9"], // green -> sky
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Deterministic gradient (as a CSS background-image value) for a given name/id, so the same person always gets the same colour. */
export function avatarGradient(seed: string): string {
  const [from, to] = PALETTE[hashString(seed) % PALETTE.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
