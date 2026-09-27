import type { WorkspaceBranding } from "@/server/services/workspace";

/** Workspace icon + name, used wherever the app header used to say a generic title. */
export function WorkspaceBadge({ branding, size = "md" }: { branding: WorkspaceBranding | null; size?: "md" | "lg" }) {
  const name = branding?.name ?? "Slack";
  const iconClass = size === "lg" ? "h-10 w-10 rounded-xl text-base" : "h-8 w-8 rounded-lg text-sm";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {branding?.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL, not a local/static asset
        <img src={branding.iconUrl} alt="" className={`${iconClass} shrink-0 object-cover shadow-sm`} />
      ) : (
        <div className={`btn-primary ${iconClass} flex shrink-0 items-center justify-center font-bold text-white`} aria-hidden>
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className={`gradient-text truncate font-bold ${size === "lg" ? "text-2xl tracking-tight" : "text-base"}`}>{name}</p>
        {branding?.domain && (
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{branding.domain}.slack.com</p>
        )}
      </div>
    </div>
  );
}
