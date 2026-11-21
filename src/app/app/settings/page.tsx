import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { getPreferences, getSlackSyncStatus } from "@/server/services/preferences";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function SettingsPage() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const [prefs, syncStatus] = await Promise.all([getPreferences(userId), getSlackSyncStatus(userId)]);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
          <SettingsForm initial={prefs} syncStatus={syncStatus} />
        </div>
      </div>
    </>
  );
}
