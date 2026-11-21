import { ConversationList, type ConversationListItem } from "@/app/app/ConversationList";
import { StatusMenu } from "@/app/app/StatusMenu";
import { NotificationSetup } from "@/app/app/NotificationSetup";
import { WorkspaceSwitcher } from "@/components/sidebar/WorkspaceSwitcher";
import { SidebarNav } from "@/components/sidebar/SidebarNav";
import type { WorkspaceOption } from "@/lib/slack/installation";

/** Workspace switcher, jump/search/saved/settings, the live conversation list, and your status at the foot. */
export function Sidebar({ items, workspaces }: { items: ConversationListItem[]; workspaces: WorkspaceOption[] }) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center border-b border-line px-3">
        <WorkspaceSwitcher workspaces={workspaces} />
      </div>

      <SidebarNav />

      <div className="px-3 pb-1">
        <NotificationSetup />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-4">
        <ConversationList initial={items} />
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <StatusMenu />
      </div>
    </>
  );
}
