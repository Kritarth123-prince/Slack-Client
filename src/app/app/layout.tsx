import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { getConversationListItems } from "@/server/services/conversations";
import { getActiveInstallation, listWorkspaces } from "@/lib/slack/installation";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { QuickSwitcher } from "@/components/sidebar/QuickSwitcher";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const installation = await getActiveInstallation(userId);
  if (!installation) redirect("/");

  // A plain cached read here — the sidebar's own 15s poll (and the /app page) do the actual Slack
  // sync, so opening a conversation doesn't pay for a full workspace sweep on every navigation.
  const [items, workspaces] = await Promise.all([getConversationListItems(userId), listWorkspaces(userId)]);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar items={items} workspaces={workspaces} />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">{children}</main>
      <QuickSwitcher items={items} />
      <ServiceWorkerRegistration />
    </div>
  );
}
