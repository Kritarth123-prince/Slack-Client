import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { SearchPanel } from "@/components/search/SearchPanel";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function SearchPage() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  return (
    <>
      <PageHeader title="Search" description="Messages across your workspace, via Slack's own search" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          <SearchPanel />
        </div>
      </div>
    </>
  );
}
