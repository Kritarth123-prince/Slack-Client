import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getConversationListItems } from "@/server/services/conversations";
import { getWorkspaceBranding } from "@/server/services/workspace";
import { Sidebar } from "@/components/sidebar/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) redirect("/");

  // A plain cached read here — the sidebar's own 15s poll (and the /app page) do the actual Slack
  // sync, so opening a conversation doesn't pay for a full workspace sweep on every navigation.
  const [items, branding] = await Promise.all([getConversationListItems(userId), getWorkspaceBranding(userId)]);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar items={items} branding={branding} />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">{children}</main>
    </div>
  );
}
