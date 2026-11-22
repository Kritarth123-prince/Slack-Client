import { Hash, Lock, Users } from "lucide-react";
import { avatarColor, initials } from "@/lib/ui/avatar";

type ConversationType = "PUBLIC_CHANNEL" | "PRIVATE_CHANNEL" | "DM" | "GROUP_DM";

/**
 * The small marker in front of a conversation's name: # or a lock for channels, the person's photo
 * (or initials) for a DM, a people icon for a group DM.
 */
export function ConversationGlyph({
  type,
  label,
  avatarUrl,
  seed,
  size = 20,
}: {
  type: ConversationType;
  label: string;
  avatarUrl?: string | null;
  seed: string;
  size?: number;
}) {
  if (type === "PUBLIC_CHANNEL" || type === "PRIVATE_CHANNEL") {
    const Icon = type === "PUBLIC_CHANNEL" ? Hash : Lock;
    return (
      <span className="flex shrink-0 items-center justify-center text-subtle" style={{ width: size, height: size }} aria-hidden>
        <Icon size={Math.round(size * 0.8)} strokeWidth={2} />
      </span>
    );
  }

  if (type === "GROUP_DM") {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Users size={Math.round(size * 0.65)} />
      </span>
    );
  }

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL, not a local/static asset
      <img src={avatarUrl} alt="" className="shrink-0 rounded-md object-cover" style={{ width: size, height: size }} />
    );
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: avatarColor(seed), fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {initials(label)}
    </span>
  );
}
