import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { getConversationListItems } from "@/server/services/conversations";
import { getActiveInstallation, listWorkspaces } from "@/lib/slack/installation";
import { AppFrame } from "@/components/sidebar/AppFrame";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { QuickSwitcher } from "@/components/sidebar/QuickSwitcher";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { CustomEmojiProvider } from "@/lib/ui/customEmoji";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const installation = await getActiveInstallation(userId);
  if (!installation) redirect("/");

  // A plain cached read here — the sidebar's own 15s poll (and the /app page) do the actual Slack
  // sync, so opening a conversation doesn't pay for a full workspace sweep on every navigation.
  const [items, workspaces] = await Promise.all([getConversationListItems(userId), listWorkspaces(userId)]);

  return (
    <CustomEmojiProvider>
      <AppFrame sidebar={<Sidebar items={items} workspaces={workspaces} />}>{children}</AppFrame>
      <QuickSwitcher items={items} />
      <ServiceWorkerRegistration />
    </CustomEmojiProvider>
  );
}
