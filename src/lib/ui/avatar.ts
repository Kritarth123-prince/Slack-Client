// Muted, mid-tone fills that all carry white initials comfortably and sit quietly next to real
// profile photos — distinct enough to tell people apart without looking like a sweet shop.
const PALETTE = [
  "#3b6e8f", // slate blue
  "#2f7d6d", // pine
  "#8a5a44", // clay
  "#6b5b95", // dusk
  "#a2574f", // brick
  "#4f7a3a", // moss
  "#9a6b1f", // ochre
  "#5a6b7d", // steel
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Deterministic background colour for a given name/id, so the same person always gets the same colour. */
export function avatarColor(seed: string): string {
  return PALETTE[hashString(seed) % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
